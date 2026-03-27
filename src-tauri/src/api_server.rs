// ---------------------------------------------------------------------------
// api_server.rs — axum HTTP server for the MCP orchestrator
// ---------------------------------------------------------------------------

use axum::{
    extract::{Path, Query, State as AxumState},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tower_http::cors::CorsLayer;

use crate::agent::event_bus::{AgentEvent, EventBus};
use crate::agent::manager::AgentManager;
use crate::agent::model::{
    Agent, AgentRole, AgentState, Provider, Scope,
};
use crate::agent::provider::{get_provider, AgentStartConfig};
use crate::pty::PtyManager;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// ApiState — shared state for all route handlers
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct ApiState {
    pub agent_manager: Arc<AgentManager>,
    pub event_bus: Arc<EventBus>,
    pub pty_manager: Arc<PtyManager>,
    pub app_handle: AppHandle,
    pub api_token: String,
    /// Legacy AppState — kept for settings access and non-agent routes.
    pub app_state: Arc<AppState>,
}

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

/// Reads (or creates) the API token from ~/.dorotoring/api-token.
pub fn ensure_api_token() -> String {
    let dir = dirs::home_dir()
        .expect("could not determine home directory")
        .join(".dorotoring");
    std::fs::create_dir_all(&dir).ok();

    let path = dir.join("api-token");
    if let Ok(token) = std::fs::read_to_string(&path) {
        let token = token.trim().to_string();
        if !token.is_empty() {
            return token;
        }
    }

    // Generate a 64-char hex token from two UUIDs (each UUID v4 = 32 hex chars)
    let a = uuid::Uuid::new_v4().simple().to_string();
    let b = uuid::Uuid::new_v4().simple().to_string();
    let token = format!("{a}{b}");
    std::fs::write(&path, &token).ok();
    token
}

/// Validate Bearer token from the Authorization header.
fn check_auth(headers: &HeaderMap, token: &str) -> Result<(), StatusCode> {
    let header = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    if header.strip_prefix("Bearer ").unwrap_or("") == token {
        Ok(())
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

// ---------------------------------------------------------------------------
// X-Agent-Id scope enforcement helper
// ---------------------------------------------------------------------------

/// If the `X-Agent-Id` header is present, look up the caller agent and enforce
/// scope against the target agent. Returns Ok(()) if either no header is
/// present (direct call, not MCP-originated) or if the scope check passes.
async fn enforce_caller_scope(
    headers: &HeaderMap,
    target: &Agent,
    agent_manager: &AgentManager,
) -> Result<(), StatusCode> {
    if let Some(caller_id) = headers.get("x-agent-id").and_then(|v| v.to_str().ok()) {
        let caller = agent_manager
            .get(&caller_id.to_string())
            .await
            .ok_or(StatusCode::FORBIDDEN)?;
        AgentManager::enforce_scope(&caller, target)
            .map_err(|_| StatusCode::FORBIDDEN)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct WaitQuery {
    timeout: Option<u64>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ListAgentsQuery {
    tab_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateAgentBody {
    cwd: Option<String>,
    project_path: Option<String>,
    name: Option<String>,
    character: Option<String>,
    skills: Option<Vec<String>>,
    skip_permissions: Option<bool>,
    tab_id: Option<String>,
    provider: Option<String>,
    is_super_agent: Option<bool>,
    super_agent_scope: Option<String>,
    secondary_paths: Option<Vec<String>>,
    parent_id: Option<String>,
}

#[derive(Deserialize)]
struct StartAgentBody {
    prompt: Option<String>,
}

#[derive(Deserialize)]
struct SendMessageBody {
    message: String,
}

#[derive(Deserialize)]
struct DelegateBody {
    prompt: Option<String>,
    timeout: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromoteBody {
    scope: Option<String>,
}

#[derive(Deserialize)]
struct HookStatusBody {
    agent_id: String,
    status: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HookOutputBody {
    agent_id: String,
    output: String,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async fn health() -> impl IntoResponse {
    Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
}

async fn list_agents(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Query(query): Query<ListAgentsQuery>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let agents = state
        .agent_manager
        .list(query.tab_id.as_ref())
        .await;

    Ok(Json(serde_json::json!({ "agents": agents })))
}

async fn get_agent(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let agent = state
        .agent_manager
        .get(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(serde_json::json!({ "agent": agent })))
}

async fn create_agent(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(body): Json<CreateAgentBody>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let id = uuid::Uuid::new_v4().to_string();
    let cwd = body.cwd.or(body.project_path).unwrap_or_default();
    let tab_id = body.tab_id.unwrap_or_else(|| "general".to_string());

    let mut agent = Agent::new(id, cwd, tab_id);
    agent.name = body.name;
    agent.character = body.character;
    agent.skills = body.skills.unwrap_or_default();
    agent.secondary_paths = body.secondary_paths.unwrap_or_default();
    agent.parent_id = body.parent_id;
    agent.provider = Provider::from_str_opt(body.provider.as_deref());

    // Handle super agent role
    let skip_perms = body.skip_permissions.unwrap_or(false);
    if body.is_super_agent.unwrap_or(false) {
        let scope = match body.super_agent_scope.as_deref() {
            Some("workspace") => Scope::Workspace,
            Some("global") => Scope::Global,
            _ => Scope::Tab,
        };
        agent.role = AgentRole::Super { scope };
    }

    let agent = state.agent_manager.create(agent).await;

    // The new Agent model does not have a `skip_permissions` field — store it
    // as a skills marker so the start handler can read it back when building
    // the CLI command.
    if skip_perms {
        let _ = state.agent_manager.update(&agent.id, |a| {
            if !a.skills.contains(&"__skip_permissions".to_string()) {
                a.skills.push("__skip_permissions".to_string());
            }
        }).await;
    }

    // Re-fetch to get the updated version
    let agent = state.agent_manager.get(&agent.id).await.ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;

    state.app_handle.emit("agent:status", &agent).ok();

    Ok(Json(serde_json::json!({ "agent": agent })))
}

async fn delete_agent(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    // Enforce scope if X-Agent-Id header is present
    if let Some(agent) = state.agent_manager.get(&id).await {
        enforce_caller_scope(&headers, &agent, &state.agent_manager).await?;
    }

    let removed = state.agent_manager.remove(&id).await;

    if let Some(agent) = removed {
        if let Some(ref pty_id) = agent.pty_id {
            state.pty_manager.kill(pty_id).ok();
        }
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn start_agent(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<StartAgentBody>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let agent_snapshot = state
        .agent_manager
        .get(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    // Enforce scope if X-Agent-Id header is present
    enforce_caller_scope(&headers, &agent_snapshot, &state.agent_manager).await?;

    // If agent already running and has a PTY, write the prompt directly
    if agent_snapshot.state == AgentState::Running {
        if let Some(ref pty_id) = agent_snapshot.pty_id {
            if let Some(ref prompt) = body.prompt {
                let msg = format!("{prompt}\n");
                state
                    .pty_manager
                    .write(pty_id, msg.as_bytes())
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            }
            return Ok(Json(serde_json::json!({ "agent": agent_snapshot })));
        }
    }

    // Reuse existing PTY if the UI already created one for this agent,
    // otherwise spawn a new one and register it so the UI can find it.
    let reused_pty;
    let pty_id = if let Some(existing) = state.pty_manager.lookup(&id) {
        reused_pty = true;
        existing
    } else {
        reused_pty = false;
        let new_id = uuid::Uuid::new_v4().to_string();
        state
            .pty_manager
            .spawn(
                &new_id,
                &agent_snapshot.id,
                &agent_snapshot.cwd,
                &state.app_handle,
                None,
                None,
            )
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        // Register so the UI's pty_lookup(agentId) finds this PTY
        state.pty_manager.register(&id, &new_id);
        new_id
    };

    // If reusing an existing PTY, send Ctrl-C to interrupt any foreground process
    if reused_pty {
        state
            .pty_manager
            .write(&pty_id, b"\x03\x03")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }

    // Export agent ID so Claude Code hooks can report status back to Dorotoring
    state
        .pty_manager
        .write(&pty_id, format!("export DOROTORING_AGENT_ID={id}\n").as_bytes())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // For tab-scoped super agents: export tab ID so MCP server can filter
    if agent_snapshot.is_super_agent() {
        if let Some(Scope::Tab) = agent_snapshot.scope() {
            state
                .pty_manager
                .write(
                    &pty_id,
                    format!("export DOROTORING_TAB_ID={}\n", agent_snapshot.tab_id).as_bytes(),
                )
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }
    }

    // Build and send the CLI command using the provider trait
    let settings = state.app_state.settings.lock().unwrap().clone();
    let skip_permissions = agent_snapshot.skills.contains(&"__skip_permissions".to_string());

    let config = build_start_config(
        &agent_snapshot,
        body.prompt.as_deref(),
        skip_permissions,
    );
    let cmd = build_cli_command(&agent_snapshot, config, &settings);
    let cmd_str = cmd.join(" ");
    state
        .pty_manager
        .write(&pty_id, format!("{cmd_str}\n").as_bytes())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Update agent state to Running
    state
        .agent_manager
        .set_state(&id, AgentState::Running)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Update pty_id on the agent
    let updated_agent = state
        .agent_manager
        .update(&id, |a| {
            a.pty_id = Some(pty_id);
            a.error = None;
        })
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    state.app_handle.emit("agent:status", &updated_agent).ok();

    Ok(Json(serde_json::json!({ "agent": updated_agent })))
}

async fn stop_agent(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let agent = state
        .agent_manager
        .get(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    // Enforce scope if X-Agent-Id header is present
    enforce_caller_scope(&headers, &agent, &state.agent_manager).await?;

    // Kill PTY if one exists
    if let Some(ref pty_id) = agent.pty_id {
        state.pty_manager.kill(pty_id).ok();
    }

    // Transition to Inactive
    state
        .agent_manager
        .set_state(&id, AgentState::Inactive)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Clear pty_id
    let updated_agent = state
        .agent_manager
        .update(&id, |a| {
            a.pty_id = None;
        })
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    state.app_handle.emit("agent:status", &updated_agent).ok();

    Ok(Json(serde_json::json!({ "agent": updated_agent })))
}

async fn send_message(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<SendMessageBody>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let agent = state
        .agent_manager
        .get(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    // Enforce scope if X-Agent-Id header is present
    enforce_caller_scope(&headers, &agent, &state.agent_manager).await?;

    // Auto-start if agent is idle (has no PTY)
    if agent.pty_id.is_none() || agent.state == AgentState::Inactive {
        // Start the agent first, then write the message
        let start_body = StartAgentBody { prompt: None };
        start_agent_inner(&state, &headers, &id, start_body).await?;
        // Now write the message to the newly created PTY
        let refreshed = state
            .agent_manager
            .get(&id)
            .await
            .ok_or(StatusCode::NOT_FOUND)?;
        if let Some(ref pty_id) = refreshed.pty_id {
            let msg = format!("{}\n", body.message);
            state
                .pty_manager
                .write(pty_id, msg.as_bytes())
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }
        return Ok(Json(serde_json::json!({ "ok": true })));
    }

    let pty_id = agent.pty_id.as_ref().ok_or(StatusCode::BAD_REQUEST)?;

    let msg = format!("{}\n", body.message);
    state
        .pty_manager
        .write(pty_id, msg.as_bytes())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn wait_for_agent(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<WaitQuery>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let timeout_secs = query.timeout.unwrap_or(300);

    // Check if agent already in a terminal state
    {
        let agent = state
            .agent_manager
            .get(&id)
            .await
            .ok_or(StatusCode::NOT_FOUND)?;

        if agent.state.is_terminal() {
            return Ok(Json(serde_json::json!({
                "status": agent.state,
                "lastCleanOutput": agent.status_line,
                "error": agent.error,
            })));
        }
    }

    // Subscribe to event bus and wait for a terminal state change
    let mut rx = state.event_bus.subscribe_events();

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        async {
            loop {
                match rx.recv().await {
                    Ok(AgentEvent::StateChanged {
                        agent_id,
                        new,
                        ..
                    }) if agent_id == id => {
                        if new.is_terminal() {
                            let agent = state.agent_manager.get(&id).await;
                            if let Some(agent) = agent {
                                return serde_json::json!({
                                    "status": agent.state,
                                    "lastCleanOutput": agent.status_line,
                                    "error": agent.error,
                                });
                            }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        return serde_json::json!({
                            "error": "broadcast channel closed",
                        });
                    }
                    _ => continue,
                }
            }
        },
    )
    .await;

    match result {
        Ok(value) => Ok(Json(value)),
        Err(_) => Ok(Json(serde_json::json!({ "timeout": true }))),
    }
}

/// Delegate endpoint: start + wait + return final state in one call.
async fn delegate_handler(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<DelegateBody>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let agent = state
        .agent_manager
        .get(&id)
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    // Enforce scope if X-Agent-Id header is present
    enforce_caller_scope(&headers, &agent, &state.agent_manager).await?;

    // Step 1: Start the agent
    let start_body = StartAgentBody {
        prompt: body.prompt,
    };
    start_agent_inner(&state, &headers, &id, start_body).await?;

    // Step 2: Long-poll until terminal state
    let timeout_secs = body.timeout.unwrap_or(300);
    let mut rx = state.event_bus.subscribe_events();

    // Check if already terminal after start
    {
        let agent = state
            .agent_manager
            .get(&id)
            .await
            .ok_or(StatusCode::NOT_FOUND)?;
        if agent.state.is_terminal() {
            return Ok(Json(serde_json::json!({ "agent": agent })));
        }
    }

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        async {
            loop {
                match rx.recv().await {
                    Ok(AgentEvent::StateChanged {
                        agent_id,
                        new,
                        ..
                    }) if agent_id == id => {
                        if new.is_terminal() {
                            return state.agent_manager.get(&id).await;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        return None;
                    }
                    _ => continue,
                }
            }
        },
    )
    .await;

    match result {
        Ok(Some(agent)) => Ok(Json(serde_json::json!({ "agent": agent }))),
        Ok(None) => Ok(Json(serde_json::json!({ "error": "channel closed" }))),
        Err(_) => {
            // Timeout — return current state
            let agent = state.agent_manager.get(&id).await;
            Ok(Json(serde_json::json!({
                "timeout": true,
                "agent": agent,
            })))
        }
    }
}

/// Promote an agent to super agent with given scope.
async fn promote_handler(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<PromoteBody>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let scope = match body.scope.as_deref() {
        Some("workspace") => Scope::Workspace,
        Some("global") => Scope::Global,
        _ => Scope::Tab,
    };

    let agent = state
        .agent_manager
        .promote_super(&id, scope)
        .await
        .map_err(|e| {
            eprintln!("[api_server] promote failed: {e}");
            StatusCode::BAD_REQUEST
        })?;

    state.app_handle.emit("agent:status", &agent).ok();

    Ok(Json(serde_json::json!({ "agent": agent })))
}

/// Set agent to dormant state.
async fn dormant_handler(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    // Kill PTY if one exists
    if let Some(agent) = state.agent_manager.get(&id).await {
        if let Some(ref pty_id) = agent.pty_id {
            state.pty_manager.kill(pty_id).ok();
        }
    }

    state
        .agent_manager
        .set_state(&id, AgentState::Dormant)
        .await
        .map_err(|e| {
            eprintln!("[api_server] dormant failed: {e}");
            StatusCode::BAD_REQUEST
        })?;

    // Clear pty_id
    let agent = state
        .agent_manager
        .update(&id, |a| {
            a.pty_id = None;
        })
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    state.app_handle.emit("agent:status", &agent).ok();

    Ok(Json(serde_json::json!({ "agent": agent })))
}

/// Reanimate a dormant agent to inactive.
async fn reanimate_handler(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let agent = state
        .agent_manager
        .set_state(&id, AgentState::Inactive)
        .await
        .map_err(|e| {
            eprintln!("[api_server] reanimate failed: {e}");
            StatusCode::BAD_REQUEST
        })?;

    state.app_handle.emit("agent:status", &agent).ok();

    Ok(Json(serde_json::json!({ "agent": agent })))
}

// ---------------------------------------------------------------------------
// Hook endpoints (no auth — called by local processes)
// ---------------------------------------------------------------------------

async fn hook_status(
    AxumState(state): AxumState<ApiState>,
    Json(body): Json<HookStatusBody>,
) -> impl IntoResponse {
    let new_state = match body.status.as_str() {
        "running" => AgentState::Running,
        "waiting" => AgentState::Waiting,
        "idle" | "completed" => AgentState::Completed,
        "error" => AgentState::Error,
        "dormant" => AgentState::Dormant,
        _ => AgentState::Inactive,
    };

    let result = state
        .agent_manager
        .set_state(&body.agent_id, new_state)
        .await;

    if let Ok(ref agent) = result {
        state.app_handle.emit("agent:status", agent).ok();
    }

    Json(serde_json::json!({ "ok": result.is_ok() }))
}

async fn hook_output(
    AxumState(state): AxumState<ApiState>,
    Json(body): Json<HookOutputBody>,
) -> impl IntoResponse {
    state
        .agent_manager
        .set_status_line(&body.agent_id, body.output)
        .await;

    Json(serde_json::json!({ "ok": true }))
}

// ---------------------------------------------------------------------------
// Internal helper: start agent logic shared between start_agent and delegate
// ---------------------------------------------------------------------------

async fn start_agent_inner(
    state: &ApiState,
    _headers: &HeaderMap,
    id: &str,
    body: StartAgentBody,
) -> Result<Agent, StatusCode> {
    let agent_snapshot = state
        .agent_manager
        .get(&id.to_string())
        .await
        .ok_or(StatusCode::NOT_FOUND)?;

    // If agent already running and has a PTY, write the prompt directly
    if agent_snapshot.state == AgentState::Running {
        if let Some(ref pty_id) = agent_snapshot.pty_id {
            if let Some(ref prompt) = body.prompt {
                let msg = format!("{prompt}\n");
                state
                    .pty_manager
                    .write(pty_id, msg.as_bytes())
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            }
            return Ok(agent_snapshot);
        }
    }

    // Reuse existing PTY or spawn a new one
    let reused_pty;
    let pty_id = if let Some(existing) = state.pty_manager.lookup(id) {
        reused_pty = true;
        existing
    } else {
        reused_pty = false;
        let new_id = uuid::Uuid::new_v4().to_string();
        state
            .pty_manager
            .spawn(
                &new_id,
                &agent_snapshot.id,
                &agent_snapshot.cwd,
                &state.app_handle,
                None,
                None,
            )
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        state.pty_manager.register(id, &new_id);
        new_id
    };

    if reused_pty {
        state
            .pty_manager
            .write(&pty_id, b"\x03\x03")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }

    // Export agent ID
    state
        .pty_manager
        .write(&pty_id, format!("export DOROTORING_AGENT_ID={id}\n").as_bytes())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Export tab ID for tab-scoped super agents
    if agent_snapshot.is_super_agent() {
        if let Some(Scope::Tab) = agent_snapshot.scope() {
            state
                .pty_manager
                .write(
                    &pty_id,
                    format!("export DOROTORING_TAB_ID={}\n", agent_snapshot.tab_id).as_bytes(),
                )
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }
    }

    // Build and send the CLI command
    let settings = state.app_state.settings.lock().unwrap().clone();
    let skip_permissions = agent_snapshot.skills.contains(&"__skip_permissions".to_string());

    let config = build_start_config(
        &agent_snapshot,
        body.prompt.as_deref(),
        skip_permissions,
    );
    let cmd = build_cli_command(&agent_snapshot, config, &settings);
    let cmd_str = cmd.join(" ");
    state
        .pty_manager
        .write(&pty_id, format!("{cmd_str}\n").as_bytes())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Update agent state
    let _ = state
        .agent_manager
        .set_state(&id.to_string(), AgentState::Running)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let updated_agent = state
        .agent_manager
        .update(&id.to_string(), |a| {
            a.pty_id = Some(pty_id);
            a.error = None;
        })
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    state.app_handle.emit("agent:status", &updated_agent).ok();

    Ok(updated_agent)
}

// ---------------------------------------------------------------------------
// CLI command builder — uses provider trait
// ---------------------------------------------------------------------------

/// Build an AgentStartConfig from agent state and optional prompt.
fn build_start_config(
    agent: &Agent,
    prompt: Option<&str>,
    skip_permissions: bool,
) -> AgentStartConfig {
    // Resolve MCP config and system prompt file for super agents
    let (mcp_config, system_prompt_file) = if agent.is_super_agent() {
        let mcp = dirs::home_dir()
            .map(|h| h.join(".claude").join("mcp.json"))
            .filter(|p| p.exists());
        let instructions = crate::ensure_super_agent_instructions();
        (mcp, instructions)
    } else {
        (None, None)
    };

    AgentStartConfig {
        prompt: prompt.unwrap_or("").to_string(),
        cwd: PathBuf::from(&agent.cwd),
        skip_permissions,
        mcp_config,
        system_prompt_file,
        model: None,
        secondary_paths: agent.secondary_paths.clone(),
        continue_session: false,
    }
}

/// Build the full CLI command using the provider trait.
fn build_cli_command(
    agent: &Agent,
    config: AgentStartConfig,
    settings: &crate::state::AppSettings,
) -> Vec<String> {
    let provider_impl = get_provider(&agent.provider);
    let cli_path = get_cli_path_for_provider(&agent.provider, settings);
    provider_impl.build_command(&config, Some(&cli_path))
}

/// Map a Provider enum to the configured CLI path from settings.
fn get_cli_path_for_provider(
    provider: &Provider,
    settings: &crate::state::AppSettings,
) -> String {
    match provider {
        Provider::Codex => settings.cli_paths.codex.clone(),
        Provider::Gemini => settings.cli_paths.gemini.clone(),
        Provider::Opencode => settings.cli_paths.opencode.clone(),
        Provider::Pi => settings.cli_paths.pi.clone(),
        Provider::Local => settings.cli_paths.claude.clone(),
        Provider::Claude => settings.cli_paths.claude.clone(),
    }
}

// ---------------------------------------------------------------------------
// Server entry point
// ---------------------------------------------------------------------------

pub async fn start(
    agent_manager: Arc<AgentManager>,
    event_bus: Arc<EventBus>,
    pty_manager: Arc<PtyManager>,
    app_handle: AppHandle,
    app_state: Arc<AppState>,
) {
    let api_token = ensure_api_token();
    eprintln!("[api_server] API server starting on 127.0.0.1:31415");

    let api_state = ApiState {
        agent_manager,
        event_bus,
        pty_manager,
        app_handle,
        api_token,
        app_state,
    };

    let cors = CorsLayer::new()
        .allow_origin([
            "http://localhost:1420".parse().unwrap(),
            "tauri://localhost".parse().unwrap(),
        ])
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::DELETE,
            axum::http::Method::OPTIONS,
        ])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::AUTHORIZATION,
        ]);

    let app = Router::new()
        // Health (no auth)
        .route("/api/health", get(health))
        // Agent CRUD (auth required)
        .route("/api/agents", get(list_agents).post(create_agent))
        .route("/api/agents/{id}", get(get_agent).delete(delete_agent))
        .route("/api/agents/{id}/wait", get(wait_for_agent))
        .route("/api/agents/{id}/start", post(start_agent))
        .route("/api/agents/{id}/stop", post(stop_agent))
        .route("/api/agents/{id}/message", post(send_message))
        .route("/api/agents/{id}/delegate", post(delegate_handler))
        .route("/api/agents/{id}/promote", post(promote_handler))
        .route("/api/agents/{id}/dormant", post(dormant_handler))
        .route("/api/agents/{id}/reanimate", post(reanimate_handler))
        // Hooks (no auth — called by local processes)
        .route("/api/hooks/status", post(hook_status))
        .route("/api/hooks/output", post(hook_output))
        .with_state(api_state)
        .layer(cors);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:31415")
        .await
        .expect("failed to bind API server to 127.0.0.1:31415");

    eprintln!("[api_server] API server listening on 127.0.0.1:31415");

    axum::serve(listener, app).await.expect("API server error");
}
