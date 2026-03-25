# Agent-Terminal Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify Agent and Terminal into a single `Agent` primitive — every terminal is an agent with optional enrichable metadata, dormant persistence, intelligent state inference, and team-based coordination via tabs.

**Architecture:** Bottom-up approach: Rust backend model first (source of truth), then TypeScript types, then hooks/logic, then UI. Each layer builds on the previous. Migration runs last after the new model is fully wired.

**Tech Stack:** Rust (Tauri v2, portable-pty, serde), TypeScript, React, xterm.js, React Mosaic, MCP protocol

**Spec:** `docs/superpowers/specs/2026-03-25-agent-terminal-unification-design.md`

---

## File Structure

### Files to create
- `src-tauri/src/cwd_tracker.rs` — cwd polling logic (Linux `/proc`, macOS `libproc`)
- `src-tauri/src/business_state.rs` — statusLine → businessState inference classifier
- `src-tauri/src/migration.rs` — agents.json v0→v1 migration logic
- `src-tauri/src/commands/tab.rs` — Tauri IPC commands for tab CRUD
- `src/components/ConfigWheel/index.tsx` — agent config wheel popover component
- `src/components/ConfigWheel/SuperAgentToggle.tsx` — Super Agent promotion UI
- `src/components/DormantAgentsList/index.tsx` — list of dormant agents for reanimation
- `src/hooks/useTabManagerBackend.ts` — replacement for localStorage-based tab manager
- `mcp-orchestrator/src/tools/business-state.ts` — new MCP tools for businessState and team status

### Files to modify

**Rust backend:**
- `src-tauri/src/state.rs` — `AgentStatus` → `Agent` struct, `AgentState` → `ProcessState` enum, `AgentsFile` wrapper
- `src-tauri/src/commands/agent.rs` — update all commands for new model, add reanimation, dormant transitions
- `src-tauri/src/commands/mod.rs` — add `pub mod tab;`
- `src-tauri/src/pty.rs` — store child PID for cwd tracking, integrate cwd polling
- `src-tauri/src/lib.rs` — register new commands (tab CRUD, cwd, businessState), migration on startup
- `src-tauri/src/notifications.rs` — update agent field references
- `src-tauri/Cargo.toml` — verify `uuid` and `chrono` crate dependencies

**TypeScript types:**
- `src/types/electron.d.ts` — `AgentStatus` → `Agent` interface, `ProcessState` type, tab IPC types, `DisplayStatus` update
- `src/types/agent.ts` — update or consolidate with electron.d.ts
- `src/types/index.ts` — update local `AgentStatus`/`Agent` type to re-export from electron.d.ts (avoid conflict)

**Hooks:**
- `src/hooks/useElectron.ts` — update `useElectronAgents()` for new model, add tab IPC methods
- `src/hooks/useAgentTerminal.ts` — dormant agent output replay, config wheel integration
- `src/hooks/useAgentFiltering.ts` — filter by `processState`/`businessState` instead of `status`/`projectPath`
- `src/hooks/useSuperAgent.ts` — use `isSuperAgent` + `superAgentScope` instead of name-based detection
- `src/hooks/useAgents.ts` — update `AgentStatus` references

**TerminalsView:**
- `src/components/TerminalsView/index.tsx` — integrate backend tabs, config wheel, dormant agents, Super Agent visuals
- `src/components/TerminalsView/types.ts` — remove `CustomTab.agentIds`, drop `ActiveTab` project variant, update `TerminalPanelState`
- `src/components/TerminalsView/hooks/useTabManager.ts` — rewrite as thin IPC wrapper over backend
- `src/components/TerminalsView/components/ContextMenu.tsx` — add config wheel entry point
- `src/components/TerminalsView/components/TerminalPanel.tsx` — Super Agent bold styling + crown badge

**AgentList:**
- `src/components/AgentList/constants.ts` — update status colors/labels for `ProcessState` + `DisplayStatus`
- `src/components/AgentList/AgentManagementCard.tsx` — show `businessState`, Super Agent badge

**CanvasView (7 files):**
- `src/components/CanvasView/types.ts` — update `AgentNode.status` and `projectPath` fields
- `src/components/CanvasView/hooks/useAgentActions.ts` — update agent field references
- `src/components/CanvasView/hooks/useCanvasNodes.ts` — update agent field references
- `src/components/CanvasView/hooks/useTerminalDialog.ts` — update agent field references
- `src/components/CanvasView/components/AgentNodeCard.tsx` — update status display
- `src/components/CanvasView/components/NotificationPanel.tsx` — update agent field references
- `src/components/CanvasView/index.tsx` — update agent field references

**AgentTerminalDialog (4+ files):**
- `src/components/AgentTerminalDialog/AgentDialogTypes.ts` — update type definitions
- `src/components/AgentTerminalDialog/AgentDialogSuperAgentSidebar.tsx` — update Super Agent detection
- `src/components/AgentTerminalDialog/AgentDialogSecondaryProject.tsx` — `secondaryProjectPath` → `secondaryPaths`
- `src/components/AgentTerminalDialog/index.tsx` — update agent field references

**MosaicTerminalView:**
- `src/components/MosaicTerminalView/index.tsx` — update `AgentStatus`, `status`, `projectPath` references
- `src/components/MosaicTerminalView/TerminalTile.tsx` — update agent field references

**Dashboard:**
- `src/components/Dashboard/AgentActivity.tsx` — update `agent.status`, `agent.projectPath`
- `src/components/Dashboard/index.tsx` — update agent references
- `src/components/Dashboard/LiveTaskFeed.tsx` — update `currentTask` references

**TrayPanel:**
- `src/components/TrayPanel/TrayPanel.tsx` — update `AgentStatus`, `currentTask`
- `src/components/TrayPanel/useTrayTerminal.ts` — update agent field references

**Other components/routes:**
- `src/routes/agents.tsx` — combined active + dormant view, filter by `processState`
- `src/routes/console.tsx` — update `AgentStatus`/`projectPath` references
- `src/routes/projects.tsx` — update `AgentStatus`/`projectPath` references
- `src/store/index.ts` — update `a.status === 'running'` references
- `src/lib/agent-manager.ts` — update `AgentStatus`, `projectPath`, `currentTask`, `progress` references
- `src/components/NewChatModal/index.tsx` — simplify to quick-create form
- `src/components/NewChatModal/types.ts` — remove `projectPath` from `EditAgentData`, update `onSubmit` signature
- `src/components/NewChatModal/StepTask.tsx` — remove `projectPath` prop
- `src/components/NewChatModal/StepModel.tsx` — remove `projectPath` prop
- `src/components/NewChatModal/AgentPersonaEditor.tsx` — remove `projectPath` prop
- `src/components/NewChatModal/StepProject.tsx` — remove (project = cwd)
- `src/components/RecurringTasks/` — review `projectPath` references in UI display

**MCP Orchestrator:**
- `mcp-orchestrator/src/tools/agents.ts` — update field references (`status`→`processState`, `projectPath`→`cwd`, `lastCleanOutput`→`statusLine`)
- `mcp-orchestrator/src/index.ts` — register new tools

