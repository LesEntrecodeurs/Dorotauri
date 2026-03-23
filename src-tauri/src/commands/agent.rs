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

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentPayload {
    pub id: AgentId,
    pub project_path: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub character: Option<String>,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub skip_permissions: bool,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub local_model: Option<String>,
    #[serde(default)]
    pub obsidian_vault_paths: Option<Vec<String>>,
}

#[tauri::command]
pub fn agent_create(
    payload: CreateAgentPayload,
    state: State<'_, AppState>,
) -> Result<AgentStatus, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let agent = AgentStatus {
        id: payload.id.clone(),
        status: AgentState::Idle,
        project_path: payload.project_path,
        secondary_project_path: None,
        worktree_path: None,
        branch_name: None,
        skills: payload.skills,
        current_task: None,
        output: Vec::new(),
        last_activity: now,
        error: None,
        pty_id: None,
        character: payload.character,
        name: payload.name,
        skip_permissions: payload.skip_permissions,
        provider: payload.provider,
        status_line: None,
        last_clean_output: None,
        local_model: payload.local_model,
        kanban_task_id: None,
        current_session_id: None,
        path_missing: false,
        obsidian_vault_paths: payload.obsidian_vault_paths,
    };

    {
        let mut agents = state.agents.lock().unwrap();
        agents.insert(payload.id, agent.clone());
    }
    state.save_agents();

    Ok(agent)
}

// ---------------------------------------------------------------------------
// agent_start — spawn a PTY, build CLI command, mark as running
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentPayload {
    pub id: AgentId,
    #[serde(default)]
    pub prompt: Option<String>,
}

#[tauri::command]
pub fn agent_start(
    payload: StartAgentPayload,
    state: State<'_, AppState>,
    pty_manager: State<'_, PtyManager>,
    app_handle: AppHandle,
) -> Result<AgentStatus, String> {
    let pty_id = uuid::Uuid::new_v4().to_string();

    // Get a snapshot of the agent (release lock quickly)
    let agent_snapshot = {
        let agents = state.agents.lock().unwrap();
        agents
            .get(&payload.id)
            .cloned()
            .ok_or_else(|| format!("agent not found: {}", payload.id))?
    };

    // Spawn PTY in the agent's project directory
    pty_manager.spawn(&pty_id, &agent_snapshot.id, &agent_snapshot.project_path, &app_handle)?;

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
    if let Some(ref prompt) = payload.prompt {
        cmd_parts.push("--print".into());
        // Shell-escape the prompt by wrapping in single quotes
        let escaped = prompt.replace('\'', "'\\''");
        cmd_parts.push(format!("'{escaped}'"));
    }

    let cmd_string = cmd_parts.join(" ");

    // Write command to PTY (with newline to execute)
    pty_manager.write(&pty_id, format!("{cmd_string}\n").as_bytes())?;

    // Update agent state
    let now = chrono::Utc::now().to_rfc3339();
    let updated_agent = {
        let mut agents = state.agents.lock().unwrap();
        if let Some(agent) = agents.get_mut(&payload.id) {
            agent.status = AgentState::Running;
            agent.pty_id = Some(pty_id);
            agent.last_activity = now;
            agent.error = None;
            if payload.prompt.is_some() {
                agent.current_task = payload.prompt;
            }
            agent.clone()
        } else {
            return Err(format!("agent disappeared: {}", payload.id));
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

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentPayload {
    pub id: AgentId,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub character: Option<String>,
    #[serde(default)]
    pub skills: Option<Vec<String>>,
    #[serde(default)]
    pub skip_permissions: Option<bool>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub local_model: Option<String>,
    #[serde(default)]
    pub project_path: Option<String>,
    #[serde(default)]
    pub obsidian_vault_paths: Option<Vec<String>>,
}

#[tauri::command]
pub fn agent_update(
    payload: UpdateAgentPayload,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<AgentStatus, String> {
    let now = chrono::Utc::now().to_rfc3339();

    let updated_agent = {
        let mut agents = state.agents.lock().unwrap();
        let agent = agents
            .get_mut(&payload.id)
            .ok_or_else(|| format!("agent not found: {}", payload.id))?;

        if let Some(name) = payload.name {
            agent.name = Some(name);
        }
        if let Some(character) = payload.character {
            agent.character = Some(character);
        }
        if let Some(skills) = payload.skills {
            agent.skills = skills;
        }
        if let Some(skip) = payload.skip_permissions {
            agent.skip_permissions = skip;
        }
        if let Some(provider) = payload.provider {
            agent.provider = Some(provider);
        }
        if let Some(local_model) = payload.local_model {
            agent.local_model = Some(local_model);
        }
        if let Some(project_path) = payload.project_path {
            agent.project_path = project_path;
        }
        if let Some(vault_paths) = payload.obsidian_vault_paths {
            agent.obsidian_vault_paths = Some(vault_paths);
        }

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
