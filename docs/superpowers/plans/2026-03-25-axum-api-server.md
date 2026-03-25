# Axum API Server for Super Agent MCP Orchestration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an axum HTTP server inside Tauri to expose agent management REST API on `127.0.0.1:31415`, enabling the existing MCP orchestrator to control agents — making Super Agents functional.

**Architecture:** Axum server runs in Tauri's tokio runtime, sharing `AppState` and `PtyManager` via `Arc`. Bearer token auth from `~/.dorotoring/api-token`. Long-poll via `tokio::sync::broadcast`. `agent_start` modified to pass `--mcp-config` for Super Agents.

**Tech Stack:** Rust, axum 0.8, tower-http (cors), tokio broadcast, serde_json

**Spec:** Design approved in conversation (no separate spec file)

---

## File Structure

### Files to create
- `src-tauri/src/api_server.rs` — axum server: router, auth middleware, all route handlers, broadcast channel for status changes

### Files to modify
- `src-tauri/Cargo.toml` — add `axum`, `tower-http` dependencies
- `src-tauri/src/lib.rs` — start API server in `setup()`, add `pub mod api_server`
- `src-tauri/src/commands/agent.rs` — modify `agent_start` to add `--mcp-config` for Super Agents; emit status broadcast on state changes
- `src-tauri/src/state.rs` — add `StatusBroadcast` type alias and field to `AppState`

---

## Task 1: Add Dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add axum and tower-http to Cargo.toml**

Add after the existing dependencies:

```toml
axum = "0.8"
tower-http = { version = "0.6", features = ["cors"] }
```

- [ ] **Step 2: Verify compilation**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: no errors (warnings OK)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "chore: add axum and tower-http dependencies"
```

---

## Task 2: Add Status Broadcast to AppState

**Files:**
- Modify: `src-tauri/src/state.rs`

- [ ] **Step 1: Add broadcast channel type to AppState**

At the top of `state.rs`, add the import and type alias:

```rust
use tokio::sync::broadcast;

pub type StatusTx = broadcast::Sender<(String, String)>; // (agent_id, new_process_state)
```

Add a new field to `AppState`:

```rust
pub struct AppState {
    // ... existing fields ...
    #[serde(skip)]
    pub status_tx: StatusTx,
}
```

Note: `AppState` is not derived with Serialize/Deserialize itself — it's constructed manually in `AppState::load()`. So `#[serde(skip)]` is not needed. Just add the field directly.

In the `AppState::load()` constructor, create the broadcast channel:

```rust
let (status_tx, _) = broadcast::channel::<(String, String)>(64);
```

And include it in the returned struct:

```rust
AppState {
    // ... existing fields ...
    status_tx,
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/state.rs
git commit -m "feat(state): add broadcast channel for agent status changes"
```

---

## Task 3: Emit Status Broadcasts from Agent Commands

**Files:**
- Modify: `src-tauri/src/commands/agent.rs`

- [ ] **Step 1: Emit broadcast on agent state transitions**

In every command that changes `agent.process_state`, add a broadcast after the state change:

```rust
let _ = state.status_tx.send((id.clone(), format!("{:?}", agent.process_state)));
```

Add this after state changes in:
- `agent_start` — after setting `ProcessState::Running`
- `agent_stop` — after setting `ProcessState::Inactive`
- `agent_set_dormant` — after setting `ProcessState::Dormant`
- `agent_update` — after the `statusLine` update block (which may change business state)

Also in the hooks handler (to be added in Task 4) — when `/api/hooks/status` changes state.

- [ ] **Step 2: Modify `agent_start` for Super Agent MCP config**

In `agent_start`, after the `skip_permissions` flag block (around line 190), add:

```rust
// Super Agent: add MCP config so Claude Code has orchestrator tools
if agent_snapshot.is_super_agent {
    let mcp_config = dirs::home_dir()
        .unwrap_or_default()
        .join(".claude")
        .join("mcp.json");
    if mcp_config.exists() {
        cmd_parts.push("--mcp-config".into());
        cmd_parts.push(mcp_config.to_string_lossy().to_string());
    }
}

// Super Agent: add secondary paths (--add-dir) for team visibility
for path in &agent_snapshot.secondary_paths {
    cmd_parts.push("--add-dir".into());
    cmd_parts.push(path.clone());
}
```