### Files to delete (after migration)
- `src/components/NewChatModal/StepProject.tsx` — project picker no longer needed

---

## Task 1: Rust Backend — New Agent Model

**Files:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/Cargo.toml` (verify `uuid` and `chrono` crate dependencies)
- Create: `src-tauri/src/migration.rs`

- [ ] **Step 0: Verify Cargo.toml dependencies**

Check that `uuid` (with `v4` feature) and `chrono` are in `src-tauri/Cargo.toml` dependencies. Add them if missing:

```toml
uuid = { version = "1", features = ["v4"] }
chrono = "0.4"
```

- [ ] **Step 1: Update `AgentState` enum to `ProcessState`**

In `src-tauri/src/state.rs`, replace the `AgentState` enum:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ProcessState {
    Inactive,
    Running,
    Waiting,
    Error,
    Completed,
    Dormant,
}

impl Default for ProcessState {
    fn default() -> Self {
        ProcessState::Inactive
    }
}
```

- [ ] **Step 2: Update `AgentStatus` struct to `Agent`**

Replace the `AgentStatus` struct with the new `Agent` struct. Keep all existing fields, rename/add per spec:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: String,
    // Identity
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub character: Option<String>,
    pub skills: Vec<String>,
    // Project context
    pub cwd: String,
    pub secondary_paths: Vec<String>,
    // Process
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pty_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_model: Option<String>,
    pub skip_permissions: bool,
    // States
    pub process_state: ProcessState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub business_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub business_state_updated_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub business_state_updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_line: Option<String>,
    // Coordination
    pub tab_id: String,
    pub is_super_agent: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub super_agent_scope: Option<String>,
    // Scheduling
    pub scheduled_task_ids: Vec<String>,
    pub automation_ids: Vec<String>,
    // Metadata
    pub output: Vec<String>,
    pub last_activity: String,
    pub created_at: String,
    // Carried forward
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub obsidian_vault_paths: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path_missing: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kanban_task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_session_id: Option<String>,
}
```

**Important:** Preserve `#[serde(skip_serializing_if)]` annotations from the current `AgentStatus` struct on all `Option` fields. This keeps serialized JSON clean and file sizes small.

- [ ] **Step 3: Create `AgentsFile` wrapper struct**

Add to `state.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentsFile {
    pub schema_version: u32,
    pub agents: HashMap<String, Agent>,
}
```

- [ ] **Step 4: Update `AppState` to use `AgentsFile`**

Update the `load_agents()` and `save_agents()` methods to use the wrapper format. On load, try `AgentsFile` first, fall back to bare `HashMap<String, AgentStatus>` and trigger migration.

- [ ] **Step 5: Create migration module**

Create `src-tauri/src/migration.rs`:

```rust
use crate::state::{Agent, AgentsFile, ProcessState};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

pub fn migrate_v0_to_v1(
    old_agents: HashMap<String, serde_json::Value>,
    agents_path: &Path,
) -> Result<AgentsFile, String> {
    // Backup
    let backup_path = agents_path.with_extension("json.v0.backup");
    fs::copy(agents_path, &backup_path)
        .map_err(|e| format!("Failed to create backup: {}", e))?;

    let mut new_agents = HashMap::new();
    let default_tab_id = uuid::Uuid::new_v4().to_string();

    for (id, value) in old_agents {
        let agent = migrate_single_agent(&id, &value, &default_tab_id)?;
        new_agents.insert(id, agent);
    }

    Ok(AgentsFile {
        schema_version: 1,
        agents: new_agents,
    })
}

fn migrate_single_agent(
    id: &str,
    value: &serde_json::Value,
    default_tab_id: &str,
) -> Result<Agent, String> {
    let last_activity = value.get("lastActivity")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let status_line = value.get("lastCleanOutput")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| value.get("statusLine").and_then(|v| v.as_str()).map(|s| s.to_string()));

    let secondary_paths: Vec<String> = value.get("secondaryProjectPath")
        .and_then(|v| v.as_str())
        .map(|s| vec![s.to_string()])
        .unwrap_or_default();

    let mut output: Vec<String> = value.get("output")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    if output.len() > 10_000 {
        output = output.split_off(output.len() - 10_000);
    }

    Ok(Agent {
        id: id.to_string(),
        name: value.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
        role: None,
        character: value.get("character").and_then(|v| v.as_str()).map(|s| s.to_string()),
        skills: value.get("skills")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default(),
        cwd: value.get("projectPath")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        secondary_paths,
        pty_id: None, // No PTY survives restart
        provider: value.get("provider").and_then(|v| v.as_str()).map(|s| s.to_string()),
        local_model: value.get("localModel").and_then(|v| v.as_str()).map(|s| s.to_string()),
        skip_permissions: value.get("skipPermissions").and_then(|v| v.as_bool()).unwrap_or(false),
        process_state: ProcessState::Dormant, // All agents dormant after migration
        business_state: None,
        business_state_updated_by: None,
        business_state_updated_at: None,
        status_line,
        tab_id: default_tab_id.to_string(),
        is_super_agent: false,
        super_agent_scope: None,
        scheduled_task_ids: vec![],
        automation_ids: vec![],
        output,
        last_activity: last_activity.clone(),
        created_at: last_activity,
        worktree_path: value.get("worktreePath").and_then(|v| v.as_str()).map(|s| s.to_string()),
        branch_name: value.get("branchName").and_then(|v| v.as_str()).map(|s| s.to_string()),
        error: value.get("error").and_then(|v| v.as_str()).map(|s| s.to_string()),
        obsidian_vault_paths: value.get("obsidianVaultPaths")
            .and_then(|v| serde_json::from_value(v.clone()).ok()),
        path_missing: value.get("pathMissing").and_then(|v| v.as_bool()),
        kanban_task_id: value.get("kanbanTaskId").and_then(|v| v.as_str()).map(|s| s.to_string()),
        current_session_id: value.get("currentSessionId").and_then(|v| v.as_str()).map(|s| s.to_string()),
    })
}
```

- [ ] **Step 6: Wire migration into `AppState::load_agents()`**

Update `load_agents()` to try new format first, fall back to migration:

