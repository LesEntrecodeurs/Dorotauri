use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

use crate::cwd_tracker::CwdTracker;
use crate::notifications;
use crate::pty::PtyManager;
use crate::state::{Agent, AgentId, AppState, ProcessState};
use crate::windows::WindowRegistry;

// ---------------------------------------------------------------------------
// agent_list — return all agents
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn agent_list(state: State<'_, Arc<AppState>>) -> Vec<Agent> {
    let agents = state.agents.lock().unwrap();
    agents.values().cloned().collect()
}

// ---------------------------------------------------------------------------
// agent_get — return a single agent by id
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn agent_get(id: AgentId, state: State<'_, Arc<AppState>>) -> Option<Agent> {
    let agents = state.agents.lock().unwrap();
    agents.get(&id).cloned()
}

// ---------------------------------------------------------------------------
// agent_create — create a new agent and persist
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn agent_create(
    config: serde_json::Value,
    state: State<'_, Arc<AppState>>,
) -> Result<Agent, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let secondary_paths: Vec<String> = config
        .get("secondaryProjectPath")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| vec![s.to_string()])
        .unwrap_or_default();

    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "/".to_string());

    let cwd = config
        .get("cwd")
        .or_else(|| config.get("projectPath"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or(home);

    let agent = Agent {
        id: id.clone(),
        process_state: ProcessState::Inactive,
        cwd,
        secondary_paths,
        role: None,
        worktree_path: None,
        branch_name: None,
        skills: config
            .get("skills")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default(),
        output: Vec::new(),
        last_activity: now.clone(),
        created_at: now,
        error: None,
        pty_id: None,
        character: config
            .get("character")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        name: config
            .get("name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        skip_permissions: config
            .get("skipPermissions")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        provider: config
            .get("provider")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        status_line: None,
        local_model: config
            .get("localModel")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        kanban_task_id: None,
        current_session_id: None,
        path_missing: None,
        obsidian_vault_paths: config
            .get("obsidianVaultPaths")
            .and_then(|v| serde_json::from_value(v.clone()).ok()),
        business_state: None,
        business_state_updated_by: None,
        business_state_updated_at: None,
        tab_id: config
            .get("tabId")
            .and_then(|v| v.as_str())
            .unwrap_or("general")
            .to_string(),
        is_super_agent: config
            .get("isSuperAgent")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        super_agent_scope: None,
        scheduled_task_ids: Vec::new(),
        automation_ids: Vec::new(),
    };

    {
        let mut agents = state.agents.lock().unwrap();
        agents.insert(id, agent.clone());
    }
    state.save_agents();

    Ok(agent)
}

// ---------------------------------------------------------------------------
// resolve_agent_cwd — resolve the working directory for an agent
// ---------------------------------------------------------------------------

/// Resolves the working directory for an agent.
/// If `branch_name` is set, ensures a git worktree exists for that branch
/// and returns its path. Falls back to `cwd` on any error.
fn resolve_agent_cwd(cwd: &str, branch_name: Option<&str>, agent_id: &str) -> String {
    let Some(branch) = branch_name else {
        return cwd.to_string();
    };

    let base = std::path::Path::new(cwd);
    let short_id = &agent_id[..agent_id.len().min(8)];
    let worktree_path = base
        .parent()
        .unwrap_or(base)
        .join(format!("{short_id}-worktree"));

    // If directory already exists, assume worktree is set up
    if worktree_path.exists() {
        return worktree_path.to_string_lossy().to_string();
    }

    // Try: git worktree add -b <branch> <path>
    let created = std::process::Command::new("git")
        .args([
            "worktree",
            "add",
            "-b",
            branch,
            worktree_path.to_str().unwrap_or("."),
        ])
        .current_dir(cwd)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if created {
        return worktree_path.to_string_lossy().to_string();
    }

    // Branch may already exist — try without -b
    let checked_out = std::process::Command::new("git")
        .args([
            "worktree",
            "add",
            worktree_path.to_str().unwrap_or("."),
            branch,
        ])
        .current_dir(cwd)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if checked_out {
        worktree_path.to_string_lossy().to_string()
    } else {
        // Not a git repo or other error — fall back to main cwd
        cwd.to_string()
    }
}

// ---------------------------------------------------------------------------
// agent_start — spawn a PTY, build CLI command, mark as running
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn agent_start(
    state: State<'_, Arc<AppState>>,
    pty_manager: State<'_, Arc<PtyManager>>,
    cwd_tracker: State<'_, Arc<CwdTracker>>,
    app_handle: AppHandle,
    id: String,
    prompt: Option<String>,
    options: Option<serde_json::Value>,
) -> Result<Agent, String> {
    let _ = &options; // reserved for future use (model, resume, etc.)
    let pty_id = uuid::Uuid::new_v4().to_string();

    // Get a snapshot of the agent (release lock quickly)
    let agent_snapshot = {
        let agents = state.agents.lock().unwrap();
        agents
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("agent not found: {}", id))?
    };

    // Spawn PTY in the agent's working directory (git worktree if branch_name is set)
    let resolved_cwd = resolve_agent_cwd(
        &agent_snapshot.cwd,
        agent_snapshot.branch_name.as_deref(),
        &agent_snapshot.id,
    );
    pty_manager.spawn(&pty_id, &agent_snapshot.id, &resolved_cwd, &app_handle, None, None)?;

    // Register the shell PID with the cwd tracker
    if let Some(pid) = pty_manager.get_child_pid(&pty_id) {
        cwd_tracker.register(&pty_id, pid);
    }

    // Build CLI command based on provider
    let settings = state.settings.lock().unwrap();
    let provider = agent_snapshot
        .provider
        .as_deref()
        .unwrap_or("claude");

    let cli_binary = match provider {
        "codex" => settings.cli_paths.codex.clone(),
        "gemini" => settings.cli_paths.gemini.clone(),
        "opencode" => settings.cli_paths.opencode.clone(),
        "pi" => settings.cli_paths.pi.clone(),
        "local" => settings.cli_paths.claude.clone(), // Tasmania uses claude binary
        _ => settings.cli_paths.claude.clone(),
    };
    drop(settings);

    // Build command string
    let mut cmd_parts = vec![cli_binary];

    if agent_snapshot.skip_permissions {
        // Different flags per provider
        match provider {
            "codex" => cmd_parts.push("--full-auto".into()),
            _ => cmd_parts.push("--dangerously-skip-permissions".into()),
        }
    }

    // Super Agent: add MCP config + orchestrator system prompt
    if agent_snapshot.is_super_agent {
        let mcp_config = dirs::home_dir()
            .unwrap_or_default()
            .join(".claude")
            .join("mcp.json");
        if mcp_config.exists() {
            cmd_parts.push("--mcp-config".into());
            cmd_parts.push(mcp_config.to_string_lossy().to_string());
        }
        if let Some(instructions_path) = crate::ensure_super_agent_instructions() {
            cmd_parts.push("--append-system-prompt-file".into());
            cmd_parts.push(instructions_path.to_string_lossy().to_string());
        }
    }

    // Add secondary paths (--add-dir)
    for path in &agent_snapshot.secondary_paths {
        cmd_parts.push("--add-dir".into());
        cmd_parts.push(path.clone());
    }

    // Add prompt if provided
    if let Some(ref p) = prompt {
        cmd_parts.push("--print".into());
        // Sanitize newlines to prevent breaking the shell command
        let p = p.replace('\n', " ");
        // Shell-escape the prompt by wrapping in single quotes
        let escaped = p.replace('\'', "'\\''");
        cmd_parts.push(format!("'{escaped}'"));
    }

    let cmd_string = cmd_parts.join(" ");

    // For tab-scoped super agents: export tab ID so MCP server can filter
    if agent_snapshot.is_super_agent
        && agent_snapshot.super_agent_scope.as_deref() == Some("tab")
    {
        let tab_id = &agent_snapshot.tab_id;
        pty_manager
            .write(&pty_id, format!("export DOROTORING_TAB_ID={tab_id}\n").as_bytes())?;
    }
    // Clear terminal before launching agent, then write command
    pty_manager.write(&pty_id, b"clear\n")?;
    pty_manager.write(&pty_id, format!("{cmd_string}\n").as_bytes())?;

    // Update agent state
    let now = chrono::Utc::now().to_rfc3339();
    let updated_agent = {
        let mut agents = state.agents.lock().unwrap();
        if let Some(agent) = agents.get_mut(&id) {
            agent.process_state = ProcessState::Running;
            agent.pty_id = Some(pty_id);
            agent.last_activity = now;
            agent.error = None;
            agent.clone()
        } else {
            return Err(format!("agent disappeared: {}", id));
        }
    };

    state.save_agents();
    let _ = state.status_tx.send((id.clone(), "running".into()));

    // Emit status event
    app_handle
        .emit("agent:status", &updated_agent)
        .ok();

    Ok(updated_agent)
}

// ---------------------------------------------------------------------------
// agent_stop — kill PTY, mark as dormant
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn agent_stop(
    id: AgentId,
    state: State<'_, Arc<AppState>>,
    pty_manager: State<'_, Arc<PtyManager>>,
    cwd_tracker: State<'_, Arc<CwdTracker>>,
    registry: State<'_, WindowRegistry>,
    app_handle: AppHandle,
) -> Result<Agent, String> {
    let now = chrono::Utc::now().to_rfc3339();

    let (updated_agent, was_running) = {
        let mut agents = state.agents.lock().unwrap();
        let agent = agents
            .get_mut(&id)
            .ok_or_else(|| format!("agent not found: {id}"))?;

        let was_running = agent.process_state == ProcessState::Running;

        // Kill PTY if one exists
        if let Some(ref pty_id) = agent.pty_id {
            cwd_tracker.unregister(pty_id);
            pty_manager.kill(pty_id).ok();
        }

        agent.process_state = ProcessState::Inactive;
        agent.pty_id = None;
        agent.last_activity = now;
        (agent.clone(), was_running)
    };

    state.save_agents();
    let _ = state.status_tx.send((id.clone(), "inactive".into()));

    app_handle
        .emit("agent:status", &updated_agent)
        .ok();

    // Send notification if agent was previously running
    if was_running {
        let agent_name = updated_agent
            .name
            .as_deref()
            .unwrap_or("Agent");
        notifications::notify_agent_event(
            &app_handle,
            &registry,
            &updated_agent.id,
            agent_name,
            "complete",
        );
    }

    Ok(updated_agent)
}

// ---------------------------------------------------------------------------
// agent_remove — remove agent, kill PTY if running
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn agent_remove(
    id: AgentId,
    state: State<'_, Arc<AppState>>,
    pty_manager: State<'_, Arc<PtyManager>>,
) -> Result<(), String> {
    let removed = {
        let mut agents = state.agents.lock().unwrap();
        agents.remove(&id)
    };

    if let Some(agent) = removed {
        if let Some(ref pty_id) = agent.pty_id {
            pty_manager.kill(pty_id).ok();
        }
    }

    state.save_agents();
    Ok(())
}

// ---------------------------------------------------------------------------
// agent_update — update mutable agent fields
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn agent_update(
    params: serde_json::Value,
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<serde_json::Value, String> {
    let now = chrono::Utc::now().to_rfc3339();

    let id = params
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing 'id' field".to_string())?
        .to_string();

    let updated_agent = {
        let mut agents = state.agents.lock().unwrap();
        let agent = agents
            .get_mut(&id)
            .ok_or_else(|| format!("agent not found: {}", id))?;

        if let Some(name) = params.get("name").and_then(|v| v.as_str()) {
            agent.name = Some(name.to_string());
        }
        if let Some(character) = params.get("character").and_then(|v| v.as_str()) {
            agent.character = Some(character.to_string());
        }
        if let Some(skills) = params.get("skills") {
            if let Ok(s) = serde_json::from_value::<Vec<String>>(skills.clone()) {
                agent.skills = s;
            }
        }
        if let Some(skip) = params.get("skipPermissions").and_then(|v| v.as_bool()) {
            agent.skip_permissions = skip;
        }
        if let Some(provider) = params.get("provider").and_then(|v| v.as_str()) {
            agent.provider = Some(provider.to_string());
        }
        if let Some(local_model) = params.get("localModel").and_then(|v| v.as_str()) {
            agent.local_model = Some(local_model.to_string());
        }
        // Support both old "projectPath" key and new "cwd" key for compatibility
        if let Some(cwd) = params.get("cwd").and_then(|v| v.as_str()) {
            agent.cwd = cwd.to_string();
        } else if let Some(project_path) = params.get("projectPath").and_then(|v| v.as_str()) {
            agent.cwd = project_path.to_string();
        }
        if let Some(secondary) = params.get("secondaryPaths") {
            if secondary.is_null() {
                agent.secondary_paths = Vec::new();
            } else if let Ok(paths) = serde_json::from_value::<Vec<String>>(secondary.clone()) {
                agent.secondary_paths = paths;
            }
        } else if let Some(secondary) = params.get("secondaryProjectPath") {
            // Legacy key support
            if secondary.is_null() {
                agent.secondary_paths = Vec::new();
            } else if let Some(s) = secondary.as_str() {
                agent.secondary_paths = vec![s.to_string()];
            }
        }
        if let Some(vault_paths) = params.get("obsidianVaultPaths") {
            if let Ok(vp) = serde_json::from_value::<Vec<String>>(vault_paths.clone()) {
                agent.obsidian_vault_paths = Some(vp);
            }
        }
        if let Some(branch_name) = params.get("branchName") {
            if branch_name.is_null() {
                agent.branch_name = None;
            } else if let Some(b) = branch_name.as_str() {
                agent.branch_name = if b.is_empty() { None } else { Some(b.to_string()) };
            }
        }
        if let Some(tab_id) = params.get("tabId").and_then(|v| v.as_str()) {
            agent.tab_id = tab_id.to_string();
        }
        if let Some(role) = params.get("role").and_then(|v| v.as_str()) {
            agent.role = Some(role.to_string());
        }
        if let Some(is_super) = params.get("isSuperAgent").and_then(|v| v.as_bool()) {
            agent.is_super_agent = is_super;
        }
        if let Some(scope) = params.get("superAgentScope") {
            if scope.is_null() {
                agent.super_agent_scope = None;
            } else if let Some(s) = scope.as_str() {
                agent.super_agent_scope = Some(s.to_string());
            }
        }
        if let Some(bs) = params.get("businessState").and_then(|v| v.as_str()) {
            agent.business_state = Some(bs.to_string());
        }
        if let Some(sl) = params.get("statusLine").and_then(|v| v.as_str()) {
            agent.status_line = Some(sl.to_string());

            // Only infer if Super Agent hasn't set a value in the last 60s
            let should_infer = match (&agent.business_state_updated_by, &agent.business_state_updated_at) {
                (Some(by), Some(at)) if by == "super_agent" => {
                    chrono::DateTime::parse_from_rfc3339(at)
                        .map(|t| chrono::Utc::now().signed_duration_since(t).num_seconds() > 60)
                        .unwrap_or(true)
                }
                _ => true,
            };

            if should_infer {
                if let Some(inferred) = crate::business_state::infer_business_state(sl) {
                    agent.business_state = Some(inferred);
                    agent.business_state_updated_by = Some("inference".to_string());
                    agent.business_state_updated_at = Some(chrono::Utc::now().to_rfc3339());
                }
            }
        }

        agent.last_activity = now;
        agent.clone()
    };

    state.save_agents();
    let _ = state.status_tx.send((id.clone(), "updated".into()));

    app_handle
        .emit("agent:status", &updated_agent)
        .ok();

    // Return { success: true, agent: Agent } as expected by the frontend
    Ok(serde_json::json!({
        "success": true,
        "agent": updated_agent,
    }))
}

// ---------------------------------------------------------------------------
// agent_set_dormant — called when a terminal is closed; sets agent to dormant
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn agent_set_dormant(
    id: AgentId,
    state: State<'_, Arc<AppState>>,
    pty_manager: State<'_, Arc<PtyManager>>,
    cwd_tracker: State<'_, Arc<CwdTracker>>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    {
        let mut agents = state.agents.lock().unwrap();
        let agent = agents.get_mut(&id).ok_or_else(|| format!("agent not found: {id}"))?;

        // Kill PTY if exists
        if let Some(ref pty_id) = agent.pty_id {
            cwd_tracker.unregister(pty_id);
            pty_manager.kill(pty_id).ok();
        }

        agent.process_state = ProcessState::Dormant;
        agent.pty_id = None;
        agent.last_activity = now;
    }
    state.save_agents();
    let _ = state.status_tx.send((id.clone(), "dormant".into()));
    app_handle.emit("agent:status", serde_json::json!({"id": id, "processState": "dormant"})).ok();
    Ok(())
}

// ---------------------------------------------------------------------------
// agent_reanimate — reopen a dormant agent by spawning a new PTY
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn agent_reanimate(
    id: AgentId,
    state: State<'_, Arc<AppState>>,
    pty_manager: State<'_, Arc<PtyManager>>,
    cwd_tracker: State<'_, Arc<CwdTracker>>,
    app_handle: AppHandle,
) -> Result<Agent, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let pty_id = uuid::Uuid::new_v4().to_string();

    // Get cwd, check if dormant
    let cwd = {
        let agents = state.agents.lock().unwrap();
        let agent = agents.get(&id).ok_or_else(|| format!("agent not found: {id}"))?;
        if agent.process_state != ProcessState::Dormant {
            return Err("Agent is not dormant".to_string());
        }
        // Fall back to home dir if cwd doesn't exist
        if std::path::Path::new(&agent.cwd).exists() {
            agent.cwd.clone()
        } else {
            dirs::home_dir().unwrap_or_default().to_string_lossy().to_string()
        }
    };

    // Spawn PTY
    pty_manager.spawn(&pty_id, &id, &cwd, &app_handle, None, None)?;

    // Register the shell PID with the cwd tracker
    if let Some(pid) = pty_manager.get_child_pid(&pty_id) {
        cwd_tracker.register(&pty_id, pid);
    }

    // Update agent
    let updated = {
        let mut agents = state.agents.lock().unwrap();
        let agent = agents.get_mut(&id).ok_or_else(|| format!("agent not found: {id}"))?;
        agent.process_state = ProcessState::Inactive;
        agent.pty_id = Some(pty_id);
        agent.last_activity = now;
        if !std::path::Path::new(&agent.cwd).exists() {
            agent.path_missing = Some(true);
        }
        agent.clone()
    };

    state.save_agents();
    app_handle.emit("agent:status", &updated).ok();
    Ok(updated)
}