- [ ] **Step 3: Verify compilation**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/agent.rs
git commit -m "feat(agent): emit status broadcasts, add --mcp-config for Super Agents"
```

---

## Task 4: Create the Axum API Server

**Files:**
- Create: `src-tauri/src/api_server.rs`

This is the main task. The API server exposes routes that the MCP orchestrator calls via HTTP.

- [ ] **Step 1: Create `api_server.rs` with shared state and auth**

```rust
use axum::{
    Router,
    routing::{get, post, delete},
    extract::{Path, Query, State as AxumState},
    http::{StatusCode, HeaderMap},
    response::Json,
    middleware,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::broadcast;

use crate::state::{AppState, Agent, ProcessState};
use crate::pty::PtyManager;
use crate::cwd_tracker::CwdTracker;

/// Shared state passed to all axum handlers
#[derive(Clone)]
pub struct ApiState {
    pub app_state: Arc<AppState>,
    pub pty_manager: Arc<PtyManager>,
    pub cwd_tracker: Arc<CwdTracker>,
}
```

Note: `AppState`, `PtyManager`, and `CwdTracker` are already managed by Tauri. We need to extract `Arc` references from Tauri state to share with axum. This is done in `lib.rs` setup.

However, Tauri's `.manage()` wraps in its own `State<>` wrapper. To share with axum, we need to wrap our state structs in `Arc` **before** passing to both Tauri and axum. This requires modifying `lib.rs` to create `Arc<AppState>`, `Arc<PtyManager>`, etc.

Actually, looking at the existing code, `AppState` fields like `agents` are already `Arc<Mutex<...>>`. And Tauri's `State` is essentially an `Arc` wrapper. The cleanest approach: in `lib.rs` setup, extract the inner `Arc` from Tauri state and pass it to the API server.

For the API server, we'll accept `Arc<AppState>` etc. directly since the axum server starts in setup where we have access to the raw values.

- [ ] **Step 2: Implement auth middleware**

Bearer token from `~/.dorotoring/api-token`:

```rust
/// Read the API token from disk
fn read_api_token() -> Option<String> {
    let path = dirs::home_dir()?.join(".dorotoring").join("api-token");
    std::fs::read_to_string(path).ok().map(|s| s.trim().to_string())
}

/// Generate and save a new API token
fn ensure_api_token() -> String {
    let dir = dirs::home_dir().unwrap().join(".dorotoring");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("api-token");

    if let Ok(token) = std::fs::read_to_string(&path) {
        let token = token.trim().to_string();
        if token.len() >= 32 {
            return token;
        }
    }

    let token: String = (0..32)
        .map(|_| format!("{:02x}", rand::random::<u8>()))
        .collect();
    let _ = std::fs::write(&path, &token);
    token
}

/// Check auth header — returns true if valid or if path is exempt
fn check_auth(headers: &HeaderMap, token: &str, path: &str) -> bool {
    // Exempt paths
    if path == "/api/health" || path.starts_with("/api/hooks/") {
        return true;
    }
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.strip_prefix("Bearer ").unwrap_or("") == token)
        .unwrap_or(false)
}
```

Actually, using axum middleware for auth is cleaner. But for simplicity, we'll check auth inline in each handler, or use a simple layer. Let's use an axum middleware layer:

```rust
async fn auth_layer(
    AxumState(api_token): AxumState<String>,
    req: axum::http::Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let path = req.uri().path().to_string();

    // Exempt paths
    if path == "/api/health" || path.starts_with("/api/hooks/") {
        return next.run(req).await;
    }

    let authorized = req.headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.strip_prefix("Bearer ").unwrap_or("") == api_token)
        .unwrap_or(false);

    if authorized {
        next.run(req).await
    } else {
        (StatusCode::UNAUTHORIZED, "Unauthorized").into_response()
    }
}
```

- [ ] **Step 3: Implement route handlers**

Each handler maps to the Electron API routes that the MCP orchestrator calls:

**GET /api/health**
```rust
async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true }))
}
```

**GET /api/agents**
```rust
async fn list_agents(AxumState(state): AxumState<ApiState>) -> Json<serde_json::Value> {
    let agents = state.app_state.agents.lock().unwrap();
    let list: Vec<&Agent> = agents.values().collect();
    Json(serde_json::json!({ "agents": list }))
}
```

**GET /api/agents/:id**
```rust
async fn get_agent(
    AxumState(state): AxumState<ApiState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let agents = state.app_state.agents.lock().unwrap();
    match agents.get(&id) {
        Some(agent) => Ok(Json(serde_json::json!({ "agent": agent }))),
        None => Err(StatusCode::NOT_FOUND),
    }
}
```

**GET /api/agents/:id/output**
```rust
#[derive(Deserialize)]
struct OutputQuery { lines: Option<usize> }

