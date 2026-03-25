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
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tower_http::cors::CorsLayer;

use crate::cwd_tracker::CwdTracker;
use crate::pty::PtyManager;
use crate::state::{Agent, AppSettings, AppState, ProcessState};

// ---------------------------------------------------------------------------
// ApiState — shared state for all route handlers
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct ApiState {
    pub app_state: Arc<AppState>,
    pub pty_manager: Arc<PtyManager>,
    pub cwd_tracker: Arc<CwdTracker>,
    pub app_handle: AppHandle,
    pub api_token: String,
}

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

/// Reads (or creates) the API token from ~/.dorotauri/api-token.
pub fn ensure_api_token() -> String {
    let dir = dirs::home_dir()
        .expect("could not determine home directory")
        .join(".dorotauri");
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
// Request / response types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct OutputQuery {
    lines: Option<usize>,
}

#[derive(Deserialize)]
struct WaitQuery {
    timeout: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateAgentBody {
    project_path: Option<String>,
    cwd: Option<String>,
    name: Option<String>,
    character: Option<String>,
    skills: Option<Vec<String>>,
    skip_permissions: Option<bool>,
    tab_id: Option<String>,
    provider: Option<String>,
    is_super_agent: Option<bool>,
    secondary_paths: Option<Vec<String>>,
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
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let agents: Vec<Agent> = {
        let agents = state.app_state.agents.lock().unwrap();
        agents.values().cloned().collect()
    };

    Ok(Json(serde_json::json!({ "agents": agents })))
}

async fn get_agent(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let agents = state.app_state.agents.lock().unwrap();
    let agent = agents.get(&id).cloned().ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(serde_json::json!({ "agent": agent })))
}

