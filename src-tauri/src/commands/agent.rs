use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

use crate::agent::model::{
    Agent, AgentRole, AgentState, Provider, Scope,
};
use crate::agent::provider::{get_provider, AgentStartConfig};
use crate::cwd_tracker::CwdTracker;
use crate::notifications;
use crate::pty::PtyManager;
use crate::state::AppState;
use crate::windows::WindowRegistry;

// ---------------------------------------------------------------------------
// agent_list — return all agents (optionally filtered by tab)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn agent_list(
    state: State<'_, Arc<AppState>>,
    tab_id: Option<String>,
) -> Result<Vec<Agent>, String> {
    let agents = state.agent_manager.list(tab_id.as_ref()).await;
    Ok(agents)
}

// ---------------------------------------------------------------------------
// agent_get — return a single agent by id
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn agent_get(
    id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<Agent>, String> {
    Ok(state.agent_manager.get(&id).await)
}

// ---------------------------------------------------------------------------
// agent_create — create a new agent and persist
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn agent_create(
    config: serde_json::Value,
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<Agent, String> {
    let id = uuid::Uuid::new_v4().to_string();

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

    let tab_id = config
        .get("tabId")
        .and_then(|v| v.as_str())
        .unwrap_or("general")
        .to_string();

    let mut agent = Agent::new(id, cwd, tab_id);

    agent.name = config
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    agent.character = config
        .get("character")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    agent.skills = config
        .get("skills")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    agent.secondary_paths = config
        .get("secondaryProjectPath")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| vec![s.to_string()])
        .or_else(|| {
            config
                .get("secondaryPaths")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
        })
        .unwrap_or_default();

    agent.provider = Provider::from_str_opt(
        config.get("provider").and_then(|v| v.as_str()),
    );

    agent.parent_id = config
        .get("parentId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Handle super agent role
    let is_super = config
        .get("isSuperAgent")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if is_super {
        let scope = match config
            .get("superAgentScope")
            .and_then(|v| v.as_str())
        {
            Some("workspace") => Scope::Workspace,
            Some("global") => Scope::Global,
            _ => Scope::Tab,
        };
        agent.role = AgentRole::Super { scope };
    }

    // Store skip_permissions as a skills marker (new model doesn't have the field)
    let skip_permissions = config
        .get("skipPermissions")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if skip_permissions && !agent.skills.contains(&"__skip_permissions".to_string()) {
        agent.skills.push("__skip_permissions".to_string());
    }

    let created = state.agent_manager.create(agent).await;

    app_handle.emit("agent:status", &created).ok();

    Ok(created)
}

// ---------------------------------------------------------------------------
// resolve_agent_cwd — resolve the working directory for an agent
// ---------------------------------------------------------------------------

/// Resolves the working directory for an agent.
/// If the agent has a `__branch:<name>` skill marker, ensures a git worktree
/// exists for that branch and returns its path. Falls back to `cwd` on any error.
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
        cwd.to_string()
    }
}

// ---------------------------------------------------------------------------
// Helper: build start config and CLI command (shared by start and promote)
// ---------------------------------------------------------------------------

fn build_start_config(
    agent: &Agent,
    prompt: Option<&str>,
    skip_permissions: bool,
    continue_session: bool,
) -> AgentStartConfig {
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
        continue_session,
    }
}

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

fn build_cli_command(
    agent: &Agent,
    config: AgentStartConfig,
    settings: &crate::state::AppSettings,
) -> Vec<String> {
    let provider_impl = get_provider(&agent.provider);
    let cli_path = get_cli_path_for_provider(&agent.provider, settings);
    provider_impl.build_command(&config, Some(&cli_path))
}

