// ---------------------------------------------------------------------------
// api_server.rs — axum HTTP server for the MCP orchestrator
// ---------------------------------------------------------------------------

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State as AxumState,
    },
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::broadcast;
use tauri::{AppHandle, Emitter};
use tower_http::cors::CorsLayer;

use crate::agent::event_bus::{AgentEvent, EventBus};
use crate::agent::manager::AgentManager;
use crate::agent::model::{Agent, AgentState, Provider};
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
    pub knowledge: Arc<crate::knowledge::KnowledgeEngine>,
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
/// tab visibility against the target agent. Returns Ok(()) if either no header
/// is present (direct call, not MCP-originated) or if the tab check passes.
async fn enforce_caller_tab(
    headers: &HeaderMap,
    target: &Agent,
    agent_manager: &AgentManager,
) -> Result<(), StatusCode> {
    if let Some(caller_id) = headers.get("x-agent-id").and_then(|v| v.to_str().ok()) {
        let caller = agent_manager
            .get(&caller_id.to_string())
            .await
            .ok_or(StatusCode::FORBIDDEN)?;
        AgentManager::enforce_tab_visibility(&caller, target)
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
struct HookStatusBody {
    agent_id: String,
    status: String,
    cwd: Option<String>,
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
// WebSocket message types
// ---------------------------------------------------------------------------

/// Incoming JSON messages on the `/ws/pty/{agent_id}` WebSocket.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum PtyWsMessage {
    Input { data: String },
    Resize { cols: u16, rows: u16 },
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

    agent.skip_permissions = body.skip_permissions.unwrap_or(false);
    if agent.character.is_none() {
        agent.character = Some(AgentManager::assign_random_character());
    }

    let agent = state.agent_manager.create(agent).await;

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
        enforce_caller_tab(&headers, &agent, &state.agent_manager).await?;
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
    enforce_caller_tab(&headers, &agent_snapshot, &state.agent_manager).await?;

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
        // Create EventBus PTY channel for WebSocket streaming
        let bus_tx = state.event_bus.create_pty_channel(&id);
        state
            .pty_manager
            .spawn(
                &new_id,
                &agent_snapshot.id,
                &agent_snapshot.cwd,
                &state.app_handle,
                None,
                None,
                Some(bus_tx),
            )
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        // Register so the UI's pty_lookup(agentId) finds this PTY
        state.pty_manager.register(&id, &new_id);
        new_id
    };

    // Ensure EventBus PTY channel exists (for reused PTYs that were spawned without one)
    if reused_pty {
        let bus_tx = state.event_bus.create_pty_channel(&id);
        state.pty_manager.set_event_bus_tx(&pty_id, bus_tx);
    }

    // If reusing an existing PTY, send Ctrl-C to interrupt any foreground process
    if reused_pty {
        state
            .pty_manager
            .write(&pty_id, b"\x03\x03")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    } else {
        // Wait for the freshly spawned shell to initialize
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    // Export agent ID so Claude Code hooks can report status back to Dorotoring
    state
        .pty_manager
        .write(&pty_id, format!("export DOROTORING_AGENT_ID={id}\n").as_bytes())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Export tab ID for tab-scoped visibility
    state
        .pty_manager
        .write(
            &pty_id,
            format!("export DOROTORING_TAB_ID={}\n", agent_snapshot.tab_id).as_bytes(),
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Build and send the CLI command using the provider trait
    let settings = state.app_state.settings.lock().unwrap().clone();

    let config = build_start_config(
        &agent_snapshot,
        body.prompt.as_deref(),
        agent_snapshot.skip_permissions,
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
    enforce_caller_tab(&headers, &agent, &state.agent_manager).await?;

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
    enforce_caller_tab(&headers, &agent, &state.agent_manager).await?;

    // Auto-start if agent is idle (has no PTY)
    if agent.pty_id.is_none() || agent.state == AgentState::Inactive {
        // Start the agent with the message as the prompt so it executes immediately
        let start_body = StartAgentBody {
            prompt: Some(body.message.clone()),
        };
        start_agent_inner(&state, &headers, &id, start_body).await?;
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
    enforce_caller_tab(&headers, &agent, &state.agent_manager).await?;

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
        .set_state(&body.agent_id, new_state.clone())
        .await;

    let status_str = body.status.clone();

    // Update cwd if provided by the hook (tracks real project directory)
    if let Some(cwd) = body.cwd {
        if !cwd.is_empty() {
            let cwd_clone = cwd.clone();
            let _ = state
                .agent_manager
                .update(&body.agent_id, |agent| {
                    agent.cwd = cwd_clone;
                })
                .await;
            state
                .app_handle
                .emit(
                    "agent:cwd-changed",
                    serde_json::json!({ "agentId": body.agent_id, "cwd": cwd }),
                )
                .ok();
        }
    }

    if let Ok(ref agent) = result {
        state.app_handle.emit("agent:status", agent).ok();
    }

    // Capture session for knowledge layer on terminal states
    if matches!(new_state, AgentState::Completed | AgentState::Error) {
        if let Ok(ref agent) = result {
            let knowledge = state.knowledge.clone();
            let agent_cwd = agent.cwd.clone();
            let agent_id = agent.id.clone();
            let agent_name = agent.name.clone();
            let agent_created = agent.created_at.clone();
            let status_for_capture = status_str.clone();
            tokio::spawn(async move {
                let conn = match knowledge.get_conn(&agent_cwd).await {
                    Ok(c) => c,
                    Err(_) => return,
                };
                let conn_guard = conn.lock().unwrap();
                let embedding = knowledge.embedding.try_lock().ok();
                let engine_ref = embedding.as_deref();
                let session_id = uuid::Uuid::new_v4().to_string();
                let now = chrono::Utc::now().to_rfc3339();
                crate::knowledge::session_capture::capture_session(
                    &conn_guard,
                    &session_id,
                    &agent_id,
                    agent_name.as_deref(),
                    &status_for_capture,
                    &[], &[], None,
                    &agent_created,
                    &now,
                    engine_ref,
                ).ok();
            });
        }
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
// WebSocket handlers
// ---------------------------------------------------------------------------

/// `/ws/events` — global agent event stream (broadcasts all AgentEvents as JSON)
async fn ws_events_handler(
    ws: WebSocketUpgrade,
    AxumState(state): AxumState<ApiState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| ws_events(socket, state))
}

async fn ws_events(mut socket: WebSocket, state: ApiState) {
    let mut rx = state.event_bus.subscribe_events();

    loop {
        tokio::select! {
            event = rx.recv() => {
                match event {
                    Ok(evt) => {
                        let json = serde_json::to_string(&evt).unwrap_or_default();
                        if socket.send(Message::Text(json.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        eprintln!("[ws_events] lagged by {n} events");
                        continue;
                    }
                    Err(_) => break,
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }
}

/// `/ws/pty/{agent_id}` — duplex PTY WebSocket (output as binary, input as JSON text or raw binary)
async fn ws_pty_handler(
    ws: WebSocketUpgrade,
    Path(agent_id): Path<String>,
    AxumState(state): AxumState<ApiState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| ws_pty(socket, agent_id, state))
}

async fn ws_pty(mut socket: WebSocket, agent_id: String, state: ApiState) {
    // Subscribe to live PTY output from EventBus
    let pty_rx = state.event_bus.subscribe_pty(&agent_id);
    if pty_rx.is_none() {
        let _ = socket.send(Message::Close(None)).await;
        return;
    }
    let mut pty_rx = pty_rx.unwrap();

    loop {
        tokio::select! {
            data = pty_rx.recv() => {
                match data {
                    Ok(bytes) => {
                        if socket.send(Message::Binary(bytes.to_vec().into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(parsed) = serde_json::from_str::<PtyWsMessage>(&text) {
                            match parsed {
                                PtyWsMessage::Input { data } => {
                                    let pty_id = state.agent_manager
                                        .get(&agent_id).await
                                        .and_then(|a| a.pty_id.clone());
                                    if let Some(pty_id) = pty_id {
                                        let _ = state.pty_manager.write(&pty_id, data.as_bytes());
                                    }
                                }
                                PtyWsMessage::Resize { cols, rows } => {
                                    let pty_id = state.agent_manager
                                        .get(&agent_id).await
                                        .and_then(|a| a.pty_id.clone());
                                    if let Some(pty_id) = pty_id {
                                        let _ = state.pty_manager.resize(&pty_id, cols, rows);
                                    }
                                }
                            }
                        }
                    }
                    Some(Ok(Message::Binary(data))) => {
                        let pty_id = state.agent_manager
                            .get(&agent_id).await
                            .and_then(|a| a.pty_id.clone());
                        if let Some(pty_id) = pty_id {
                            let _ = state.pty_manager.write(&pty_id, &data);
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }
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
        // Create EventBus PTY channel for WebSocket streaming
        let bus_tx = state.event_bus.create_pty_channel(&id.to_string());
        state
            .pty_manager
            .spawn(
                &new_id,
                &agent_snapshot.id,
                &agent_snapshot.cwd,
                &state.app_handle,
                None,
                None,
                Some(bus_tx),
            )
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        state.pty_manager.register(id, &new_id);
        new_id
    };

    // Ensure EventBus PTY channel exists (for reused PTYs spawned without one)
    if reused_pty {
        let bus_tx = state.event_bus.create_pty_channel(&id.to_string());
        state.pty_manager.set_event_bus_tx(&pty_id, bus_tx);
    }

    if reused_pty {
        state
            .pty_manager
            .write(&pty_id, b"\x03\x03")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    } else {
        // Wait for the freshly spawned shell to initialize
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    // Export agent ID
    state
        .pty_manager
        .write(&pty_id, format!("export DOROTORING_AGENT_ID={id}\n").as_bytes())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Export tab ID for tab-scoped visibility
    state
        .pty_manager
        .write(
            &pty_id,
            format!("export DOROTORING_TAB_ID={}\n", agent_snapshot.tab_id).as_bytes(),
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Build and send the CLI command
    let settings = state.app_state.settings.lock().unwrap().clone();

    let config = build_start_config(
        &agent_snapshot,
        body.prompt.as_deref(),
        agent_snapshot.skip_permissions,
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
    // All agents get MCP config and the lightweight orchestration prompt
    let mcp_config = dirs::home_dir()
        .map(|h| h.join(".claude").join("mcp.json"))
        .filter(|p| p.exists());
    let system_prompt_file = crate::ensure_agent_instructions();

    let repo_map_file = {
        let hash = crate::knowledge::db::project_hash(&agent.cwd);
        dirs::home_dir()
            .map(|h| h.join(".dorotoring").join("projects").join(&hash).join("repo-map.md"))
            .filter(|p| p.exists())
    };

    AgentStartConfig {
        prompt: prompt.unwrap_or("").to_string(),
        cwd: PathBuf::from(&agent.cwd),
        skip_permissions,
        mcp_config,
        system_prompt_file,
        repo_map_file,
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
// Knowledge Layer handlers
// ---------------------------------------------------------------------------

/// GET /api/code/repo-map — generate a budget-aware repo map for a project.
async fn code_repo_map(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let project = params
        .get("project")
        .ok_or(StatusCode::BAD_REQUEST)?
        .clone();

    let budget: usize = params
        .get("budget")
        .and_then(|b| b.parse().ok())
        .unwrap_or(2048);

    let conn = state
        .knowledge
        .get_conn(&project)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let conn_guard = conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let map = crate::knowledge::repo_map::generate(&conn_guard, &project, budget)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Count symbols and files from the DB.
    let symbols_count: i64 = conn_guard
        .query_row("SELECT COUNT(*) FROM symbols", [], |row| row.get(0))
        .unwrap_or(0);

    let files_count: i64 = conn_guard
        .query_row(
            "SELECT COUNT(DISTINCT file) FROM symbols",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    Ok(Json(serde_json::json!({
        "map": map,
        "symbols_count": symbols_count,
        "files_count": files_count,
    })))
}

/// GET /api/code/outline — parse a file and return its symbols.
async fn code_outline(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let file = params.get("file").ok_or(StatusCode::BAD_REQUEST)?.clone();
    let path = std::path::Path::new(&file);

    let parse_result = crate::knowledge::tree_sitter::parse_file(path)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let lines = std::fs::read_to_string(path)
        .map(|s| s.lines().count())
        .unwrap_or(0);

    let language = crate::knowledge::tree_sitter::detect_language(path)
        .map(|l| format!("{l:?}"))
        .unwrap_or_else(|| "unknown".to_string());

    let symbols: Vec<serde_json::Value> = parse_result
        .symbols
        .iter()
        .map(|s| {
            serde_json::json!({
                "kind": s.kind.as_str(),
                "name": s.name,
                "signature": s.signature,
                "line": s.line,
                "end_line": s.end_line,
                "exported": s.exported,
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "path": file,
        "lines": lines,
        "language": language,
        "symbols": symbols,
    })))
}

/// GET /api/code/references — find definition and references for a symbol.
async fn code_references(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let symbol = params
        .get("symbol")
        .ok_or(StatusCode::BAD_REQUEST)?
        .clone();

    let project = params
        .get("project")
        .ok_or(StatusCode::BAD_REQUEST)?
        .clone();

    let conn = state
        .knowledge
        .get_conn(&project)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let conn_guard = conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Query definition.
    let definition: Option<serde_json::Value> = conn_guard
        .query_row(
            "SELECT file, line, kind, signature FROM symbols WHERE name = ?1",
            rusqlite::params![symbol],
            |row| {
                Ok(serde_json::json!({
                    "file": row.get::<_, String>(0)?,
                    "line": row.get::<_, i64>(1)?,
                    "kind": row.get::<_, String>(2)?,
                    "signature": row.get::<_, Option<String>>(3)?,
                }))
            },
        )
        .ok();

    // Query references.
    let mut stmt = conn_guard
        .prepare("SELECT from_file, line FROM refs WHERE to_symbol = ?1")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let references: Vec<serde_json::Value> = stmt
        .query_map(rusqlite::params![symbol], |row| {
            Ok(serde_json::json!({
                "from_file": row.get::<_, String>(0)?,
                "line": row.get::<_, Option<i64>>(1)?,
            }))
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(Json(serde_json::json!({
        "definition": definition,
        "references": references,
    })))
}

/// GET /api/knowledge/search — hybrid FTS + embedding search.
async fn knowledge_search(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let query = params
        .get("query")
        .ok_or(StatusCode::BAD_REQUEST)?
        .clone();

    let project = params
        .get("project")
        .ok_or(StatusCode::BAD_REQUEST)?
        .clone();

    let type_filter = params.get("type").cloned();

    let max_results: usize = params
        .get("max_results")
        .and_then(|m| m.parse().ok())
        .unwrap_or(10);

    let conn = state
        .knowledge
        .get_conn(&project)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let conn_guard = conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Try to lock the embedding engine; if it's busy, search without embeddings.
    let embedding_guard = state.knowledge.embedding.try_lock().ok();
    let embedding_ref = embedding_guard.as_deref();

    let results = crate::knowledge::search::search(
        &conn_guard,
        &query,
        type_filter.as_deref(),
        max_results,
        embedding_ref,
        0.5,
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(serde_json::json!({ "results": results })))
}

/// GET /api/sessions — list sessions for a project.
async fn list_sessions(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let project = params
        .get("project")
        .ok_or(StatusCode::BAD_REQUEST)?
        .clone();

    let limit: i64 = params
        .get("limit")
        .and_then(|l| l.parse().ok())
        .unwrap_or(20);

    let conn = state
        .knowledge
        .get_conn(&project)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let conn_guard = conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut stmt = conn_guard
        .prepare(
            "SELECT id, agent_id, prompt, status, files_modified, commits, transcript,
                    started_at, ended_at, pinned
             FROM sessions
             ORDER BY started_at DESC
             LIMIT ?1",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let sessions: Vec<serde_json::Value> = stmt
        .query_map(rusqlite::params![limit], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "agent_id": row.get::<_, String>(1)?,
                "prompt": row.get::<_, Option<String>>(2)?,
                "status": row.get::<_, String>(3)?,
                "files_modified": row.get::<_, Option<String>>(4)?,
                "commits": row.get::<_, Option<String>>(5)?,
                "transcript": row.get::<_, Option<String>>(6)?,
                "started_at": row.get::<_, String>(7)?,
                "ended_at": row.get::<_, Option<String>>(8)?,
                "pinned": row.get::<_, bool>(9)?,
            }))
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(Json(serde_json::json!({ "sessions": sessions })))
}

/// POST /api/sessions — capture a completed session.
async fn create_session(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let project = body["project"]
        .as_str()
        .ok_or(StatusCode::BAD_REQUEST)?;

    let session_id = body["id"]
        .as_str()
        .ok_or(StatusCode::BAD_REQUEST)?;

    let agent_id = body["agent_id"]
        .as_str()
        .ok_or(StatusCode::BAD_REQUEST)?;

    let prompt = body["prompt"].as_str();

    let status = body["status"]
        .as_str()
        .ok_or(StatusCode::BAD_REQUEST)?;

    let files_modified: Vec<String> = body["files_modified"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let commits: Vec<String> = body["commits"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let transcript = body["transcript"].as_str();

    let started_at = body["started_at"]
        .as_str()
        .ok_or(StatusCode::BAD_REQUEST)?;

    let ended_at = body["ended_at"]
        .as_str()
        .unwrap_or("");

    let conn = state
        .knowledge
        .get_conn(project)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let conn_guard = conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Try to get embedding engine for session capture.
    let embedding_guard = state.knowledge.embedding.try_lock().ok();
    let embedding_ref = embedding_guard.as_deref();

    crate::knowledge::session_capture::capture_session(
        &conn_guard,
        session_id,
        agent_id,
        prompt,
        status,
        &files_modified,
        &commits,
        transcript,
        started_at,
        ended_at,
        embedding_ref,
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(serde_json::json!({ "stored": true })))
}

/// PUT /api/sessions/{id}/pin — pin a session.
async fn pin_session(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let project = params
        .get("project")
        .ok_or(StatusCode::BAD_REQUEST)?
        .clone();

    let conn = state
        .knowledge
        .get_conn(&project)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let conn_guard = conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    conn_guard
        .execute(
            "UPDATE sessions SET pinned = TRUE WHERE id = ?1",
            rusqlite::params![id],
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(serde_json::json!({ "pinned": true })))
}

/// POST /api/events — create an event (no auth — called by local processes).
async fn create_event(
    AxumState(state): AxumState<ApiState>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let project = match body["project"].as_str() {
        Some(p) => p,
        None => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "missing project" }))),
    };

    let from_agent = match body["from_agent"].as_str() {
        Some(a) => a,
        None => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "missing from_agent" }))),
    };

    let to_agent = body["to_agent"].as_str();
    let event_type = match body["event_type"].as_str() {
        Some(t) => t,
        None => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "missing event_type" }))),
    };

    let payload = body["payload"].to_string();
    let tab_id = body["tab_id"].as_str();

    let conn = match state.knowledge.get_conn(project).await {
        Ok(c) => c,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "db" }))),
    };

    let conn_guard = match conn.lock() {
        Ok(g) => g,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "lock" }))),
    };

    let result = conn_guard.execute(
        "INSERT INTO events (from_agent, to_agent, event_type, payload, tab_id) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![from_agent, to_agent, event_type, payload, tab_id],
    );

    match result {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({ "stored": true }))),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "insert failed" }))),
    }
}