// ---------------------------------------------------------------------------
// agent_update_business_state — Super Agent sets businessState explicitly
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn agent_update_business_state(
    id: AgentId,
    business_state: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    {
        let mut agents = state.agents.lock().unwrap();
        let agent = agents.get_mut(&id).ok_or_else(|| format!("agent not found: {id}"))?;
        agent.business_state = Some(business_state);
        agent.business_state_updated_by = Some("super_agent".to_string());
        agent.business_state_updated_at = Some(now);
    }
    state.save_agents();
    Ok(())
}

// ---------------------------------------------------------------------------
// agent_send_input — write raw text to an agent's PTY
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn agent_send_input(
    id: AgentId,
    input: String,
    state: State<'_, Arc<AppState>>,
    pty_manager: State<'_, Arc<PtyManager>>,
) -> Result<(), String> {
    let pty_id = {
        let agents = state.agents.lock().unwrap();
        let agent = agents
            .get(&id)
            .ok_or_else(|| format!("agent not found: {id}"))?;
        agent
            .pty_id
            .clone()
            .ok_or_else(|| format!("agent {id} has no active PTY"))?
    };

    pty_manager.write(&pty_id, input.as_bytes())
}

// ---------------------------------------------------------------------------
// agent_promote_super — promote to Super Agent and reload claude with MCP tools
// Sends /exit to gracefully quit the current claude session, then relaunches
// with --continue --mcp-config to resume the conversation with orchestrator tools.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn agent_promote_super(
    id: AgentId,
    scope: Option<String>,
    state: State<'_, Arc<AppState>>,
    pty_manager: State<'_, Arc<PtyManager>>,
) -> Result<Agent, String> {
    let (pty_id, was_running) = {
        let mut agents = state.agents.lock().unwrap();
        let agent = agents.get_mut(&id).ok_or_else(|| format!("agent not found: {id}"))?;
        agent.is_super_agent = true;
        agent.super_agent_scope = scope;
        agent.last_activity = chrono::Utc::now().to_rfc3339();
        let running = matches!(agent.process_state, ProcessState::Running | ProcessState::Waiting);
        (agent.pty_id.clone(), running)
    };
    state.save_agents();

    // If claude is running in the PTY, gracefully exit and relaunch with MCP
    if let Some(ref pty_id) = pty_id {
        if was_running {
            // Send /exit to quit claude gracefully
            let _ = pty_manager.write(pty_id, b"/exit\n");

            // Wait briefly for claude to exit, then relaunch
            let pty_mgr = pty_manager.inner().clone();
            let pty_id_clone = pty_id.clone();
            let state_clone = state.inner().clone();
            let agent_id = id.clone();

            std::thread::spawn(move || {
                // Give claude time to exit
                std::thread::sleep(std::time::Duration::from_secs(2));

                // Build relaunch command
                let settings = state_clone.settings.lock().unwrap().clone();
                let agents = state_clone.agents.lock().unwrap();
                let agent = match agents.get(&agent_id) {
                    Some(a) => a.clone(),
                    None => return,
                };
                drop(agents);

                let provider = agent.provider.as_deref().unwrap_or("claude");
                let cli_binary = match provider {
                    "codex" => settings.cli_paths.codex.clone(),
                    "gemini" => settings.cli_paths.gemini.clone(),
                    "opencode" => settings.cli_paths.opencode.clone(),
                    "pi" => settings.cli_paths.pi.clone(),
                    "local" => settings.cli_paths.claude.clone(),
                    _ => settings.cli_paths.claude.clone(),
                };

                let mut cmd_parts = vec![cli_binary];
                cmd_parts.push("--continue".into());

                if agent.skip_permissions {
                    match provider {
                        "codex" => cmd_parts.push("--full-auto".into()),
                        _ => cmd_parts.push("--dangerously-skip-permissions".into()),
                    }
                }

                // MCP config + orchestrator system prompt (the whole reason for the reload)
                let mcp_config = dirs::home_dir()
                    .unwrap_or_default()
                    .join(".claude")
                    .join("mcp.json");
                if mcp_config.exists() {
                    cmd_parts.push("--mcp-config".into());
                    cmd_parts.push(mcp_config.to_string_lossy().to_string());
                }
                if let Some(instructions_path) = crate::ensure_super_agent_instructions() {
                    cmd_parts.push("--append-system-prompt-file".into());
                    cmd_parts.push(instructions_path.to_string_lossy().to_string());
                }

                let cmd = cmd_parts.join(" ");
                // For tab-scoped super agents: export tab ID before relaunching
                if agent.is_super_agent && agent.super_agent_scope.as_deref() == Some("tab") {
                    let tab_id = &agent.tab_id;
                    let _ = pty_mgr.write(
                        &pty_id_clone,
                        format!("export DOROTORING_TAB_ID={tab_id}\n").as_bytes(),
                    );
                }
                let _ = pty_mgr.write(&pty_id_clone, format!("{cmd}\n").as_bytes());
            });
        }
    }

    let agents = state.agents.lock().unwrap();
    let agent = agents.get(&id).ok_or_else(|| format!("agent not found: {id}"))?;
    let _ = state.status_tx.send((id.clone(), "updated".into()));
    Ok(agent.clone())
}
