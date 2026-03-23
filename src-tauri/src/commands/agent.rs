use tauri::{AppHandle, Emitter, State};

use crate::pty::PtyManager;
use crate::state::{AgentId, AgentState, AgentStatus, AppState};

// ---------------------------------------------------------------------------
// agent_list — return all agents
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn agent_list(state: State<'_, AppState>) -> Vec<AgentStatus> {
    let agents = state.agents.lock().unwrap();
    agents.values().cloned().collect()
}

// ---------------------------------------------------------------------------
// agent_get — return a single agent by id
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn agent_get(id: AgentId, state: State<'_, AppState>) -> Option<AgentStatus> {
    let agents = state.agents.lock().unwrap();
    agents.get(&id).cloned()
}

// ---------------------------------------------------------------------------
// agent_create — create a new agent and persist
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn agent_create(
    config: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<AgentStatus, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let agent = AgentStatus {
        id: id.clone(),
        status: AgentState::Idle,
        project_path: config
            .get("projectPath")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        secondary_project_path: config
            .get("secondaryProjectPath")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        worktree_path: None,
        branch_name: None,
        skills: config
            .get("skills")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default(),
        current_task: None,
        output: Vec::new(),
        last_activity: now,
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
        last_clean_output: None,
        local_model: config
            .get("localModel")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        kanban_task_id: None,
        current_session_id: None,
        path_missing: false,
        obsidian_vault_paths: config
            .get("obsidianVaultPaths")
            .and_then(|v| serde_json::from_value(v.clone()).ok()),
    };

    {
        let mut agents = state.agents.lock().unwrap();
        agents.insert(id, agent.clone());
    }
    state.save_agents();

    Ok(agent)
}

// ---------------------------------------------------------------------------
// agent_start — spawn a PTY, build CLI command, mark as running
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn agent_start(
    state: State<'_, AppState>,
    pty_manager: State<'_, PtyManager>,
    app_handle: AppHandle,
    id: String,
    prompt: Option<String>,
    options: Option<serde_json::Value>,
) -> Result<AgentStatus, String> {
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

    // Spawn PTY in the agent's project directory
    pty_manager.spawn(&pty_id, &agent_snapshot.id, &agent_snapshot.project_path, &app_handle, None, None)?;

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

    // Add prompt if provided
    if let Some(ref p) = prompt {
        cmd_parts.push("--print".into());
        // Shell-escape the prompt by wrapping in single quotes
        let escaped = p.replace('\'', "'\\''");
        cmd_parts.push(format!("'{escaped}'"));
    }

    let cmd_string = cmd_parts.join(" ");

    // Write command to PTY (with newline to execute)
    pty_manager.write(&pty_id, format!("{cmd_string}\n").as_bytes())?;

    // Update agent state
    let now = chrono::Utc::now().to_rfc3339();
    let updated_agent = {
        let mut agents = state.agents.lock().unwrap();
        if let Some(agent) = agents.get_mut(&id) {
            agent.status = AgentState::Running;
            agent.pty_id = Some(pty_id);
            agent.last_activity = now;
            agent.error = None;
            if prompt.is_some() {
                agent.current_task = prompt;
            }
            agent.clone()
        } else {
            return Err(format!("agent disappeared: {}", id));
        }
    };

    state.save_agents();

    // Emit status event
    app_handle
        .emit("agent:status", &updated_agent)
        .ok();

    Ok(updated_agent)
}

// ---------------------------------------------------------------------------
// agent_stop — kill PTY, mark as idle
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn agent_stop(
    id: AgentId,
    state: State<'_, AppState>,
    pty_manager: State<'_, PtyManager>,
    app_handle: AppHandle,
) -> Result<AgentStatus, String> {
    let now = chrono::Utc::now().to_rfc3339();

    let updated_agent = {
        let mut agents = state.agents.lock().unwrap();
        let agent = agents
            .get_mut(&id)
            .ok_or_else(|| format!("agent not found: {id}"))?;

        // Kill PTY if one exists
        if let Some(ref pty_id) = agent.pty_id {
            pty_manager.kill(pty_id).ok();
        }

        agent.status = AgentState::Idle;
        agent.pty_id = None;
        agent.last_activity = now;
        agent.clone()
    };

    state.save_agents();

    app_handle
        .emit("agent:status", &updated_agent)
        .ok();

    Ok(updated_agent)
}

// ---------------------------------------------------------------------------
// agent_remove — remove agent, kill PTY if running
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn agent_remove(
    id: AgentId,
    state: State<'_, AppState>,
    pty_manager: State<'_, PtyManager>,
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
    state: State<'_, AppState>,
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
        if let Some(project_path) = params.get("projectPath").and_then(|v| v.as_str()) {
            agent.project_path = project_path.to_string();
        }
        if let Some(secondary) = params.get("secondaryProjectPath") {
            if secondary.is_null() {
                agent.secondary_project_path = None;
            } else if let Some(s) = secondary.as_str() {
                agent.secondary_project_path = Some(s.to_string());
            }
        }
        if let Some(vault_paths) = params.get("obsidianVaultPaths") {
            if let Ok(vp) = serde_json::from_value::<Vec<String>>(vault_paths.clone()) {
                agent.obsidian_vault_paths = Some(vp);
            }
        }

        agent.last_activity = now;
        agent.clone()
    };

    state.save_agents();

    app_handle
        .emit("agent:status", &updated_agent)
        .ok();

    // Return { success: true, agent: AgentStatus } as expected by the frontend
    Ok(serde_json::json!({
        "success": true,
        "agent": updated_agent,
    }))
}

// ---------------------------------------------------------------------------
// agent_send_input — write raw text to an agent's PTY
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn agent_send_input(
    id: AgentId,
    input: String,
    state: State<'_, AppState>,
    pty_manager: State<'_, PtyManager>,
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