```rust
pub fn load_agents(path: &Path) -> AgentsFile {
    let data = match fs::read_to_string(path) {
        Ok(d) => d,
        Err(_) => return AgentsFile { schema_version: 1, agents: HashMap::new() },
    };

    // Try new format first
    if let Ok(file) = serde_json::from_str::<AgentsFile>(&data) {
        return file;
    }

    // Fall back to old format and migrate
    if let Ok(old) = serde_json::from_str::<HashMap<String, serde_json::Value>>(&data) {
        match migration::migrate_v0_to_v1(old, path) {
            Ok(new_file) => {
                // Save migrated data
                if let Ok(json) = serde_json::to_string_pretty(&new_file) {
                    let _ = fs::write(path, json);
                }
                return new_file;
            }
            Err(e) => {
                eprintln!("Migration failed: {}. Loading backup as dormant agents.", e);
                // Load backup using old format, present all agents as dormant
                let backup_path = path.with_extension("json.v0.backup");
                if let Ok(backup_data) = fs::read_to_string(&backup_path) {
                    if let Ok(backup_agents) = serde_json::from_str::<HashMap<String, serde_json::Value>>(&backup_data) {
                        // Minimal migration: just set all to dormant with basic fields
                        let agents = backup_agents.into_iter().map(|(id, v)| {
                            let agent = Agent {
                                id: id.clone(),
                                cwd: v.get("projectPath").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                name: v.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
                                process_state: ProcessState::Dormant,
                                tab_id: "general".to_string(),
                                // ... all other fields default
                                ..Default::default()
                            };
                            (id, agent)
                        }).collect();
                        return AgentsFile { schema_version: 1, agents };
                    }
                }
            }
        }
    }

    AgentsFile { schema_version: 1, agents: HashMap::new() }
}
```

- [ ] **Step 7: Update `save_agents()` to use wrapper format**

```rust
pub fn save_agents(&self) {
    let file = AgentsFile {
        schema_version: 1,
        agents: self.agents.lock().unwrap().clone(),
    };
    if let Ok(json) = serde_json::to_string_pretty(&file) {
        let _ = fs::write(&self.agents_path, json);
    }
}
```

- [ ] **Step 8: Build and verify compilation**

Run: `cd src-tauri && cargo build 2>&1 | head -50`
Expected: Compilation errors for all the places still using `AgentStatus` / `AgentState` — these are fixed in the next tasks.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/migration.rs
git commit -m "feat(backend): replace AgentStatus with Agent model, add migration v0→v1"
```

---

## Task 2: Rust Backend — Update Agent Commands

**Files:**
- Modify: `src-tauri/src/commands/agent.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Update `agent_create` to use new `Agent` struct**

The create command no longer requires `projectPath` — it receives an optional `cwd` (defaults to `$HOME`), and all identity fields are optional:

```rust
#[tauri::command]
pub async fn agent_create(
    state: State<'_, AppState>,
    config: serde_json::Value,
) -> Result<Agent, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let home = dirs::home_dir().unwrap_or_default().to_string_lossy().to_string();

    let agent = Agent {
        id: id.clone(),
        name: config.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
        role: config.get("role").and_then(|v| v.as_str()).map(|s| s.to_string()),
        character: config.get("character").and_then(|v| v.as_str()).map(|s| s.to_string()),
        skills: config.get("skills")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default(),
        cwd: config.get("cwd")
            .and_then(|v| v.as_str())
            .unwrap_or(&home)
            .to_string(),
        secondary_paths: config.get("secondaryPaths")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default(),
        pty_id: None,
        provider: config.get("provider").and_then(|v| v.as_str()).map(|s| s.to_string()),
        local_model: config.get("localModel").and_then(|v| v.as_str()).map(|s| s.to_string()),
        skip_permissions: config.get("skipPermissions").and_then(|v| v.as_bool()).unwrap_or(false),
        process_state: ProcessState::Inactive,
        business_state: None,
        business_state_updated_by: None,
        business_state_updated_at: None,
        status_line: None,
        tab_id: config.get("tabId")
            .and_then(|v| v.as_str())
            .unwrap_or("general")
            .to_string(),
        is_super_agent: false,
        super_agent_scope: None,
        scheduled_task_ids: vec![],
        automation_ids: vec![],
        output: vec![],
        last_activity: chrono::Utc::now().to_rfc3339(),
        created_at: chrono::Utc::now().to_rfc3339(),
        worktree_path: None,
        branch_name: None,
        error: None,
        obsidian_vault_paths: config.get("obsidianVaultPaths")
            .and_then(|v| serde_json::from_value(v.clone()).ok()),
        path_missing: None,
        kanban_task_id: None,
        current_session_id: None,
    };

    state.agents.lock().unwrap().insert(id, agent.clone());
    state.save_agents();
    Ok(agent)
}
```

- [ ] **Step 2: Update `agent_start` to use `ProcessState`**

Replace all references to `AgentState::Running` with `ProcessState::Running`, `agent.status` with `agent.process_state`, and `agent.project_path` with `agent.cwd`.

- [ ] **Step 3: Update `agent_stop` to use `ProcessState`**

Replace `AgentState::Idle` with `ProcessState::Inactive` (the agent was manually stopped, not completed — the terminal stays open). Replace `AgentState::Completed` with `ProcessState::Completed` for natural process exit.

- [ ] **Step 4: Add dormant transition command**

Add `agent_set_dormant` for when a terminal is closed:

```rust
#[tauri::command]
pub async fn agent_set_dormant(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let mut agents = state.agents.lock().unwrap();
    if let Some(agent) = agents.get_mut(&id) {
        agent.process_state = ProcessState::Dormant;
        agent.pty_id = None;
        agent.last_activity = chrono::Utc::now().to_rfc3339();
    }
    drop(agents);
    state.save_agents();
    Ok(())
}
```

- [ ] **Step 5: Add reanimation command**

```rust
#[tauri::command]
pub async fn agent_reanimate(
    state: State<'_, AppState>,
    pty_manager: State<'_, PtyManager>,
    app: AppHandle,
    id: String,
) -> Result<Agent, String> {
    let mut agents = state.agents.lock().unwrap();
    let agent = agents.get_mut(&id).ok_or("Agent not found")?;

    if agent.process_state != ProcessState::Dormant {
        return Err("Agent is not dormant".to_string());
    }

    // Check if cwd still exists, fall back to $HOME
    let cwd = if std::path::Path::new(&agent.cwd).exists() {
        agent.cwd.clone()
    } else {
        agent.path_missing = Some(true);
        dirs::home_dir().unwrap_or_default().to_string_lossy().to_string()
    };

    let pty_id = uuid::Uuid::new_v4().to_string();
    // Note: spawn() takes (pty_id, agent_id, cwd, app_handle, cols, rows)
    // Use default terminal size; frontend will send resize after mount
    pty_manager.spawn(&pty_id, &agent.id, &cwd, &app, 120, 30)
        .map_err(|e| format!("Failed to spawn PTY: {}", e))?;

    agent.pty_id = Some(pty_id);
    agent.process_state = ProcessState::Inactive;
    agent.last_activity = chrono::Utc::now().to_rfc3339();

    let result = agent.clone();
    drop(agents);
    state.save_agents();
    Ok(result)
}
```

- [ ] **Step 6: Update `agent_update` for new fields**

Add `role`, `isSuperAgent`, `superAgentScope`, `tabId`, `businessState` to the updatable fields in `agent_update`.

- [ ] **Step 7: Register new commands in `lib.rs`**

Add `agent_set_dormant` and `agent_reanimate` to the Tauri command handler registration.

- [ ] **Step 8: Build and verify**