// ---------------------------------------------------------------------------
// agent_start — spawn a PTY, build CLI command, mark as running
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn agent_start(
    state: State<'_, Arc<AppState>>,
    pty_manager: State<'_, Arc<PtyManager>>,
    cwd_tracker: State<'_, Arc<CwdTracker>>,
    app_handle: AppHandle,
    id: String,
    prompt: Option<String>,
    options: Option<serde_json::Value>,
) -> Result<Agent, String> {
    let _ = &options; // reserved for future use

    // Get a snapshot of the agent
    let agent_snapshot = state
        .agent_manager
        .get(&id)
        .await
        .ok_or_else(|| format!("agent not found: {}", id))?;

    // Reuse existing PTY if the UI already created one for this agent,
    // otherwise spawn a new one and register it so the UI can find it.
    let reused_pty;
    let pty_id = if let Some(existing) = pty_manager.lookup(&id) {
        reused_pty = true;
        existing
    } else {
        reused_pty = false;
        let new_id = uuid::Uuid::new_v4().to_string();
        // Spawn PTY in the agent's working directory
        let resolved_cwd = resolve_agent_cwd(
            &agent_snapshot.cwd,
            None, // branch_name not in new model — could be added later
            &agent_snapshot.id,
        );
        pty_manager.spawn(&new_id, &agent_snapshot.id, &resolved_cwd, &app_handle, None, None)?;

        // Register the shell PID with the cwd tracker
        if let Some(pid) = pty_manager.get_child_pid(&new_id) {
            cwd_tracker.register(&new_id, pid);
        }
        // Register so the UI's pty_lookup(agentId) finds this PTY
        pty_manager.register(&id, &new_id);
        new_id
    };

    // Build CLI command using provider trait
    let settings = state.settings.lock().unwrap().clone();
    let skip_permissions = agent_snapshot
        .skills
        .contains(&"__skip_permissions".to_string());

    let config = build_start_config(
        &agent_snapshot,
        prompt.as_deref(),
        skip_permissions,
        false,
    );
    let cmd = build_cli_command(&agent_snapshot, config, &settings);
    let cmd_string = cmd.join(" ");

    // Debug: log command to file for verification
    if let Some(log_path) = dirs::home_dir().map(|h| h.join(".dorotoring").join("agent-start.log"))
    {
        let line = format!(
            "[agent_start] id={} is_super_agent={} cmd={}\n",
            id,
            agent_snapshot.is_super_agent(),
            &cmd_string
        );
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map(|mut f| {
                use std::io::Write;
                f.write_all(line.as_bytes())
            });
    }

    // If reusing an existing PTY, the user may have manually started claude
    // in it. Send Ctrl-C to interrupt any foreground process and return to shell.
    if reused_pty {
        pty_manager.write(&pty_id, b"\x03\x03")?;
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }

    // Export agent ID so Claude Code hooks can report status back to Dorotoring
    pty_manager.write(&pty_id, format!("export DOROTORING_AGENT_ID={id}\n").as_bytes())?;

    // For tab-scoped super agents: export tab ID so MCP server can filter
    if agent_snapshot.is_super_agent() {
        if let Some(Scope::Tab) = agent_snapshot.scope() {
            let tab_id = &agent_snapshot.tab_id;
            pty_manager.write(
                &pty_id,
                format!("export DOROTORING_TAB_ID={tab_id}\n").as_bytes(),
            )?;
        }
    }

    // Clear terminal before launching agent, then write command
    pty_manager.write(&pty_id, b"clear\n")?;
    pty_manager.write(&pty_id, format!("{cmd_string}\n").as_bytes())?;

    // Update agent state to Running via AgentManager
    state
        .agent_manager
        .set_state(&id, AgentState::Running)
        .await
        .map_err(|e| format!("state transition failed: {e}"))?;

    // Update pty_id and clear error
    let updated_agent = state
        .agent_manager
        .update(&id, |a| {
            a.pty_id = Some(pty_id);
            a.error = None;
        })
        .await
        .map_err(|e| format!("update failed: {e}"))?;

    let _ = state.status_tx.send((id.clone(), "running".into()));

    // Emit status event
    app_handle.emit("agent:status", &updated_agent).ok();

    Ok(updated_agent)
}