async fn get_agent_output(
    AxumState(state): AxumState<ApiState>,
    Path(id): Path<String>,
    Query(q): Query<OutputQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let agents = state.app_state.agents.lock().unwrap();
    let agent = agents.get(&id).ok_or(StatusCode::NOT_FOUND)?;
    let lines = q.lines.unwrap_or(100);
    let output: Vec<&String> = agent.output.iter().rev().take(lines).collect();
    let output: Vec<&String> = output.into_iter().rev().collect();
    let status = format!("{:?}", agent.process_state).to_lowercase();
    Ok(Json(serde_json::json!({
        "output": output.join(""),
        "status": status,
        "lastCleanOutput": agent.status_line,
    })))
}
```

**GET /api/agents/:id/wait** (long-poll)
```rust
#[derive(Deserialize)]
struct WaitQuery { timeout: Option<u64> }

async fn wait_for_agent(
    AxumState(state): AxumState<ApiState>,
    Path(id): Path<String>,
    Query(q): Query<WaitQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let timeout_secs = q.timeout.unwrap_or(300);

    // Check if agent is already in terminal state
    {
        let agents = state.app_state.agents.lock().unwrap();
        let agent = agents.get(&id).ok_or(StatusCode::NOT_FOUND)?;
        match agent.process_state {
            ProcessState::Completed | ProcessState::Error | ProcessState::Dormant => {
                let status = format!("{:?}", agent.process_state).to_lowercase();
                return Ok(Json(serde_json::json!({
                    "status": status,
                    "lastCleanOutput": agent.status_line,
                    "error": agent.error,
                })));
            }
            _ => {}
        }
    }

    // Subscribe to broadcast and wait for this agent's status change
    let mut rx = state.app_state.status_tx.subscribe();
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        async {
            loop {
                if let Ok((agent_id, _)) = rx.recv().await {
                    if agent_id == id {
                        let agents = state.app_state.agents.lock().unwrap();
                        if let Some(agent) = agents.get(&id) {
                            let status = format!("{:?}", agent.process_state).to_lowercase();
                            return serde_json::json!({
                                "status": status,
                                "lastCleanOutput": agent.status_line,
                                "error": agent.error,
                            });
                        }
                    }
                }
            }
        },
    ).await;

    match result {
        Ok(val) => Ok(Json(val)),
        Err(_) => Ok(Json(serde_json::json!({ "timeout": true }))),
    }
}
```

**POST /api/agents**
```rust
async fn create_agent(
    AxumState(state): AxumState<ApiState>,
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "/".to_string());

    let cwd = body.get("projectPath")
        .or(body.get("cwd"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(&home)
        .to_string();

    let agent = Agent {
        id: id.clone(),
        process_state: ProcessState::Inactive,
        cwd,
        name: body.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
        character: body.get("character").and_then(|v| v.as_str()).map(|s| s.to_string()),
        skills: body.get("skills").and_then(|v| serde_json::from_value(v.clone()).ok()).unwrap_or_default(),
        skip_permissions: body.get("skipPermissions").and_then(|v| v.as_bool()).unwrap_or(false),
        tab_id: "general".to_string(),
        last_activity: now.clone(),
        created_at: now,
        ..Agent::default()
    };

    state.app_state.agents.lock().unwrap().insert(id, agent.clone());
    state.app_state.save_agents();
    Json(serde_json::json!({ "agent": agent }))
}
```

**POST /api/agents/:id/start**
```rust
async fn start_agent(
    AxumState(state): AxumState<ApiState>,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let prompt = body.get("prompt").and_then(|v| v.as_str()).map(|s| s.to_string());

    // Check if agent exists and is already running — send as message instead
    {
        let agents = state.app_state.agents.lock().unwrap();
        let agent = agents.get(&id).ok_or(StatusCode::NOT_FOUND)?;
        if matches!(agent.process_state, ProcessState::Running | ProcessState::Waiting) {
            if let (Some(pty_id), Some(prompt)) = (&agent.pty_id, &prompt) {
                let _ = state.pty_manager.write(pty_id, format!("{}\n", prompt).as_bytes());
                return Ok(Json(serde_json::json!({ "success": true, "agent": agent })));
            }
        }
    }

    let pty_id = uuid::Uuid::new_v4().to_string();

    let agent_snapshot = {
        let agents = state.app_state.agents.lock().unwrap();
        agents.get(&id).cloned().ok_or(StatusCode::NOT_FOUND)?
    };

    // Spawn PTY
    // Note: PtyManager::spawn requires AppHandle — we don't have one in axum.
    // Instead, we write the command to an existing PTY or create one via a different path.
    // For the API, agents should already have a PTY (created by the frontend).
    // If no PTY, we need to spawn one. But spawn() requires AppHandle for events.
    // Solution: store AppHandle in ApiState.
    //
    // This is handled in the actual implementation — see Step 4 below.

    todo!("Implemented in step 4")
}
```

Actually, the `start_agent` route needs `AppHandle` for PTY spawn (to emit events to frontend). Let's add it to `ApiState`.

**POST /api/agents/:id/stop**
```rust
async fn stop_agent(
    AxumState(state): AxumState<ApiState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut agents = state.app_state.agents.lock().unwrap();
    let agent = agents.get_mut(&id).ok_or(StatusCode::NOT_FOUND)?;

    if let Some(pty_id) = agent.pty_id.take() {
        state.cwd_tracker.unregister(&pty_id);
        let _ = state.pty_manager.kill(&pty_id);
    }
    agent.process_state = ProcessState::Inactive;
    agent.last_activity = chrono::Utc::now().to_rfc3339();
    let agent_clone = agent.clone();
    drop(agents);

    state.app_state.save_agents();
    let _ = state.app_state.status_tx.send((id, "inactive".into()));
    Ok(Json(serde_json::json!({ "success": true, "agent": agent_clone })))
}
```

**POST /api/agents/:id/message**
```rust
async fn send_message(
    AxumState(state): AxumState<ApiState>,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let message = body.get("message").and_then(|v| v.as_str()).ok_or(StatusCode::BAD_REQUEST)?;

    let agents = state.app_state.agents.lock().unwrap();
    let agent = agents.get(&id).ok_or(StatusCode::NOT_FOUND)?;
    let pty_id = agent.pty_id.as_ref().ok_or(StatusCode::BAD_REQUEST)?;

    state.pty_manager.write(pty_id, format!("{}\n", message).as_bytes())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(serde_json::json!({ "success": true })))
}
```

**DELETE /api/agents/:id**
```rust
async fn delete_agent(
    AxumState(state): AxumState<ApiState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut agents = state.app_state.agents.lock().unwrap();
    let agent = agents.remove(&id).ok_or(StatusCode::NOT_FOUND)?;

    if let Some(pty_id) = &agent.pty_id {
        state.cwd_tracker.unregister(pty_id);
        let _ = state.pty_manager.kill(pty_id);
    }
    drop(agents);

    state.app_state.save_agents();
    Ok(Json(serde_json::json!({ "success": true })))
}
```

**POST /api/hooks/status** (no auth)
```rust
async fn hook_status(
    AxumState(state): AxumState<ApiState>,
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let agent_id = body.get("agent_id").and_then(|v| v.as_str()).unwrap_or("");
    let status = body.get("status").and_then(|v| v.as_str()).unwrap_or("");

    let new_state = match status {
        "running" => Some(ProcessState::Running),
        "waiting" => Some(ProcessState::Waiting),
        "idle" | "completed" => Some(ProcessState::Completed),
        _ => None,
    };

    if let Some(new_state) = new_state {
        let mut agents = state.app_state.agents.lock().unwrap();
        if let Some(agent) = agents.get_mut(agent_id) {
            agent.process_state = new_state;
            agent.last_activity = chrono::Utc::now().to_rfc3339();

            if let Some(task) = body.get("current_task").and_then(|v| v.as_str()) {
                agent.business_state = Some(task.to_string());
            }
        }
        drop(agents);
        state.app_state.save_agents();
        let _ = state.app_state.status_tx.send((agent_id.to_string(), status.to_string()));
    }

    Json(serde_json::json!({ "success": true }))
}
```

**POST /api/hooks/output** (no auth)
```rust
async fn hook_output(
    AxumState(state): AxumState<ApiState>,
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let agent_id = body.get("agent_id").and_then(|v| v.as_str()).unwrap_or("");
    let output = body.get("output").and_then(|v| v.as_str()).unwrap_or("");

    let mut agents = state.app_state.agents.lock().unwrap();
    if let Some(agent) = agents.get_mut(agent_id) {
        agent.status_line = Some(output.to_string());
        agent.last_activity = chrono::Utc::now().to_rfc3339();
    }
    drop(agents);
    state.app_state.save_agents();

    Json(serde_json::json!({ "success": true }))
}
```

- [ ] **Step 4: Implement the `start_agent` handler with PTY spawn**

The `start_agent` API handler needs `AppHandle` for PTY events. Add `app_handle: AppHandle` to `ApiState`. The full implementation mirrors the Tauri `agent_start` command but is callable via HTTP.

```rust
/// ApiState now includes AppHandle
#[derive(Clone)]
pub struct ApiState {
    pub app_state: Arc<AppState>,
    pub pty_manager: Arc<PtyManager>,
    pub cwd_tracker: Arc<CwdTracker>,
    pub app_handle: AppHandle,
}
```

The `start_agent` handler:
1. If agent already has a PTY and is running → write prompt to PTY
2. If no PTY → spawn one, build CLI command (same logic as Tauri `agent_start`), write command
3. Update process_state to Running, emit broadcast

The CLI command building logic (provider selection, `--dangerously-skip-permissions`, `--mcp-config` for Super Agents, `--print` mode) should be extracted into a shared helper function that both the Tauri command and the API handler can call. Create this helper:

```rust
/// Build the CLI command string for launching an AI agent.
/// Used by both the Tauri agent_start command and the HTTP API start_agent handler.
pub fn build_agent_cli_command(
    agent: &Agent,
    prompt: Option<&str>,
    settings: &crate::state::AppSettings,
) -> String {
    let provider = agent.provider.as_deref().unwrap_or("claude");
    let cli_binary = match provider {
        "codex" => settings.cli_paths.codex.clone(),
        "gemini" => settings.cli_paths.gemini.clone(),
        "opencode" => settings.cli_paths.opencode.clone(),
        "pi" => settings.cli_paths.pi.clone(),
        "local" => settings.cli_paths.claude.clone(),
        _ => settings.cli_paths.claude.clone(),
    };

    let mut parts = vec![cli_binary];

    if agent.skip_permissions {
        match provider {
            "codex" => parts.push("--full-auto".into()),
            _ => parts.push("--dangerously-skip-permissions".into()),
        }
    }

    // Super Agent: add MCP config
    if agent.is_super_agent {
        let mcp_config = dirs::home_dir()
            .unwrap_or_default()
            .join(".claude")
            .join("mcp.json");
        if mcp_config.exists() {
            parts.push("--mcp-config".into());
            parts.push(mcp_config.to_string_lossy().to_string());
        }
    }

    // Secondary paths
    for path in &agent.secondary_paths {
        parts.push("--add-dir".into());
        parts.push(path.clone());
    }

    // Prompt
    if let Some(p) = prompt {
        parts.push("--print".into());
        let escaped = p.replace('\n', " ").replace('\'', "'\\''");
        parts.push(format!("'{escaped}'"));
    }

    parts.join(" ")
}
```

- [ ] **Step 5: Assemble the router and `start()` function**

```rust
pub async fn start(
    app_state: Arc<AppState>,
    pty_manager: Arc<PtyManager>,
    cwd_tracker: Arc<CwdTracker>,
    app_handle: AppHandle,
) {
    let api_token = ensure_api_token();

    let api_state = ApiState {
        app_state,
        pty_manager,
        cwd_tracker,
        app_handle,
    };

    let cors = tower_http::cors::CorsLayer::new()
        .allow_origin("http://localhost:1420".parse::<http::HeaderValue>().unwrap())
        .allow_methods([http::Method::GET, http::Method::POST, http::Method::DELETE, http::Method::OPTIONS])
        .allow_headers([http::header::CONTENT_TYPE, http::header::AUTHORIZATION]);

    let app = Router::new()
        // Health (no auth)
        .route("/api/health", get(health))
        // Hooks (no auth)
        .route("/api/hooks/status", post(hook_status))
        .route("/api/hooks/output", post(hook_output))
        // Agent routes (auth required — checked in handlers)
        .route("/api/agents", get(list_agents).post(create_agent))
        .route("/api/agents/{id}", get(get_agent).delete(delete_agent))
        .route("/api/agents/{id}/output", get(get_agent_output))
        .route("/api/agents/{id}/wait", get(wait_for_agent))
        .route("/api/agents/{id}/start", post(start_agent))
        .route("/api/agents/{id}/stop", post(stop_agent))
        .route("/api/agents/{id}/message", post(send_message))
        .layer(cors)
        .with_state(api_state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:31415")
        .await
        .expect("Failed to bind API server to port 31415");

    println!("[api] Server listening on http://127.0.0.1:31415");

    axum::serve(listener, app).await.ok();
}
```

Note: Auth is checked per-handler using the `api_token`. To keep it simple, store the token in `ApiState` and check in each authed handler. Or use axum middleware. The simplest approach: add `api_token: String` to `ApiState` and add a helper:

```rust
fn check_auth(headers: &HeaderMap, token: &str) -> Result<(), StatusCode> {
    let ok = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.strip_prefix("Bearer ").unwrap_or("") == token)
        .unwrap_or(false);
    if ok { Ok(()) } else { Err(StatusCode::UNAUTHORIZED) }
}
```

Each authed handler starts with:
```rust
check_auth(&headers, &state.api_token)?;
```

- [ ] **Step 6: Verify compilation**

Run: `cd src-tauri && cargo check 2>&1 | tail -10`

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/api_server.rs
git commit -m "feat(api): add axum HTTP server with agent management routes"
```