async fn get_agent_output(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<OutputQuery>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let agents = state.app_state.agents.lock().unwrap();
    let agent = agents.get(&id).cloned().ok_or(StatusCode::NOT_FOUND)?;
    drop(agents);

    let lines = query.lines.unwrap_or(100);
    let total = agent.output.len();
    let start = total.saturating_sub(lines);
    let output = agent.output[start..].join("\n");

    Ok(Json(serde_json::json!({
        "output": output,
        "status": format!("{:?}", agent.process_state).to_lowercase(),
        "lastCleanOutput": agent.status_line,
    })))
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
        let agents = state.app_state.agents.lock().unwrap();
        let agent = agents.get(&id).cloned().ok_or(StatusCode::NOT_FOUND)?;

        match agent.process_state {
            ProcessState::Completed | ProcessState::Error | ProcessState::Dormant => {
                return Ok(Json(serde_json::json!({
                    "status": format!("{:?}", agent.process_state).to_lowercase(),
                    "lastCleanOutput": agent.status_line,
                    "error": agent.error,
                })));
            }
            _ => {}
        }
    }

    // Subscribe to status broadcasts and wait for a matching event
    let mut rx = state.app_state.status_tx.subscribe();

    let result = tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), async {
        loop {
            match rx.recv().await {
                Ok((agent_id, _status)) if agent_id == id => {
                    let agents = state.app_state.agents.lock().unwrap();
                    if let Some(agent) = agents.get(&id) {
                        match agent.process_state {
                            ProcessState::Completed
                            | ProcessState::Error
                            | ProcessState::Dormant
                            | ProcessState::Inactive => {
                                return serde_json::json!({
                                    "status": format!("{:?}", agent.process_state).to_lowercase(),
                                    "lastCleanOutput": agent.status_line,
                                    "error": agent.error,
                                });
                            }
                            _ => continue,
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
    })
    .await;

    match result {
        Ok(value) => Ok(Json(value)),
        Err(_) => Ok(Json(serde_json::json!({ "timeout": true }))),
    }
}

async fn create_agent(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Json(body): Json<CreateAgentBody>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let now = chrono::Utc::now().to_rfc3339();
    let id = uuid::Uuid::new_v4().to_string();
    let cwd = body.cwd.or(body.project_path).unwrap_or_default();

    let agent = Agent {
        id: id.clone(),
        process_state: ProcessState::Inactive,
        cwd,
        secondary_paths: body.secondary_paths.unwrap_or_default(),
        name: body.name,
        character: body.character,
        skills: body.skills.unwrap_or_default(),
        skip_permissions: body.skip_permissions.unwrap_or(false),
        tab_id: body.tab_id.unwrap_or_else(|| "general".to_string()),
        provider: body.provider,
        is_super_agent: body.is_super_agent.unwrap_or(false),
        last_activity: now.clone(),
        created_at: now,
        ..Default::default()
    };

    {
        let mut agents = state.app_state.agents.lock().unwrap();
        agents.insert(id, agent.clone());
    }
    state.app_state.save_agents();

    Ok(Json(serde_json::json!({ "agent": agent })))
}

async fn start_agent(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<StartAgentBody>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let agent_snapshot = {
        let agents = state.app_state.agents.lock().unwrap();
        agents.get(&id).cloned().ok_or(StatusCode::NOT_FOUND)?
    };

    // If agent already running and has a PTY, write the prompt directly
    if agent_snapshot.process_state == ProcessState::Running {
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

    // Spawn a new PTY
    let pty_id = uuid::Uuid::new_v4().to_string();
    state
        .pty_manager
        .spawn(
            &pty_id,
            &agent_snapshot.id,
            &agent_snapshot.cwd,
            &state.app_handle,
            None,
            None,
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Register the shell PID with the cwd tracker
    if let Some(pid) = state.pty_manager.get_child_pid(&pty_id) {
        state.cwd_tracker.register(&pty_id, pid);
    }

    // Build and send the CLI command
    let settings = state.app_state.settings.lock().unwrap().clone();
    let cmd = build_cli_command(&agent_snapshot, body.prompt.as_deref(), &settings);
    state
        .pty_manager
        .write(&pty_id, format!("{cmd}\n").as_bytes())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Update agent state
    let now = chrono::Utc::now().to_rfc3339();
    let updated_agent = {
        let mut agents = state.app_state.agents.lock().unwrap();
        let agent = agents.get_mut(&id).ok_or(StatusCode::NOT_FOUND)?;
        agent.process_state = ProcessState::Running;
        agent.pty_id = Some(pty_id);
        agent.last_activity = now;
        agent.error = None;
        agent.clone()
    };

    state.app_state.save_agents();
    let _ = state
        .app_state
        .status_tx
        .send((id.clone(), "running".into()));
    state.app_handle.emit("agent:status", &updated_agent).ok();

    Ok(Json(serde_json::json!({ "agent": updated_agent })))
}

async fn stop_agent(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let now = chrono::Utc::now().to_rfc3339();

    let updated_agent = {
        let mut agents = state.app_state.agents.lock().unwrap();
        let agent = agents.get_mut(&id).ok_or(StatusCode::NOT_FOUND)?;

        // Kill PTY if one exists
        if let Some(ref pty_id) = agent.pty_id {
            state.cwd_tracker.unregister(pty_id);
            state.pty_manager.kill(pty_id).ok();
        }

        agent.process_state = ProcessState::Inactive;
        agent.pty_id = None;
        agent.last_activity = now;
        agent.clone()
    };

    state.app_state.save_agents();
    let _ = state
        .app_state
        .status_tx
        .send((id.clone(), "inactive".into()));
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

    let agents = state.app_state.agents.lock().unwrap();
    let agent = agents.get(&id).ok_or(StatusCode::NOT_FOUND)?;

    let pty_id = agent.pty_id.as_ref().ok_or(StatusCode::BAD_REQUEST)?;

    let msg = format!("{}\n", body.message);
    state
        .pty_manager
        .write(pty_id, msg.as_bytes())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn delete_agent(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let removed = {
        let mut agents = state.app_state.agents.lock().unwrap();
        agents.remove(&id)
    };

    if let Some(agent) = removed {
        if let Some(ref pty_id) = agent.pty_id {
            state.cwd_tracker.unregister(pty_id);
            state.pty_manager.kill(pty_id).ok();
        }
    }

    state.app_state.save_agents();

    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn hook_status(
    AxumState(state): AxumState<ApiState>,
    Json(body): Json<HookStatusBody>,
) -> impl IntoResponse {
    let process_state = match body.status.as_str() {
        "running" => ProcessState::Running,
        "waiting" => ProcessState::Waiting,
        "idle" | "completed" => ProcessState::Completed,
        "error" => ProcessState::Error,
        "dormant" => ProcessState::Dormant,
        _ => ProcessState::Inactive,
    };

    let now = chrono::Utc::now().to_rfc3339();

    let updated = {
        let mut agents = state.app_state.agents.lock().unwrap();
        if let Some(agent) = agents.get_mut(&body.agent_id) {
            agent.process_state = process_state;
            agent.last_activity = now;
            Some(agent.clone())
        } else {
            None
        }
    };

    if let Some(ref agent) = updated {
        state.app_state.save_agents();
        let _ = state
            .app_state
            .status_tx
            .send((body.agent_id.clone(), body.status.clone()));
        state.app_handle.emit("agent:status", agent).ok();
    }

    Json(serde_json::json!({ "ok": updated.is_some() }))
}

async fn hook_output(
    AxumState(state): AxumState<ApiState>,
    Json(body): Json<HookOutputBody>,
) -> impl IntoResponse {
    let mut agents = state.app_state.agents.lock().unwrap();
    if let Some(agent) = agents.get_mut(&body.agent_id) {
        agent.status_line = Some(body.output.clone());
    }

    Json(serde_json::json!({ "ok": true }))
}

// ---------------------------------------------------------------------------
// CLI command builder
// ---------------------------------------------------------------------------

/// Build the full CLI command string for launching an agent.
///
/// Mirrors the logic in `commands::agent::agent_start`.
pub fn build_cli_command(agent: &Agent, prompt: Option<&str>, settings: &AppSettings) -> String {
    let provider = agent.provider.as_deref().unwrap_or("claude");

    let cli_binary = match provider {
        "codex" => settings.cli_paths.codex.clone(),
        "gemini" => settings.cli_paths.gemini.clone(),
        "opencode" => settings.cli_paths.opencode.clone(),
        "pi" => settings.cli_paths.pi.clone(),
        "local" => settings.cli_paths.claude.clone(), // Tasmania uses claude binary
        _ => settings.cli_paths.claude.clone(),
    };

    let mut cmd_parts = vec![cli_binary];

    if agent.skip_permissions {
        match provider {
            "codex" => cmd_parts.push("--full-auto".into()),
            _ => cmd_parts.push("--dangerously-skip-permissions".into()),
        }
    }

    // Always add MCP config so orchestrator tools are available to all agents
    {
        let mcp_config = dirs::home_dir()
            .unwrap_or_default()
            .join(".claude")
            .join("mcp.json");
        if mcp_config.exists() {
            cmd_parts.push("--mcp-config".into());
            cmd_parts.push(mcp_config.to_string_lossy().to_string());
        }
    }

    // Add secondary paths (--add-dir)
    for path in &agent.secondary_paths {
        cmd_parts.push("--add-dir".into());
        cmd_parts.push(path.clone());
    }

    // Add prompt if provided
    if let Some(p) = prompt {
        cmd_parts.push("--print".into());
        // Sanitize newlines to prevent breaking the shell command
        let p = p.replace('\n', " ");
        // Shell-escape the prompt by wrapping in single quotes
        let escaped = p.replace('\'', "'\\''");
        cmd_parts.push(format!("'{escaped}'"));
    }

    cmd_parts.join(" ")
}

// ---------------------------------------------------------------------------
// Server entry point
// ---------------------------------------------------------------------------

pub async fn start(
    app_state: Arc<AppState>,
    pty_manager: Arc<PtyManager>,
    cwd_tracker: Arc<CwdTracker>,
    app_handle: AppHandle,
) {
    let api_token = ensure_api_token();
    eprintln!("[api_server] API server starting on 127.0.0.1:31415");

    let api_state = ApiState {
        app_state,
        pty_manager,
        cwd_tracker,
        app_handle,
        api_token,
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
        .route("/api/agents/{id}/output", get(get_agent_output))
        .route("/api/agents/{id}/wait", get(wait_for_agent))
        .route("/api/agents/{id}/start", post(start_agent))
        .route("/api/agents/{id}/stop", post(stop_agent))
        .route("/api/agents/{id}/message", post(send_message))
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