// ---------------------------------------------------------------------------
// agent_stop — kill PTY, mark as inactive
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn agent_stop(
    id: String,
    state: State<'_, Arc<AppState>>,
    pty_manager: State<'_, Arc<PtyManager>>,
    cwd_tracker: State<'_, Arc<CwdTracker>>,
    registry: State<'_, WindowRegistry>,
    app_handle: AppHandle,
) -> Result<Agent, String> {
    let agent = state
        .agent_manager
        .get(&id)
        .await
        .ok_or_else(|| format!("agent not found: {id}"))?;

    let was_running = agent.state == AgentState::Running;

    // Kill PTY if one exists
    if let Some(ref pty_id) = agent.pty_id {
        cwd_tracker.unregister(pty_id);
        pty_manager.kill(pty_id).ok();
    }

    // Remove PTY channel from EventBus
    state.event_bus.remove_pty_channel(&id);

    // Transition to Inactive
    state
        .agent_manager
        .set_state(&id, AgentState::Inactive)
        .await
        .map_err(|e| format!("state transition failed: {e}"))?;

    // Clear pty_id
    let updated_agent = state
        .agent_manager
        .update(&id, |a| {
            a.pty_id = None;
        })
        .await
        .map_err(|e| format!("update failed: {e}"))?;

    let _ = state.status_tx.send((id.clone(), "inactive".into()));

    app_handle.emit("agent:status", &updated_agent).ok();

    // Send notification if agent was previously running
    if was_running {
        let agent_name = updated_agent.name.as_deref().unwrap_or("Agent");
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
pub async fn agent_remove(
    id: String,
    state: State<'_, Arc<AppState>>,
    pty_manager: State<'_, Arc<PtyManager>>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let removed = state.agent_manager.remove(&id).await;

    if let Some(agent) = removed {
        if let Some(ref pty_id) = agent.pty_id {
            pty_manager.kill(pty_id).ok();
        }
        state.event_bus.remove_pty_channel(&id);
    }

    app_handle
        .emit("agent:removed", serde_json::json!({ "agentId": id }))
        .ok();

    Ok(())
}

// ---------------------------------------------------------------------------
// agent_update — update mutable agent fields
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn agent_update(
    params: serde_json::Value,
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<serde_json::Value, String> {
    let id = params
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing 'id' field".to_string())?
        .to_string();

    let updated_agent = state
        .agent_manager
        .update(&id, |agent| {
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
                // Store as skills marker for the new model
                let marker = "__skip_permissions".to_string();
                if skip && !agent.skills.contains(&marker) {
                    agent.skills.push(marker);
                } else if !skip {
                    agent.skills.retain(|s| s != "__skip_permissions");
                }
            }
            if let Some(provider) = params.get("provider").and_then(|v| v.as_str()) {
                agent.provider = Provider::from_str_opt(Some(provider));
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
                } else if let Ok(paths) =
                    serde_json::from_value::<Vec<String>>(secondary.clone())
                {
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
            if let Some(tab_id) = params.get("tabId").and_then(|v| v.as_str()) {
                agent.tab_id = tab_id.to_string();
            }
            if let Some(role) = params.get("role").and_then(|v| v.as_str()) {
                // Store role as a skill marker for backward compat
                agent.skills.retain(|s| !s.starts_with("__role:"));
                agent.skills.push(format!("__role:{role}"));
            }
            if let Some(is_super) = params.get("isSuperAgent").and_then(|v| v.as_bool()) {
                if is_super {
                    let scope = match params
                        .get("superAgentScope")
                        .and_then(|v| v.as_str())
                    {
                        Some("workspace") => Scope::Workspace,
                        Some("global") => Scope::Global,
                        _ => Scope::Tab,
                    };
                    agent.role = AgentRole::Super { scope };
                } else {
                    agent.role = AgentRole::Normal;
                }
            }
            if let Some(scope) = params.get("superAgentScope") {
                if !scope.is_null() {
                    if let Some(s) = scope.as_str() {
                        // Only update scope if agent is already super
                        if agent.is_super_agent() {
                            let new_scope = match s {
                                "workspace" => Scope::Workspace,
                                "global" => Scope::Global,
                                _ => Scope::Tab,
                            };
                            agent.role = AgentRole::Super { scope: new_scope };
                        }
                    }
                }
            }
            if let Some(sl) = params.get("statusLine").and_then(|v| v.as_str()) {
                agent.status_line = Some(sl.to_string());
            }
            if let Some(parent_id) = params.get("parentId") {
                if parent_id.is_null() {
                    agent.parent_id = None;
                } else if let Some(p) = parent_id.as_str() {
                    agent.parent_id = Some(p.to_string());
                }
            }
            // Handle processState for backward compatibility
            if let Some(ps) = params.get("processState").and_then(|v| v.as_str()) {
                match ps {
                    "inactive" => agent.state = AgentState::Inactive,
                    "running" => agent.state = AgentState::Running,
                    "waiting" => agent.state = AgentState::Waiting,
                    "completed" => agent.state = AgentState::Completed,
                    "error" => agent.state = AgentState::Error,
                    "dormant" => agent.state = AgentState::Dormant,
                    _ => {}
                }
            }
        })
        .await
        .map_err(|e| format!("update failed: {e}"))?;

    let _ = state.status_tx.send((id.clone(), "updated".into()));

    app_handle.emit("agent:status", &updated_agent).ok();

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
pub async fn agent_set_dormant(
    id: String,
    state: State<'_, Arc<AppState>>,
    pty_manager: State<'_, Arc<PtyManager>>,
    cwd_tracker: State<'_, Arc<CwdTracker>>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let agent = state
        .agent_manager
        .get(&id)
        .await
        .ok_or_else(|| format!("agent not found: {id}"))?;

    // Kill PTY if exists
    if let Some(ref pty_id) = agent.pty_id {
        cwd_tracker.unregister(pty_id);
        pty_manager.kill(pty_id).ok();
    }

    // Remove PTY channel from EventBus
    state.event_bus.remove_pty_channel(&id);

    // Transition to Dormant
    state
        .agent_manager
        .set_state(&id, AgentState::Dormant)
        .await
        .map_err(|e| format!("state transition failed: {e}"))?;

    // Clear pty_id
    state
        .agent_manager
        .update(&id, |a| {
            a.pty_id = None;
        })
        .await
        .map_err(|e| format!("update failed: {e}"))?;

    let _ = state.status_tx.send((id.clone(), "dormant".into()));
    app_handle
        .emit(
            "agent:status",
            serde_json::json!({"id": id, "state": "dormant", "processState": "dormant"}),
        )
        .ok();

    Ok(())
}

// ---------------------------------------------------------------------------
// agent_reanimate — reopen a dormant agent by spawning a new PTY
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn agent_reanimate(
    id: String,
    state: State<'_, Arc<AppState>>,
    pty_manager: State<'_, Arc<PtyManager>>,
    cwd_tracker: State<'_, Arc<CwdTracker>>,
    app_handle: AppHandle,
) -> Result<Agent, String> {
    let pty_id = uuid::Uuid::new_v4().to_string();

    let agent = state
        .agent_manager
        .get(&id)
        .await
        .ok_or_else(|| format!("agent not found: {id}"))?;

    if agent.state != AgentState::Dormant {
        return Err("Agent is not dormant".to_string());
    }

    // Fall back to home dir if cwd doesn't exist
    let cwd = if std::path::Path::new(&agent.cwd).exists() {
        agent.cwd.clone()
    } else {
        dirs::home_dir()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string()
    };

    // Spawn PTY
    pty_manager.spawn(&pty_id, &id, &cwd, &app_handle, None, None)?;

    // Register the shell PID with the cwd tracker
    if let Some(pid) = pty_manager.get_child_pid(&pty_id) {
        cwd_tracker.register(&pty_id, pid);
    }

    // Export agent ID so Claude Code hooks can report status if user (re)starts claude manually
    pty_manager
        .write(
            &pty_id,
            format!("export DOROTORING_AGENT_ID={id}\n").as_bytes(),
        )
        .ok();

    // Transition Dormant -> Inactive
    state
        .agent_manager
        .set_state(&id, AgentState::Inactive)
        .await
        .map_err(|e| format!("state transition failed: {e}"))?;

    // Update pty_id and check for missing path
    let path_exists = std::path::Path::new(&agent.cwd).exists();
    let updated = state
        .agent_manager
        .update(&id, |a| {
            a.pty_id = Some(pty_id);
            if !path_exists {
                a.error = Some("Project path does not exist".to_string());
            }
        })
        .await
        .map_err(|e| format!("update failed: {e}"))?;

    app_handle.emit("agent:status", &updated).ok();
    Ok(updated)
}

// ---------------------------------------------------------------------------
// agent_update_business_state — Super Agent sets businessState explicitly
// (Stored as status_line in the new model for backward compat)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn agent_update_business_state(
    id: String,
    business_state: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .agent_manager
        .update(&id, |agent| {
            // Store in status_line since the new model doesn't have business_state
            agent.status_line = Some(business_state);
        })
        .await
        .map_err(|e| format!("update failed: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// agent_send_input — write raw text to an agent's PTY
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn agent_send_input(
    id: String,
    input: String,
    state: State<'_, Arc<AppState>>,
    pty_manager: State<'_, Arc<PtyManager>>,
) -> Result<(), String> {
    let agent = state
        .agent_manager
        .get(&id)
        .await
        .ok_or_else(|| format!("agent not found: {id}"))?;

    let pty_id = agent
        .pty_id
        .ok_or_else(|| format!("agent {id} has no active PTY"))?;

    pty_manager.write(&pty_id, input.as_bytes())
}

// ---------------------------------------------------------------------------
// agent_promote_super — promote to Super Agent and reload claude with MCP tools
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn agent_promote_super(
    id: String,
    scope: Option<String>,
    state: State<'_, Arc<AppState>>,
    pty_manager: State<'_, Arc<PtyManager>>,
    app_handle: AppHandle,
) -> Result<Agent, String> {
    let scope_enum = match scope.as_deref() {
        Some("workspace") => Scope::Workspace,
        Some("global") => Scope::Global,
        _ => Scope::Tab,
    };

    let agent = state
        .agent_manager
        .promote_super(&id, scope_enum)
        .await
        .map_err(|e| format!("promote failed: {e}"))?;

    let was_running = matches!(agent.state, AgentState::Running | AgentState::Waiting);
    let pty_id = agent.pty_id.clone();

    // If claude is running in the PTY, gracefully exit and relaunch with MCP
    if let Some(ref pty_id_val) = pty_id {
        if was_running {
            // Send /exit to quit claude gracefully
            let _ = pty_manager.write(pty_id_val, b"/exit\n");

            // Wait briefly for claude to exit, then relaunch
            let pty_mgr = pty_manager.inner().clone();
            let pty_id_clone = pty_id_val.clone();
            let state_clone = state.inner().clone();
            let agent_id = id.clone();
            let app_handle_clone = app_handle.clone();

            tokio::spawn(async move {
                // Give claude time to exit
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;

                // Get refreshed agent and settings
                let agent = match state_clone.agent_manager.get(&agent_id).await {
                    Some(a) => a,
                    None => return,
                };
                let settings = state_clone.settings.lock().unwrap().clone();

                let skip_permissions = agent
                    .skills
                    .contains(&"__skip_permissions".to_string());

                let config = build_start_config(
                    &agent,
                    None,
                    skip_permissions,
                    true, // continue_session
                );
                let cmd = build_cli_command(&agent, config, &settings);
                let cmd_str = cmd.join(" ");

                // Export agent ID for status hooks
                let _ = pty_mgr.write(
                    &pty_id_clone,
                    format!("export DOROTORING_AGENT_ID={agent_id}\n").as_bytes(),
                );

                // For tab-scoped super agents: export tab ID before relaunching
                if agent.is_super_agent() {
                    if let Some(Scope::Tab) = agent.scope() {
                        let tab_id = &agent.tab_id;
                        let _ = pty_mgr.write(
                            &pty_id_clone,
                            format!("export DOROTORING_TAB_ID={tab_id}\n").as_bytes(),
                        );
                    }
                }

                let _ = pty_mgr.write(&pty_id_clone, format!("{cmd_str}\n").as_bytes());

                app_handle_clone.emit("agent:status", &agent).ok();
            });
        }
    }

    let _ = state.status_tx.send((id.clone(), "updated".into()));

    // Return freshest version
    let latest = state.agent_manager.get(&id).await.unwrap_or(agent);
    Ok(latest)
}