Run: `cd src-tauri && cargo build 2>&1 | head -50`
Expected: Should compile (may have warnings about unused fields).

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/commands/agent.rs src-tauri/src/lib.rs
git commit -m "feat(backend): update agent commands for new model, add dormant/reanimate"
```

---

## Task 3: Rust Backend — cwd Tracker

**Files:**
- Create: `src-tauri/src/cwd_tracker.rs`
- Modify: `src-tauri/src/pty.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create cwd tracker module**

Create `src-tauri/src/cwd_tracker.rs`:

```rust
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::AppHandle;
use tauri::Emitter;

pub struct CwdTracker {
    /// Maps pty_id → child PID
    pids: Arc<Mutex<HashMap<String, u32>>>,
}

impl CwdTracker {
    pub fn new() -> Self {
        Self {
            pids: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn register(&self, pty_id: &str, pid: u32) {
        self.pids.lock().unwrap().insert(pty_id.to_string(), pid);
    }

    pub fn unregister(&self, pty_id: &str) {
        self.pids.lock().unwrap().remove(pty_id);
    }

    /// Get cwd for a process by PID
    #[cfg(target_os = "linux")]
    fn get_cwd(pid: u32) -> Option<String> {
        std::fs::read_link(format!("/proc/{}/cwd", pid))
            .ok()
            .map(|p| p.to_string_lossy().to_string())
    }

    #[cfg(target_os = "macos")]
    fn get_cwd(pid: u32) -> Option<String> {
        use std::process::Command;
        let output = Command::new("lsof")
            .args(["-p", &pid.to_string(), "-Fn", "-d", "cwd"])
            .output()
            .ok()?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout.lines()
            .find(|l| l.starts_with('n'))
            .map(|l| l[1..].to_string())
    }

    /// Start background polling loop (2s interval)
    pub fn start_polling(
        &self,
        app: AppHandle,
        state: Arc<Mutex<HashMap<String, crate::state::Agent>>>,
    ) {
        let pids = self.pids.clone();
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(Duration::from_secs(2));
                let pids_snapshot = pids.lock().unwrap().clone();

                // Collect cwd updates outside the agents lock to minimize contention
                let mut updates: Vec<(String, String)> = Vec::new(); // (pty_id, new_cwd)
                for (pty_id, pid) in &pids_snapshot {
                    if let Some(cwd) = Self::get_cwd(*pid) {
                        updates.push((pty_id.clone(), cwd));
                    }
                }

                // Briefly acquire agents lock to apply updates
                if !updates.is_empty() {
                    let mut agents = state.lock().unwrap();
                    for (pty_id, cwd) in &updates {
                        for agent in agents.values_mut() {
                            if agent.pty_id.as_deref() == Some(pty_id) {
                                if agent.cwd != *cwd {
                                    let dir_exists = std::path::Path::new(cwd).exists();
                                    agent.cwd = cwd.clone();
                                    agent.path_missing = Some(!dir_exists);
                                    let _ = app.emit("agent:cwd-changed", serde_json::json!({
                                        "agentId": agent.id,
                                        "cwd": cwd,
                                    }));
                                }
                                break;
                            }
                        }
                    }
                }
            }
        });
    }
}
```

- [ ] **Step 2: Expose child PID from PtyManager**

In `src-tauri/src/pty.rs`, update `PtyHandle` to store the child PID and update `spawn()` to return it:

```rust
pub struct PtyHandle {
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn portable_pty::Child + Send>,
    pub agent_id: String,
    pub child_pid: u32, // NEW
}
```

In `spawn()`, after creating the child, extract the PID:

```rust
let child_pid = child.process_id().unwrap_or(0) as u32;
```

Return `child_pid` from `spawn()` so the caller can register it with `CwdTracker`.

- [ ] **Step 3: Wire cwd tracker in `lib.rs` and update `agent.rs`**

Initialize `CwdTracker` as managed state, start polling on app startup. Update `agent_start` and `agent_reanimate` in `commands/agent.rs` to:
1. Capture the child PID from the updated `spawn()` return value
2. Register the PID with `CwdTracker`

In `agent_stop` and `agent_set_dormant`, unregister the PID from `CwdTracker`.

**Note:** This re-edits `agent.rs` from Task 2 — the PID registration was intentionally deferred to this task because it depends on the updated `spawn()` signature.

- [ ] **Step 4: Build and verify**

Run: `cd src-tauri && cargo build 2>&1 | head -50`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/cwd_tracker.rs src-tauri/src/pty.rs src-tauri/src/lib.rs
git commit -m "feat(backend): add cwd tracker with 2s polling for dynamic project context"
```

---

## Task 4: Rust Backend — businessState Inference

**Files:**
- Create: `src-tauri/src/business_state.rs`
- Modify: `src-tauri/src/commands/agent.rs`

- [ ] **Step 1: Create businessState classifier**

Create `src-tauri/src/business_state.rs`:

```rust
/// Lightweight keyword-based classifier for businessState inference.
/// Runs on each statusLine update. Returns None if no pattern matches.
pub fn infer_business_state(status_line: &str) -> Option<String> {
    let lower = status_line.to_lowercase();

    // Order matters — more specific patterns first
    if lower.contains("running tests") || (lower.contains("test") && lower.contains("running")) {
        return Some("testing".to_string());
    }
    if lower.contains("reviewing") || lower.contains("review") {
        return Some("in review".to_string());
    }
    if lower.contains("building") || lower.contains("compiling") {
        return Some("building".to_string());
    }
    if lower.contains("deploying") || lower.contains("deploy") {
        return Some("deploying".to_string());
    }
    if lower.contains("waiting for") || lower.contains("blocked") {
        return Some("blocked".to_string());
    }
    if lower.contains("writing") || lower.contains("editing") || lower.contains("creating") {
        return Some("coding".to_string());
    }
    if lower.contains("reading") || lower.contains("analyzing") || lower.contains("exploring") {
        return Some("analyzing".to_string());
    }
    if lower.contains("installing") || lower.contains("downloading") {
        return Some("installing".to_string());
    }
    if lower.contains("committing") || lower.contains("pushing") {
        return Some("committing".to_string());
    }

    None
}
```

- [ ] **Step 2: Integrate into statusLine update path**

In `agent.rs`, wherever `statusLine` is updated (in the output event handler or agent_update), call the classifier:

```rust
if let Some(new_status_line) = &update.status_line {
    agent.status_line = Some(new_status_line.clone());

    // Only infer if Super Agent hasn't set a value in the last 60s
    let should_infer = match (&agent.business_state_updated_by, &agent.business_state_updated_at) {
        (Some(by), Some(at)) if by == "super_agent" => {
            if let Ok(updated) = chrono::DateTime::parse_from_rfc3339(at) {
                chrono::Utc::now().signed_duration_since(updated).num_seconds() > 60
            } else {
                true
            }
        }
        _ => true,
    };

    if should_infer {
        if let Some(inferred) = business_state::infer_business_state(new_status_line) {
            agent.business_state = Some(inferred);
            agent.business_state_updated_by = Some("inference".to_string());
            agent.business_state_updated_at = Some(chrono::Utc::now().to_rfc3339());
        }
    }
}
```

- [ ] **Step 3: Add `agent_update_business_state` command for Super Agent**

```rust
#[tauri::command]
pub async fn agent_update_business_state(
    state: State<'_, AppState>,
    id: String,
    business_state: String,
) -> Result<(), String> {
    let mut agents = state.agents.lock().unwrap();
    if let Some(agent) = agents.get_mut(&id) {
        agent.business_state = Some(business_state);
        agent.business_state_updated_by = Some("super_agent".to_string());
        agent.business_state_updated_at = Some(chrono::Utc::now().to_rfc3339());
    }
    drop(agents);
    state.save_agents();
    Ok(())
}
```

- [ ] **Step 4: Register command in `lib.rs`**

- [ ] **Step 5: Build and verify**

Run: `cd src-tauri && cargo build 2>&1 | head -50`

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/business_state.rs src-tauri/src/commands/agent.rs src-tauri/src/lib.rs
git commit -m "feat(backend): add businessState inference from statusLine patterns"
```