---

## Task 5: Wire API Server into Tauri Startup

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add module declaration and start server in setup**

Add `pub mod api_server;` to the module list.

In the `setup` closure, after the existing initialization, spawn the API server:

```rust
// Start the HTTP API server for MCP orchestrator
let api_app_state = Arc::new(app.state::<state::AppState>().inner().clone());
// Actually, we need the raw Arc, not cloned. Let's restructure.
```

The challenge: Tauri's `.manage()` takes ownership. We need `Arc` references for both Tauri and axum. Solution: create `Arc`s first, then `.manage()` the `Arc` (Tauri can manage any `Send + Sync + 'static`).

Refactor `lib.rs`:

```rust
pub fn run() {
    let app_state = Arc::new(state::AppState::load());
    let pty_manager = Arc::new(pty::PtyManager::new());
    let cwd_tracker = Arc::new(cwd_tracker::CwdTracker::new());
    // ... other state ...

    let api_app_state = Arc::clone(&app_state);
    let api_pty_manager = Arc::clone(&pty_manager);
    let api_cwd_tracker = Arc::clone(&cwd_tracker);

    tauri::Builder::default()
        .manage(app_state)      // Tauri wraps this in its own State<>
        .manage(pty_manager)
        .manage(cwd_tracker)
        // ...
        .setup(move |app| {
            let handle = app.handle().clone();

            // Start API server in background
            tokio::spawn(api_server::start(
                api_app_state,
                api_pty_manager,
                api_cwd_tracker,
                handle,
            ));

            // ... existing setup ...
            Ok(())
        })
```

Note: Tauri commands use `State<'_, AppState>` which extracts from the managed state. Since we're managing `Arc<AppState>`, the Tauri command signatures need to change to `State<'_, Arc<AppState>>`. OR we manage the raw AppState and use a separate clone for axum.

**Simpler approach:** Keep Tauri managing raw values. In setup, access them via `app.state::<T>()` which returns a reference, then create Arcs for axum from cloned data. But AppState contains `Arc<Mutex<...>>` fields internally, so cloning it shares the same underlying data. This works!

```rust
.setup(move |app| {
    // Share state with API server (AppState fields are Arc<Mutex<...>> internally)
    let api_state = Arc::new((*app.state::<state::AppState>().inner()).clone());
    let api_pty = Arc::new((*app.state::<pty::PtyManager>().inner()).clone());
    let api_cwd = Arc::new((*app.state::<cwd_tracker::CwdTracker>().inner()).clone());

    tokio::spawn(api_server::start(
        api_state,
        api_pty,
        api_cwd,
        app.handle().clone(),
    ));

    // ... rest of existing setup ...
})
```

Wait — `PtyManager` contains a `Mutex<HashMap<>>` which is NOT cloneable via `Clone` unless we derive it. Let's check.

Actually, the simplest approach: manage `Arc<T>` directly in Tauri. This requires updating Tauri command signatures from `State<'_, T>` to `State<'_, Arc<T>>`. The diff is mechanical.

**Final approach for lib.rs:**

1. Wrap all shared state in `Arc` before `.manage()`
2. Update Tauri command signatures to use `Arc<T>`
3. Pass `Arc::clone()` to both cwd tracker and API server

- [ ] **Step 2: Update Tauri command signatures**

In all files under `src-tauri/src/commands/`, change:
- `state: State<'_, AppState>` → `state: State<'_, Arc<AppState>>`
- `pty_manager: State<'_, PtyManager>` → `pty_manager: State<'_, Arc<PtyManager>>`
- `cwd_tracker: State<'_, CwdTracker>` → `cwd_tracker: State<'_, Arc<CwdTracker>>`

The usage remains the same since `State` derefs and `Arc` derefs — double deref works.

- [ ] **Step 3: Verify compilation**

Run: `cd src-tauri && cargo check 2>&1 | tail -10`

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/commands/
git commit -m "feat(api): wire axum server into Tauri startup, share state via Arc"
```

---

## Task 6: Build and Integration Test

**Files:** None (verification only)

- [ ] **Step 1: Full cargo build**

Run: `cd src-tauri && cargo build 2>&1 | tail -10`
Expected: compilation succeeds (warnings OK)

- [ ] **Step 2: Manual smoke test**

Launch the app: `cargo tauri dev`

In another terminal, test the API:

```bash
# Health check (no auth)
curl http://127.0.0.1:31415/api/health
# Expected: {"ok":true}

# Read token
TOKEN=$(cat ~/.dorotoring/api-token)

# List agents
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:31415/api/agents
# Expected: {"agents":[...]}

# Auth failure
curl http://127.0.0.1:31415/api/agents
# Expected: 401 Unauthorized
```

- [ ] **Step 3: Verify MCP orchestrator connectivity**

```bash
# Check MCP orchestrator is registered
cat ~/.claude/mcp.json | grep claude-mgr-orchestrator
```

If not registered, register manually:
```bash
claude mcp add -s user claude-mgr-orchestrator node /path/to/mcp-orchestrator/dist/bundle.js
```

- [ ] **Step 4: Test Super Agent flow**

1. Create a terminal in Dorothy, name it "Orchestrator"
2. Open ConfigWheel → enable Super Agent toggle
3. Launch `claude` in that terminal
4. Ask Claude to `list_agents` — should work via MCP orchestrator → HTTP API → Tauri

- [ ] **Step 5: Commit any fixes and tag**

```bash
git add -A
git commit -m "feat(api): axum API server for MCP orchestrator — Super Agent functional"
```