/// GET /api/events — list events for a project.
async fn list_events(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let project = params
        .get("project")
        .ok_or(StatusCode::BAD_REQUEST)?
        .clone();

    let since: i64 = params
        .get("since")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let limit: i64 = params
        .get("limit")
        .and_then(|l| l.parse().ok())
        .unwrap_or(50);

    let conn = state
        .knowledge
        .get_conn(&project)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let conn_guard = conn.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut stmt = conn_guard
        .prepare(
            "SELECT seq, from_agent, to_agent, event_type, payload, tab_id, created_at
             FROM events
             WHERE seq > ?1
             ORDER BY seq ASC
             LIMIT ?2",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let events: Vec<serde_json::Value> = stmt
        .query_map(rusqlite::params![since, limit], |row| {
            Ok(serde_json::json!({
                "seq": row.get::<_, i64>(0)?,
                "from_agent": row.get::<_, String>(1)?,
                "to_agent": row.get::<_, Option<String>>(2)?,
                "event_type": row.get::<_, String>(3)?,
                "payload": row.get::<_, String>(4)?,
                "tab_id": row.get::<_, Option<String>>(5)?,
                "created_at": row.get::<_, String>(6)?,
            }))
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(Json(serde_json::json!({ "events": events })))
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
    knowledge: Arc<crate::knowledge::KnowledgeEngine>,
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
        knowledge,
    };

    let cors = CorsLayer::new()
        .allow_origin([
            "http://localhost:1420".parse().unwrap(),
            "tauri://localhost".parse().unwrap(),
        ])
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::PUT,
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
        .route("/api/agents/{id}/dormant", post(dormant_handler))
        .route("/api/agents/{id}/reanimate", post(reanimate_handler))
        // Hooks (no auth — called by local processes)
        .route("/api/hooks/status", post(hook_status))
        .route("/api/hooks/output", post(hook_output))
        // Knowledge Layer — Code Intelligence
        .route("/api/code/repo-map", get(code_repo_map))
        .route("/api/code/outline", get(code_outline))
        .route("/api/code/references", get(code_references))
        // Knowledge Layer — Unified Search
        .route("/api/knowledge/search", get(knowledge_search))
        // Knowledge Layer — Sessions
        .route("/api/sessions", get(list_sessions).post(create_session))
        .route("/api/sessions/{id}/pin", put(pin_session))
        // Knowledge Layer — Events
        .route("/api/events", get(list_events).post(create_event))
        // WebSocket endpoints
        .route("/ws/events", get(ws_events_handler))
        .route("/ws/pty/{agent_id}", get(ws_pty_handler))
        .with_state(api_state)
        .layer(cors);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:31415")
        .await
        .expect("failed to bind API server to 127.0.0.1:31415");

    eprintln!("[api_server] API server listening on 127.0.0.1:31415");

    axum::serve(listener, app).await.expect("API server error");
}