---

## Task 5: Rust Backend — Tab Persistence

**Files:**
- Create: `src-tauri/src/commands/tab.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod tab;`)
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add Tab structs to `state.rs`**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tab {
    pub id: String,
    pub name: String,
    pub layout: Option<serde_json::Value>, // MosaicLayout — opaque JSON
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabsFile {
    pub schema_version: u32,
    pub tabs: Vec<Tab>,
}
```

Add `tabs_path` and `tabs` to `AppState`, with `load_tabs()` and `save_tabs()` methods.

- [ ] **Step 2: Create tab commands**

Create `src-tauri/src/commands/tab.rs`:

```rust
#[tauri::command]
pub async fn tab_list(state: State<'_, AppState>) -> Result<Vec<Tab>, String> { ... }

#[tauri::command]
pub async fn tab_create(state: State<'_, AppState>, name: String) -> Result<Tab, String> { ... }

#[tauri::command]
pub async fn tab_update(state: State<'_, AppState>, id: String, name: Option<String>, layout: Option<serde_json::Value>) -> Result<(), String> { ... }

#[tauri::command]
pub async fn tab_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    // Set all agents in this tab to dormant
    // Remove tab from tabs list
    ...
}

#[tauri::command]
pub async fn tab_reorder(state: State<'_, AppState>, tab_ids: Vec<String>) -> Result<(), String> { ... }
```

- [ ] **Step 3: Add `pub mod tab;` to `commands/mod.rs` and register tab commands in `lib.rs`**

- [ ] **Step 4: Ensure default "General" tab on first load**

In `load_tabs()`, if file doesn't exist or is empty, create a default tab.

- [ ] **Step 5: Build and verify**

Run: `cd src-tauri && cargo build 2>&1 | head -50`

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/tab.rs src-tauri/src/state.rs src-tauri/src/lib.rs
git commit -m "feat(backend): add tab persistence with CRUD commands"
```

---

## Task 6: TypeScript Types — New Agent Interface

**Files:**
- Modify: `src/types/electron.d.ts`
- Modify: `src/types/agent.ts`

- [ ] **Step 1: Replace `AgentStatus` with `Agent` interface in `electron.d.ts`**

Update the interface to match the Rust struct exactly (camelCase fields, new types). Replace the old `'idle' | 'running' | 'completed' | 'error' | 'waiting'` status with `ProcessState`.

```typescript
type ProcessState = 'inactive' | 'running' | 'waiting' | 'error' | 'completed' | 'dormant';

interface Agent {
  id: string;
  name?: string;
  role?: string;
  character?: AgentCharacter;
  skills: string[];
  cwd: string;
  secondaryPaths: string[];
  ptyId?: string;
  provider?: AgentProvider;
  localModel?: string;
  skipPermissions: boolean;
  processState: ProcessState;
  businessState?: string;
  businessStateUpdatedBy?: 'inference' | 'super_agent';
  businessStateUpdatedAt?: string;
  statusLine?: string;
  tabId: string;
  isSuperAgent: boolean;
  superAgentScope?: 'tab' | 'all';
  scheduledTaskIds: string[];
  automationIds: string[];
  output: string[];
  lastActivity: string;
  createdAt: string;
  // Carried forward
  worktreePath?: string;
  branchName?: string;
  error?: string;
  obsidianVaultPaths?: string[];
  pathMissing?: boolean;
  kanbanTaskId?: string;
  currentSessionId?: string;
}
```

- [ ] **Step 2: Update `DisplayStatus` type**

```typescript
type DisplayStatus = 'working' | 'waiting' | 'done' | 'ready' | 'sleeping' | 'error';
```

- [ ] **Step 3: Update `AgentTickItem` to use `businessState` + `statusLine`**

Replace `currentTask` reference with `businessState` and `statusLine`.

- [ ] **Step 4: Add tab IPC types**

```typescript
interface Tab {
  id: string;
  name: string;
  layout?: MosaicLayout;
}

// In ElectronAPI namespace:
tab: {
  list(): Promise<Tab[]>;
  create(name: string): Promise<Tab>;
  update(id: string, updates: { name?: string; layout?: MosaicLayout }): Promise<void>;
  delete(id: string): Promise<void>;
  reorder(tabIds: string[]): Promise<void>;
}
```

- [ ] **Step 5: Add new agent commands to IPC types**

Add `setDormant(id)`, `reanimate(id)`, `updateBusinessState(id, state)` to the agent namespace.

- [ ] **Step 6: Update `src/types/agent.ts`**

Remove `progress` from `AgentEvent.type`. Update or deprecate the local `AgentStatus` to re-export from `electron.d.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/types/electron.d.ts src/types/agent.ts
git commit -m "feat(types): update TypeScript types for Agent model unification"
```

---

## Task 7: Frontend Hooks — useElectronAgents Update

**Files:**
- Modify: `src/hooks/useElectron.ts`

- [ ] **Step 1: Update `useElectronAgents` return type**

Replace all `AgentStatus` references with `Agent`. Update `agents` state type.

- [ ] **Step 2: Update event listeners for new field names**

Replace `agent.status` checks with `agent.processState` in tick handler, complete handler, etc.

- [ ] **Step 3: Add new IPC methods**

```typescript
const setDormant = async (id: string) => {
  await invoke('agent_set_dormant', { id });
  fetchAgents();
};

const reanimateAgent = async (id: string) => {
  const agent = await invoke<Agent>('agent_reanimate', { id });
  fetchAgents();
  return agent;
};

const updateBusinessState = async (id: string, businessState: string) => {
  await invoke('agent_update_business_state', { id, businessState });
};
```

- [ ] **Step 4: Add `agent:cwd-changed` event listener**

```typescript
listen('agent:cwd-changed', (event) => {
  const { agentId, cwd } = event.payload;
  setAgents(prev => prev.map(a => a.id === agentId ? { ...a, cwd } : a));
});
```

- [ ] **Step 5: Return new methods from hook**

Add `setDormant`, `reanimateAgent`, `updateBusinessState` to the return object.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useElectron.ts
git commit -m "feat(hooks): update useElectronAgents for Agent model + dormant/reanimate"
```

---

## Task 8: Frontend Hooks — Backend Tab Manager

**Files:**
- Create: `src/hooks/useTabManagerBackend.ts`
- Modify: `src/components/TerminalsView/hooks/useTabManager.ts`

- [ ] **Step 1: Create `useTabManagerBackend` hook**

New hook that wraps Tauri IPC calls for tab CRUD:

```typescript
export function useTabManagerBackend() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  useEffect(() => {
    invoke<Tab[]>('tab_list').then(setTabs);
  }, []);

  const createTab = async (name: string) => {
    const tab = await invoke<Tab>('tab_create', { name });
    setTabs(prev => [...prev, tab]);
    return tab;
  };

  const deleteTab = async (id: string) => {
    await invoke('tab_delete', { id });
    setTabs(prev => prev.filter(t => t.id !== id));
  };

  const renameTab = async (id: string, name: string) => {
    await invoke('tab_update', { id, name });
    setTabs(prev => prev.map(t => t.id === id ? { ...t, name } : t));
  };

  const updateLayout = async (id: string, layout: MosaicLayout) => {
    await invoke('tab_update', { id, layout });
    setTabs(prev => prev.map(t => t.id === id ? { ...t, layout } : t));
  };

  const reorderTabs = async (tabIds: string[]) => {
    await invoke('tab_reorder', { tabIds });
    setTabs(prev => tabIds.map(id => prev.find(t => t.id === id)!).filter(Boolean));
  };

  return {
    tabs, activeTabId, setActiveTabId,
    createTab, deleteTab, renameTab, updateLayout, reorderTabs,
  };
}
```

- [ ] **Step 2: Update `useTabManager` to delegate to backend**

Rewrite `useTabManager.ts` to use `useTabManagerBackend` instead of localStorage. Remove all localStorage reads/writes. Derive agent membership from `agents.filter(a => a.tabId === tabId)` instead of `CustomTab.agentIds`.

- [ ] **Step 3: Remove `ActiveTab` project variant**

Update the `ActiveTab` type to only have the `custom` variant (or simplify to just `string` tabId since there's only one variant now).

- [ ] **Step 4: Update `CustomTab` type**

Remove `agentIds` field from `CustomTab` in `types.ts`. Agent membership is now derived from `Agent.tabId`.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useTabManagerBackend.ts src/components/TerminalsView/hooks/useTabManager.ts src/components/TerminalsView/types.ts
git commit -m "feat(tabs): migrate tab management from localStorage to Tauri backend"
```

---

## Task 9: Frontend — Config Wheel Component

**Files:**
- Create: `src/components/ConfigWheel/index.tsx`
- Create: `src/components/ConfigWheel/SuperAgentToggle.tsx`
- Modify: `src/components/TerminalsView/components/ContextMenu.tsx`

- [ ] **Step 1: Create ConfigWheel popover**

A popover component accessible from the terminal tab's ⚙️ icon or context menu:

```tsx
interface ConfigWheelProps {
  agent: Agent;
  onUpdate: (updates: Partial<Agent>) => void;
  installedSkills: string[];
}

export function ConfigWheel({ agent, onUpdate, installedSkills }: ConfigWheelProps) {
  // Renders a popover with editable fields:
  // - Name (text input)
  // - Role (text input)
  // - Persona (character picker — existing AgentCharacter options)
  // - Skills (multi-select from installedSkills)
  // - Provider (select: claude/codex/gemini/opencode/pi/local)
  // - Autonomous mode (toggle)
  // - Super Agent (SuperAgentToggle component)
  // Changes call onUpdate immediately (auto-save on change)
}
```

- [ ] **Step 2: Create SuperAgentToggle**

```tsx
interface SuperAgentToggleProps {
  isSuperAgent: boolean;
  scope?: 'tab' | 'all';
  onChange: (isSuperAgent: boolean, scope?: 'tab' | 'all') => void;
}

export function SuperAgentToggle({ isSuperAgent, scope, onChange }: SuperAgentToggleProps) {
  // Toggle switch for Super Agent
  // When enabled, show scope picker (tab / all)
  // Validation: caller checks max one per tab / max one global
}
```

- [ ] **Step 3: Add ConfigWheel entry to ContextMenu**

In `ContextMenu.tsx`, add a "Configure Agent" menu item that opens the ConfigWheel popover.

- [ ] **Step 4: Commit**

```bash
git add src/components/ConfigWheel/
git commit -m "feat(ui): add ConfigWheel popover for agent metadata editing"
```

---

## Task 10: Frontend — Super Agent Visual Styling

**Files:**
- Modify: `src/components/TerminalsView/components/TerminalPanel.tsx`
- Modify: `src/components/AgentList/AgentManagementCard.tsx`
- Modify: `src/components/AgentList/constants.ts`

- [ ] **Step 1: Update TerminalPanel for Super Agent bold + crown**

In the tab header rendering, check `agent.isSuperAgent` and apply:
- Bold font weight on agent name
- Crown emoji: 👑 for `scope: 'tab'`, 👑👑 for `scope: 'all'`
- Distinct border for `scope: 'all'`

```tsx
const superAgentBadge = agent.isSuperAgent
  ? agent.superAgentScope === 'all' ? '👑👑 ' : '👑 '
  : '';

<span className={cn("truncate", agent.isSuperAgent && "font-bold")}>
  {superAgentBadge}{agent.name || 'Agent'}
</span>
```

- [ ] **Step 2: Update AgentManagementCard for businessState display**

Add `businessState` label below the agent name:

```tsx
{agent.businessState && (
  <span className="text-xs text-muted-foreground">{agent.businessState}</span>
)}
```

Add Super Agent badge (same as TerminalPanel).

- [ ] **Step 3: Update status colors/labels in constants.ts**

Replace old `AgentState` mappings with `ProcessState` mappings:

```typescript
export const processStateConfig: Record<ProcessState, { label: string; color: string; icon: string }> = {
  inactive: { label: 'Ready', color: 'emerald', icon: 'circle' },
  running: { label: 'Working', color: 'blue', icon: 'activity' },
  waiting: { label: 'Waiting', color: 'amber', icon: 'pause' },
  completed: { label: 'Done', color: 'blue', icon: 'check' },
  error: { label: 'Error', color: 'red', icon: 'alert' },
  dormant: { label: 'Sleeping', color: 'gray', icon: 'moon' },
};
```

- [ ] **Step 4: Commit**

```bash
git add src/components/TerminalsView/components/TerminalPanel.tsx src/components/AgentList/AgentManagementCard.tsx src/components/AgentList/constants.ts
git commit -m "feat(ui): Super Agent bold+crown styling, businessState display, ProcessState colors"
```

---

## Task 11: Frontend — Dormant Agents List

**Files:**
- Create: `src/components/DormantAgentsList/index.tsx`
- Modify: `src/routes/agents.tsx`
- Modify: `src/hooks/useAgentFiltering.ts`

- [ ] **Step 1: Create DormantAgentsList component**

A list showing agents with `processState: 'dormant'`:

```tsx
interface DormantAgentsListProps {
  agents: Agent[];
  onReanimate: (id: string) => void;
  onDelete: (id: string) => void;
}

export function DormantAgentsList({ agents, onReanimate, onDelete }: DormantAgentsListProps) {
  const dormant = agents.filter(a => a.processState === 'dormant');
  // Renders a compact list of dormant agents with:
  // - Name + character emoji
  // - Last cwd
  // - Last activity timestamp
  // - "Wake up" button (calls onReanimate)
  // - Delete button (calls onDelete)
}
```

- [ ] **Step 2: Update agents.tsx for combined view**

Add `DormantAgentsList` below the active agents grid. Wire up `reanimateAgent` from `useElectronAgents`.

- [ ] **Step 3: Update useAgentFiltering**

Replace `agent.status` with `agent.processState` and `agent.projectPath` with `agent.cwd` in all filtering/sorting logic.

- [ ] **Step 4: Commit**

```bash
git add src/components/DormantAgentsList/ src/routes/agents.tsx src/hooks/useAgentFiltering.ts
git commit -m "feat(ui): add dormant agents list with reanimation support"
```

---

## Task 12: Frontend — TerminalsView Integration

**Files:**
- Modify: `src/components/TerminalsView/index.tsx`
- Modify: `src/hooks/useAgentTerminal.ts`
- Modify: `src/hooks/useSuperAgent.ts`

- [ ] **Step 1: Update TerminalsView to use backend tabs**

Replace `useTabManager()` calls with the new backend-backed version. Update all references from `agent.status` to `agent.processState` and `agent.projectPath` to `agent.cwd`.

- [ ] **Step 2: Wire terminal open → agent create**

When opening a new terminal in a tab, auto-create an Agent via `createAgent({ tabId, cwd: defaultDir })`. This is the "open terminal = create agent" flow.

- [ ] **Step 3: Wire terminal close → agent dormant**

When closing a terminal panel, call `setDormant(agentId)` instead of removing the agent.

- [ ] **Step 4: Update useAgentTerminal for output replay on reanimation**

In `useAgentTerminal`, when the agent has `output` buffer and the terminal is freshly opened, replay the stored output to xterm before subscribing to live events.

- [ ] **Step 5: Update useSuperAgent for flag-based detection**

Replace name-based Super Agent detection (`"Super Agent (Orchestrator)"`) with `agent.isSuperAgent === true`. Update `handleSuperAgentClick` to use `updateAgent({ isSuperAgent: true, superAgentScope: 'tab', skipPermissions: true })`.

- [ ] **Step 6: Commit**

```bash
git add src/components/TerminalsView/index.tsx src/hooks/useAgentTerminal.ts src/hooks/useSuperAgent.ts
git commit -m "feat(ui): integrate terminal lifecycle with Agent model — create/dormant/reanimate"
```

---

## Task 13: Frontend — Codebase-Wide Field Rename Sweep

**Files:**
- Modify: `src/components/CanvasView/types.ts`
- Modify: `src/components/CanvasView/hooks/useAgentActions.ts`
- Modify: `src/components/CanvasView/hooks/useCanvasNodes.ts`
- Modify: `src/components/CanvasView/hooks/useTerminalDialog.ts`
- Modify: `src/components/CanvasView/components/AgentNodeCard.tsx`
- Modify: `src/components/CanvasView/components/NotificationPanel.tsx`
- Modify: `src/components/CanvasView/index.tsx`
- Modify: `src/components/AgentTerminalDialog/AgentDialogTypes.ts`
- Modify: `src/components/AgentTerminalDialog/AgentDialogSuperAgentSidebar.tsx`
- Modify: `src/components/AgentTerminalDialog/AgentDialogSecondaryProject.tsx`
- Modify: `src/components/AgentTerminalDialog/index.tsx`
- Modify: `src/components/MosaicTerminalView/index.tsx`
- Modify: `src/components/MosaicTerminalView/TerminalTile.tsx`
- Modify: `src/components/Dashboard/AgentActivity.tsx`
- Modify: `src/components/Dashboard/index.tsx`
- Modify: `src/components/Dashboard/LiveTaskFeed.tsx`
- Modify: `src/components/TrayPanel/TrayPanel.tsx`
- Modify: `src/components/TrayPanel/useTrayTerminal.ts`
- Modify: `src/routes/console.tsx`
- Modify: `src/routes/projects.tsx`
- Modify: `src/store/index.ts`
- Modify: `src/lib/agent-manager.ts`
- Modify: `src/types/index.ts`
- Modify: `src/hooks/useAgents.ts`

This task covers all files missed in earlier tasks that reference old field names.

- [ ] **Step 1: Search and list all remaining old references**

Run these searches to find every remaining old reference:

```bash
# In src/ directory (TypeScript/React)
rg "AgentStatus" src/ --type ts --type tsx -l
rg "\.status\b" src/ --type ts --type tsx -l  # careful: may match CSS
rg "projectPath" src/ --type ts --type tsx -l
rg "currentTask" src/ --type ts --type tsx -l
rg "lastCleanOutput" src/ --type ts --type tsx -l
rg "secondaryProjectPath" src/ --type ts --type tsx -l
```

- [ ] **Step 2: Update CanvasView (7 files)**

In all CanvasView files:
- Replace `AgentStatus` type with `Agent`
- Replace `agent.status` with `agent.processState`
- Replace `agent.projectPath` with `agent.cwd`
- Update `AgentNode.status` type in `types.ts`
- Update status display in `AgentNodeCard.tsx` to use `processStateConfig`

- [ ] **Step 3: Update AgentTerminalDialog (4 files)**

- Replace `AgentStatus` with `Agent` in type definitions
- Update `AgentDialogSuperAgentSidebar.tsx` to use `agent.isSuperAgent` flag
- Replace `secondaryProjectPath` with `secondaryPaths` in `AgentDialogSecondaryProject.tsx`
- Update `index.tsx` field references

- [ ] **Step 4: Update MosaicTerminalView (2 files)**

- Replace `AgentStatus` with `Agent`
- Replace `agent.status` with `agent.processState`
- Replace `projectPath` with `cwd` in agent creation calls

- [ ] **Step 5: Update Dashboard (3 files)**

- Replace `agent.status` with `agent.processState`
- Replace `agent.projectPath` with `agent.cwd`
- Replace `currentTask` with `businessState`/`statusLine` in `LiveTaskFeed.tsx`

- [ ] **Step 6: Update TrayPanel (2 files)**

- Replace `AgentStatus` with `Agent`
- Replace `currentTask` with `businessState`/`statusLine`

- [ ] **Step 7: Update remaining files**

- `src/routes/console.tsx` — update `AgentStatus`/`projectPath` references
- `src/routes/projects.tsx` — update `AgentStatus`/`projectPath` references
- `src/store/index.ts` — replace `a.status === 'running'` with `a.processState === 'running'`
- `src/lib/agent-manager.ts` — update all old field references, remove `progress`
- `src/types/index.ts` — update or remove conflicting `AgentStatus`/`Agent` types, re-export from `electron.d.ts`
- `src/hooks/useAgents.ts` — update `AgentStatus` references

- [ ] **Step 8: Commit**

```bash
git add src/components/CanvasView/ src/components/AgentTerminalDialog/ src/components/MosaicTerminalView/ src/components/Dashboard/ src/components/TrayPanel/ src/routes/ src/store/ src/lib/ src/types/index.ts src/hooks/useAgents.ts
git commit -m "refactor: codebase-wide rename AgentStatus→Agent, status→processState, projectPath→cwd"
```

---

## Task 14: Frontend — Simplify NewChatModal

**Files:**
- Modify: `src/components/NewChatModal/index.tsx`
- Modify: `src/components/NewChatModal/types.ts`
- Modify: `src/components/NewChatModal/StepTask.tsx`
- Modify: `src/components/NewChatModal/StepModel.tsx`
- Modify: `src/components/NewChatModal/AgentPersonaEditor.tsx`
- Delete: `src/components/NewChatModal/StepProject.tsx`

- [ ] **Step 1: Update types.ts**

Remove `projectPath` and `secondaryProjectPath` from `EditAgentData`. Update `onSubmit` callback signature to not require `projectPath` as first parameter.

- [ ] **Step 2: Remove project step from wizard**

Remove the `StepProject` import and step from the wizard flow in `index.tsx`. The project is now derived from `cwd`.

- [ ] **Step 3: Update remaining step components**

Remove `projectPath` prop from `StepTask.tsx`, `StepModel.tsx`, and `AgentPersonaEditor.tsx`.

- [ ] **Step 4: Simplify to quick-create form**

Reduce the wizard to a single-page form with optional fields: name, role, provider, skills, prompt, persona. All fields optional — user can fill what they want and go.

- [ ] **Step 5: Delete `StepProject.tsx`**

- [ ] **Step 6: Commit**

```bash
git add src/components/NewChatModal/ && git rm src/components/NewChatModal/StepProject.tsx
git commit -m "feat(ui): simplify NewChatModal — remove project step, single-page quick-create"
```

---

## Task 15: MCP Orchestrator — New Tools + API Routes

**Files:**
- Create: `mcp-orchestrator/src/tools/business-state.ts`
- Modify: `mcp-orchestrator/src/tools/agents.ts`
- Modify: `mcp-orchestrator/src/index.ts`
- Modify: `src-tauri/src/lib.rs` (or wherever the HTTP API server routes are defined)

**Important:** The MCP orchestrator is a separate Node.js process that communicates with Dorothy via HTTP REST API (`http://127.0.0.1:31415/api/...`), NOT via Tauri IPC. New MCP tools need corresponding HTTP API routes in the Tauri backend.

- [ ] **Step 1: Update existing MCP agent tools**

In `agents.ts`, update field references: `agent.status` → `agent.processState`, `agent.projectPath` → `agent.cwd`, `agent.lastCleanOutput` → `agent.statusLine`. Update `create_agent` tool to not require `projectPath`.

- [ ] **Step 2: Add HTTP API routes for new commands**

Add API routes that the MCP server can call:
- `POST /api/agents/:id/business-state` → calls `agent_update_business_state`
- `GET /api/agents/team-status?tabId=X` → returns agents filtered by tab with processState + businessState
- `POST /api/agents/:id/promote` → calls `agent_update` with `isSuperAgent: true`
- `POST /api/agents/:id/demote` → calls `agent_update` with `isSuperAgent: false`

- [ ] **Step 3: Create businessState MCP tools**

Create `mcp-orchestrator/src/tools/business-state.ts`:

```typescript
// Tools:
// - update_agent_business_state(agentId, state) — calls POST /api/agents/:id/business-state
// - get_team_status(tabId?) — calls GET /api/agents/team-status
// - promote_super_agent(agentId, scope) — calls POST /api/agents/:id/promote
// - demote_super_agent(agentId) — calls POST /api/agents/:id/demote
```

Each tool calls the corresponding Dorothy HTTP API endpoint via `apiRequest()`.

- [ ] **Step 4: Register new tools in MCP server**

Add the new tools to the MCP server initialization in `mcp-orchestrator/src/index.ts`.

- [ ] **Step 5: Commit**

```bash
git add mcp-orchestrator/src/tools/business-state.ts mcp-orchestrator/src/tools/agents.ts mcp-orchestrator/src/index.ts src-tauri/src/
git commit -m "feat(mcp): add businessState, team status, and Super Agent promotion tools + API routes"
```

---

## Task 16: Tab Migration (Frontend → Backend)

**Files:**
- Modify: `src/components/TerminalsView/index.tsx`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add frontend migration check**

On first load in TerminalsView, check if localStorage `terminals-tab-manager` has data. If yes, call a Tauri command `migrate_tabs_from_localstorage(tabsJson)` that:
1. Creates tabs in `tabs.json` from the localStorage data
2. Updates each agent's `tabId` based on the old `agentIds` arrays
3. Returns success

Then clear the localStorage key.

- [ ] **Step 2: Add `migrate_tabs_from_localstorage` command in Rust**

```rust
#[tauri::command]
pub async fn migrate_tabs_from_localstorage(
    state: State<'_, AppState>,
    tabs_json: String,
) -> Result<(), String> {
    // Parse the old CustomTab[] format
    // Create Tab entries in tabs list
    // For each agent in CustomTab.agentIds, set agent.tabId
    // Agents not in any tab get assigned to "General"
    // Save both tabs and agents
    ...
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/TerminalsView/index.tsx src-tauri/src/lib.rs
git commit -m "feat(migration): one-shot localStorage tabs → backend tabs.json migration"
```

---

## Task 17: Integration Testing & Cleanup

**Files:**
- Modify: `__tests__/` test files as needed

- [ ] **Step 1: Verify full build**

Run: `cd src-tauri && cargo build && cd .. && npm run build`
Expected: Clean build with no errors.

- [ ] **Step 2: Fix remaining TypeScript errors**

Search for any remaining references to old field names (`agent.status`, `agent.projectPath`, `currentTask`, `AgentStatus`) across the codebase and update them.

Run: `npx tsc --noEmit 2>&1 | head -100`

- [ ] **Step 3: Update test files**

Update `__tests__/electron/services/api-routes/agent-routes.test.ts` and `__tests__/mcp/orchestrator-agents.test.ts` for new field names and types.

- [ ] **Step 4: Run tests**

Run: `npm test 2>&1 | tail -30`

- [ ] **Step 5: Verify migration with sample data**

Create a test `agents.json` in old format, run the app, verify it migrates correctly to v1 format with backup.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "fix: resolve remaining TypeScript errors and update tests for Agent unification"
```
