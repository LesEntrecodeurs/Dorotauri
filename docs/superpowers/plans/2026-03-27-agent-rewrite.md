# Agent Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the agent system from scratch with a Thin MCP Proxy + Event Bus architecture for real-time terminal observability.

**Architecture:** All business logic centralized in Rust. MCP Node.js proxy reduced to ~50 LOC HTTP forwarder. Tokio broadcast event bus enables real-time PTY streaming via duplex WebSocket. Provider trait abstracts CLI differences.

**Tech Stack:** Rust (Tauri 2 + Axum 0.8 + Tokio), TypeScript (MCP SDK + React), xterm.js, WebSocket

**Spec:** `docs/superpowers/specs/2026-03-27-agent-rewrite-design.md`

---

## File Structure

### Rust Backend (create or rewrite)

| File | Action | Responsibility |
|------|--------|----------------|
| `src-tauri/src/agent/mod.rs` | Create | Module re-exports |
| `src-tauri/src/agent/model.rs` | Create | Agent, AgentState, AgentRole, Scope structs |
| `src-tauri/src/agent/event_bus.rs` | Create | EventBus, AgentEvent, per-agent PTY channels |
| `src-tauri/src/agent/provider.rs` | Create | AgentProvider trait + Claude/Gemini/Codex impls |
| `src-tauri/src/agent/manager.rs` | Create | AgentManager — state machine, scope enforcement, persistence |
| `src-tauri/src/agent/pty_session.rs` | Create | PtySession — catch-up buffer, broadcast integration |
| `src-tauri/src/commands/agent.rs` | Rewrite | Tauri IPC commands using new agent module |
| `src-tauri/src/api_server.rs` | Rewrite | REST + WebSocket endpoints |
| `src-tauri/src/state.rs` | Modify | AppState uses new agent module types |
| `src-tauri/src/lib.rs` | Modify | Boot sequence wires new modules |
| `src-tauri/Cargo.toml` | Modify | Add `bytes` dep, enable axum `ws` feature |

### MCP Thin Proxy (rewrite)

| File | Action | Responsibility |
|------|--------|----------------|
| `mcp-orchestrator/src/index.ts` | Rewrite | Thin proxy — MCP protocol + HTTP forwarding only |
| `mcp-orchestrator/src/tools/agents.ts` | Rewrite | Thin HTTP proxy (was full business logic) |
| `mcp-orchestrator/src/tools/scheduler.ts` | Keep | Out of scope for this rewrite |
| `mcp-orchestrator/src/tools/automations.ts` | Keep | Out of scope for this rewrite |
| `mcp-orchestrator/src/tools/messaging.ts` | Keep | Out of scope for this rewrite |
| `mcp-orchestrator/src/utils/api.ts` | Keep | Shared HTTP client |

### Frontend (modify)

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types/electron.d.ts` | Modify | Update Agent type, add AgentRole/Scope |
| `src/hooks/useAgentWebSocket.ts` | Create | WebSocket hooks for /ws/events and /ws/pty/{id} |
| `src/hooks/useElectron.ts` | Modify | Wire new WebSocket hooks into agent event handling |
| `src/components/AgentTerminalDialog/useAgentDialogTerminal.ts` | Rewrite | WebSocket duplex terminal instead of Tauri events |
| `src/components/AgentList/AgentCard.tsx` | Modify | Parent-child hierarchy display |
| `src/components/AgentTerminalDialog/index.tsx` | Modify | Auto-open sub-agent tabs, interference warning |

### Support Files (modify)

| File | Action | Responsibility |
|------|--------|----------------|
| `electron/resources/super-agent-instructions.md` | Rewrite | Simplified instructions, core tools only |
| `hooks/session-end.sh` | Keep | Unchanged — still reports via /api/hooks/output |
| `hooks/user-prompt-submit.sh` | Keep | Unchanged — still reports via /api/hooks/status |

---

## Task 1: Add Dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add bytes crate and enable axum ws feature**

In `src-tauri/Cargo.toml`, update the `[dependencies]` section:

```toml
# Change axum line from:
axum = "0.8"
# To:
axum = { version = "0.8", features = ["ws"] }

# Add after the axum line:
bytes = "1"
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: compilation succeeds (warnings OK)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "deps: add bytes crate and axum ws feature for agent rewrite"
```

---

## Task 2: Agent Model Types

**Files:**
- Create: `src-tauri/src/agent/mod.rs`
- Create: `src-tauri/src/agent/model.rs`

- [ ] **Step 1: Create the agent module directory**

Run: `mkdir -p src-tauri/src/agent`

- [ ] **Step 2: Write tests for agent model**

Create `src-tauri/src/agent/model.rs` with tests at the bottom:

```rust
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub type AgentId = String;
pub type TabId = String;
pub type PtyId = String;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AgentState {
    Inactive,
    Running,
    Waiting,
    Completed,
    Error,
    Dormant,
}

impl Default for AgentState {
    fn default() -> Self {
        AgentState::Inactive
    }
}

impl AgentState {
    /// Returns true if this state represents a terminal/idle state
    /// that the wait endpoint should return on.
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            AgentState::Completed | AgentState::Error | AgentState::Inactive | AgentState::Waiting
        )
    }

    /// Returns true if the agent has an active PTY.
    pub fn is_active(&self) -> bool {
        matches!(self, AgentState::Running | AgentState::Waiting)
    }

    /// Validate a state transition. Returns Ok(()) if valid.
    pub fn can_transition_to(&self, next: &AgentState) -> Result<(), String> {
        // Any state can transition to Dormant (terminal close)
        if matches!(next, AgentState::Dormant) {
            return Ok(());
        }

        match (self, next) {
            // Inactive can start
            (AgentState::Inactive, AgentState::Running) => Ok(()),
            // Running can complete, error, or wait
            (AgentState::Running, AgentState::Completed) => Ok(()),
            (AgentState::Running, AgentState::Error) => Ok(()),
            (AgentState::Running, AgentState::Waiting) => Ok(()),
            // Waiting can resume running
            (AgentState::Waiting, AgentState::Running) => Ok(()),
            // Dormant can reanimate to inactive
            (AgentState::Dormant, AgentState::Inactive) => Ok(()),
            // Completed/Error can restart
            (AgentState::Completed, AgentState::Running) => Ok(()),
            (AgentState::Error, AgentState::Running) => Ok(()),
            // Also allow stopping (to inactive) from any active state
            (AgentState::Running, AgentState::Inactive) => Ok(()),
            (AgentState::Waiting, AgentState::Inactive) => Ok(()),
            _ => Err(format!(
                "invalid state transition: {:?} → {:?}",
                self, next
            )),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    Tab,
    Workspace,
    Global,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum AgentRole {
    Normal,
    Super { scope: Scope },
}

impl Default for AgentRole {
    fn default() -> Self {
        AgentRole::Normal
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Claude,
    Codex,
    Gemini,
    Opencode,
    Pi,
    Local,
}

impl Default for Provider {
    fn default() -> Self {
        Provider::Claude
    }
}

impl Provider {
    pub fn from_str_opt(s: Option<&str>) -> Self {
        match s {
            Some("codex") => Provider::Codex,
            Some("gemini") => Provider::Gemini,
            Some("opencode") => Provider::Opencode,
            Some("pi") => Provider::Pi,
            Some("local") => Provider::Local,
            _ => Provider::Claude,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: AgentId,
    pub name: Option<String>,
    pub provider: Provider,

    // Topology
    pub tab_id: TabId,
    pub parent_id: Option<AgentId>,

    // Runtime
    pub state: AgentState,
    pub pty_id: Option<PtyId>,

    // Role
    pub role: AgentRole,

    // Config
    pub cwd: String,
    pub secondary_paths: Vec<String>,
    pub skills: Vec<String>,
    pub character: Option<String>,

    // Output
    pub status_line: Option<String>,
    pub error: Option<String>,

    // Timestamps
    pub last_activity: String,
    pub created_at: String,
}

impl Agent {
    pub fn new(id: AgentId, cwd: String, tab_id: TabId) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Agent {
            id,
            name: None,
            provider: Provider::default(),
            tab_id,
            parent_id: None,
            state: AgentState::default(),
            pty_id: None,
            role: AgentRole::default(),
            cwd,
            secondary_paths: Vec::new(),
            skills: Vec::new(),
            character: None,
            status_line: None,
            error: None,
            last_activity: now.clone(),
            created_at: now,
        }
    }

    pub fn is_super_agent(&self) -> bool {
        matches!(self.role, AgentRole::Super { .. })
    }

    pub fn scope(&self) -> Option<&Scope> {
        match &self.role {
            AgentRole::Super { scope } => Some(scope),
            AgentRole::Normal => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_state_default_is_inactive() {
        assert_eq!(AgentState::default(), AgentState::Inactive);
    }

    #[test]
    fn test_valid_state_transitions() {
        // Normal lifecycle
        assert!(AgentState::Inactive.can_transition_to(&AgentState::Running).is_ok());
        assert!(AgentState::Running.can_transition_to(&AgentState::Completed).is_ok());
        assert!(AgentState::Running.can_transition_to(&AgentState::Error).is_ok());
        assert!(AgentState::Running.can_transition_to(&AgentState::Waiting).is_ok());
        assert!(AgentState::Waiting.can_transition_to(&AgentState::Running).is_ok());

        // Dormant transitions
        assert!(AgentState::Running.can_transition_to(&AgentState::Dormant).is_ok());
        assert!(AgentState::Inactive.can_transition_to(&AgentState::Dormant).is_ok());
        assert!(AgentState::Dormant.can_transition_to(&AgentState::Inactive).is_ok());

        // Restart from terminal states
        assert!(AgentState::Completed.can_transition_to(&AgentState::Running).is_ok());
        assert!(AgentState::Error.can_transition_to(&AgentState::Running).is_ok());

        // Stop active agents
        assert!(AgentState::Running.can_transition_to(&AgentState::Inactive).is_ok());
        assert!(AgentState::Waiting.can_transition_to(&AgentState::Inactive).is_ok());
    }

    #[test]
    fn test_invalid_state_transitions() {
        assert!(AgentState::Inactive.can_transition_to(&AgentState::Completed).is_err());
        assert!(AgentState::Completed.can_transition_to(&AgentState::Waiting).is_err());
        assert!(AgentState::Inactive.can_transition_to(&AgentState::Waiting).is_err());
    }

    #[test]
    fn test_is_terminal() {
        assert!(AgentState::Completed.is_terminal());
        assert!(AgentState::Error.is_terminal());
        assert!(AgentState::Inactive.is_terminal());
        assert!(AgentState::Waiting.is_terminal());
        assert!(!AgentState::Running.is_terminal());
        assert!(!AgentState::Dormant.is_terminal());
    }

    #[test]
    fn test_is_active() {
        assert!(AgentState::Running.is_active());
        assert!(AgentState::Waiting.is_active());
        assert!(!AgentState::Inactive.is_active());
        assert!(!AgentState::Completed.is_active());
    }

    #[test]
    fn test_agent_role_default_is_normal() {
        assert_eq!(AgentRole::default(), AgentRole::Normal);
    }

    #[test]
    fn test_agent_is_super() {
        let mut agent = Agent::new("a1".into(), "/tmp".into(), "t1".into());
        assert!(!agent.is_super_agent());
        assert!(agent.scope().is_none());

        agent.role = AgentRole::Super { scope: Scope::Tab };
        assert!(agent.is_super_agent());
        assert_eq!(agent.scope(), Some(&Scope::Tab));
    }

    #[test]
    fn test_provider_from_str() {
        assert_eq!(Provider::from_str_opt(Some("claude")), Provider::Claude);
        assert_eq!(Provider::from_str_opt(Some("codex")), Provider::Codex);
        assert_eq!(Provider::from_str_opt(Some("gemini")), Provider::Gemini);
        assert_eq!(Provider::from_str_opt(None), Provider::Claude);
        assert_eq!(Provider::from_str_opt(Some("unknown")), Provider::Claude);
    }

    #[test]
    fn test_agent_serializes_to_camel_case() {
        let agent = Agent::new("a1".into(), "/tmp".into(), "t1".into());
        let json = serde_json::to_value(&agent).unwrap();
        assert!(json.get("tabId").is_some());
        assert!(json.get("parentId").is_some());
        assert!(json.get("statusLine").is_some());
        assert!(json.get("createdAt").is_some());
    }

    #[test]
    fn test_agent_state_serializes_lowercase() {
        let json = serde_json::to_string(&AgentState::Running).unwrap();
        assert_eq!(json, "\"running\"");
        let json = serde_json::to_string(&AgentState::Inactive).unwrap();
        assert_eq!(json, "\"inactive\"");
    }

    #[test]
    fn test_agent_role_serializes_tagged() {
        let role = AgentRole::Super { scope: Scope::Tab };
        let json = serde_json::to_value(&role).unwrap();
        assert_eq!(json["type"], "super");
        assert_eq!(json["scope"], "tab");

        let role = AgentRole::Normal;
        let json = serde_json::to_value(&role).unwrap();
        assert_eq!(json["type"], "normal");
    }
}
```

- [ ] **Step 3: Create module file**

Create `src-tauri/src/agent/mod.rs`:

```rust
pub mod model;
```

- [ ] **Step 4: Wire into main crate**

In `src-tauri/src/lib.rs`, add at the top (with other `mod` declarations):

```rust
mod agent;
```

- [ ] **Step 5: Run tests**

Run: `cd src-tauri && cargo test agent::model::tests -- --nocapture 2>&1 | tail -20`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/agent/
git commit -m "feat(agent): add new Agent model types — AgentState, AgentRole, Scope, Provider"
```

---

## Task 3: Event Bus

**Files:**
- Create: `src-tauri/src/agent/event_bus.rs`
- Modify: `src-tauri/src/agent/mod.rs`

- [ ] **Step 1: Write event bus with tests**

Create `src-tauri/src/agent/event_bus.rs`:

```rust
use bytes::Bytes;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::broadcast;

use super::model::{AgentId, AgentState, TabId};

/// Capacity for the global event channel. Low frequency — 256 is generous.
const GLOBAL_CHANNEL_CAPACITY: usize = 256;

/// Capacity for per-agent PTY channels. High frequency — needs headroom.
const PTY_CHANNEL_CAPACITY: usize = 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    Created {
        agent_id: AgentId,
        parent_id: Option<AgentId>,
        tab_id: TabId,
    },
    StateChanged {
        agent_id: AgentId,
        old: AgentState,
        new: AgentState,
    },
    Removed {
        agent_id: AgentId,
    },
    StatusLineUpdated {
        agent_id: AgentId,
        line: String,
    },
}

pub struct EventBus {
    /// Global channel for structured agent events (lifecycle, status).
    global_tx: broadcast::Sender<AgentEvent>,

    /// Per-agent PTY output channels (raw bytes, high frequency).
    pty_channels: Mutex<HashMap<AgentId, broadcast::Sender<Bytes>>>,
}

impl EventBus {
    pub fn new() -> Self {
        let (global_tx, _) = broadcast::channel(GLOBAL_CHANNEL_CAPACITY);
        EventBus {
            global_tx,
            pty_channels: Mutex::new(HashMap::new()),
        }
    }

    /// Emit a structured agent event on the global channel.
    pub fn emit(&self, event: AgentEvent) {
        // Ignore send errors — means no receivers are subscribed.
        let _ = self.global_tx.send(event);
    }

    /// Subscribe to the global event stream.
    pub fn subscribe_events(&self) -> broadcast::Receiver<AgentEvent> {
        self.global_tx.subscribe()
    }

    /// Create a PTY output channel for an agent. Call when spawning a PTY.
    pub fn create_pty_channel(&self, agent_id: &AgentId) -> broadcast::Sender<Bytes> {
        let (tx, _) = broadcast::channel(PTY_CHANNEL_CAPACITY);
        let tx_clone = tx.clone();
        self.pty_channels
            .lock()
            .unwrap()
            .insert(agent_id.clone(), tx);
        tx_clone
    }

    /// Remove a PTY channel. Call when killing a PTY.
    pub fn remove_pty_channel(&self, agent_id: &AgentId) {
        self.pty_channels.lock().unwrap().remove(agent_id);
    }

    /// Subscribe to a specific agent's PTY output stream.
    /// Returns None if the agent has no active PTY channel.
    pub fn subscribe_pty(&self, agent_id: &AgentId) -> Option<broadcast::Receiver<Bytes>> {
        self.pty_channels
            .lock()
            .unwrap()
            .get(agent_id)
            .map(|tx| tx.subscribe())
    }

    /// Push raw bytes to an agent's PTY channel.
    /// Returns false if no channel exists for this agent.
    pub fn push_pty_output(&self, agent_id: &AgentId, data: Bytes) -> bool {
        if let Some(tx) = self.pty_channels.lock().unwrap().get(agent_id) {
            let _ = tx.send(data);
            true
        } else {
            false
        }
    }

    /// Check if a PTY channel exists for an agent.
    pub fn has_pty_channel(&self, agent_id: &AgentId) -> bool {
        self.pty_channels.lock().unwrap().contains_key(agent_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_emit_with_no_subscribers_does_not_panic() {
        let bus = EventBus::new();
        bus.emit(AgentEvent::Removed {
            agent_id: "a1".into(),
        });
        // Should not panic
    }

    #[test]
    fn test_subscribe_receives_events() {
        let bus = EventBus::new();
        let mut rx = bus.subscribe_events();

        bus.emit(AgentEvent::Created {
            agent_id: "a1".into(),
            parent_id: None,
            tab_id: "t1".into(),
        });

        let event = rx.try_recv().unwrap();
        match event {
            AgentEvent::Created { agent_id, .. } => assert_eq!(agent_id, "a1"),
            _ => panic!("unexpected event type"),
        }
    }

    #[test]
    fn test_multiple_subscribers_receive_same_event() {
        let bus = EventBus::new();
        let mut rx1 = bus.subscribe_events();
        let mut rx2 = bus.subscribe_events();

        bus.emit(AgentEvent::Removed {
            agent_id: "a1".into(),
        });

        assert!(rx1.try_recv().is_ok());
        assert!(rx2.try_recv().is_ok());
    }

    #[test]
    fn test_pty_channel_lifecycle() {
        let bus = EventBus::new();

        // No channel initially
        assert!(!bus.has_pty_channel(&"a1".into()));
        assert!(bus.subscribe_pty(&"a1".into()).is_none());

        // Create channel
        let _tx = bus.create_pty_channel(&"a1".into());
        assert!(bus.has_pty_channel(&"a1".into()));

        // Subscribe and push
        let mut rx = bus.subscribe_pty(&"a1".into()).unwrap();
        bus.push_pty_output(&"a1".into(), Bytes::from("hello"));
        let data = rx.try_recv().unwrap();
        assert_eq!(data, Bytes::from("hello"));

        // Remove channel
        bus.remove_pty_channel(&"a1".into());
        assert!(!bus.has_pty_channel(&"a1".into()));
    }

    #[test]
    fn test_push_pty_output_returns_false_when_no_channel() {
        let bus = EventBus::new();
        assert!(!bus.push_pty_output(&"nonexistent".into(), Bytes::from("data")));
    }

    #[test]
    fn test_agent_event_serializes_as_snake_case_tagged() {
        let event = AgentEvent::StateChanged {
            agent_id: "a1".into(),
            old: AgentState::Inactive,
            new: AgentState::Running,
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "state_changed");
        assert_eq!(json["agent_id"], "a1");
        assert_eq!(json["old"], "inactive");
        assert_eq!(json["new"], "running");
    }
}
```

- [ ] **Step 2: Add module to agent/mod.rs**

Update `src-tauri/src/agent/mod.rs`:

```rust
pub mod model;
pub mod event_bus;
```

- [ ] **Step 3: Run tests**

Run: `cd src-tauri && cargo test agent::event_bus::tests -- --nocapture 2>&1 | tail -20`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/agent/event_bus.rs src-tauri/src/agent/mod.rs
git commit -m "feat(agent): add EventBus with global events + per-agent PTY channels"
```

---

## Task 4: Provider Trait

**Files:**
- Create: `src-tauri/src/agent/provider.rs`
- Modify: `src-tauri/src/agent/mod.rs`

- [ ] **Step 1: Write provider trait with tests**

Create `src-tauri/src/agent/provider.rs`:

```rust
use std::path::PathBuf;

use super::model::Provider;

pub struct AgentStartConfig {
    pub prompt: String,
    pub cwd: PathBuf,
    pub skip_permissions: bool,
    pub mcp_config: Option<PathBuf>,
    pub system_prompt_file: Option<PathBuf>,
    pub model: Option<String>,
    pub secondary_paths: Vec<String>,
    pub continue_session: bool,
}

pub trait AgentProviderTrait {
    fn name(&self) -> &str;
    fn build_command(&self, config: &AgentStartConfig, cli_path: Option<&str>) -> Vec<String>;
    fn supports_mcp(&self) -> bool;
    fn supports_skip_permissions(&self) -> bool;
    fn supports_system_prompt_file(&self) -> bool;
}

pub struct ClaudeProvider;

impl AgentProviderTrait for ClaudeProvider {
    fn name(&self) -> &str {
        "claude"
    }

    fn build_command(&self, config: &AgentStartConfig, cli_path: Option<&str>) -> Vec<String> {
        let mut cmd = vec![cli_path.unwrap_or("claude").to_string()];

        if config.skip_permissions {
            cmd.push("--dangerously-skip-permissions".into());
        }
        if let Some(mcp) = &config.mcp_config {
            cmd.push("--mcp-config".into());
            cmd.push(mcp.to_string_lossy().to_string());
        }
        if let Some(f) = &config.system_prompt_file {
            cmd.push("--append-system-prompt-file".into());
            cmd.push(f.to_string_lossy().to_string());
        }
        if config.continue_session {
            cmd.push("--continue".into());
        }
        for path in &config.secondary_paths {
            cmd.push("--add-dir".into());
            cmd.push(path.clone());
        }
        if let Some(model) = &config.model {
            cmd.push("--model".into());
            cmd.push(model.clone());
        }
        if !config.prompt.is_empty() {
            cmd.push("--print".into());
            cmd.push(shell_escape_prompt(&config.prompt));
        }

        cmd
    }

    fn supports_mcp(&self) -> bool {
        true
    }
    fn supports_skip_permissions(&self) -> bool {
        true
    }
    fn supports_system_prompt_file(&self) -> bool {
        true
    }
}

pub struct CodexProvider;

impl AgentProviderTrait for CodexProvider {
    fn name(&self) -> &str {
        "codex"
    }

    fn build_command(&self, config: &AgentStartConfig, cli_path: Option<&str>) -> Vec<String> {
        let mut cmd = vec![cli_path.unwrap_or("codex").to_string()];

        if config.skip_permissions {
            cmd.push("--full-auto".into());
        }
        if !config.prompt.is_empty() {
            cmd.push(shell_escape_prompt(&config.prompt));
        }

        cmd
    }

    fn supports_mcp(&self) -> bool {
        false
    }
    fn supports_skip_permissions(&self) -> bool {
        true
    }
    fn supports_system_prompt_file(&self) -> bool {
        false
    }
}

pub struct GeminiProvider;

impl AgentProviderTrait for GeminiProvider {
    fn name(&self) -> &str {
        "gemini"
    }

    fn build_command(&self, config: &AgentStartConfig, cli_path: Option<&str>) -> Vec<String> {
        let mut cmd = vec![cli_path.unwrap_or("gemini").to_string()];

        if config.skip_permissions {
            cmd.push("-y".into());
        }
        if !config.prompt.is_empty() {
            cmd.push("-p".into());
            cmd.push(shell_escape_prompt(&config.prompt));
        }

        cmd
    }

    fn supports_mcp(&self) -> bool {
        false
    }
    fn supports_skip_permissions(&self) -> bool {
        true
    }
    fn supports_system_prompt_file(&self) -> bool {
        false
    }
}

pub struct OpencodeProvider;

impl AgentProviderTrait for OpencodeProvider {
    fn name(&self) -> &str {
        "opencode"
    }

    fn build_command(&self, config: &AgentStartConfig, cli_path: Option<&str>) -> Vec<String> {
        let mut cmd = vec![cli_path.unwrap_or("opencode").to_string()];

        if config.skip_permissions {
            cmd.push("--auto-approve".into());
        }
        if !config.prompt.is_empty() {
            cmd.push("--prompt".into());
            cmd.push(shell_escape_prompt(&config.prompt));
        }

        cmd
    }

    fn supports_mcp(&self) -> bool {
        false
    }
    fn supports_skip_permissions(&self) -> bool {
        true
    }
    fn supports_system_prompt_file(&self) -> bool {
        false
    }
}

/// Get a provider implementation for the given provider enum.
pub fn get_provider(provider: &Provider) -> Box<dyn AgentProviderTrait> {
    match provider {
        Provider::Claude => Box::new(ClaudeProvider),
        Provider::Codex => Box::new(CodexProvider),
        Provider::Gemini => Box::new(GeminiProvider),
        Provider::Opencode => Box::new(OpencodeProvider),
        Provider::Pi | Provider::Local => Box::new(ClaudeProvider), // fallback
    }
}

/// Shell-escape a prompt string for safe embedding in a CLI command.
fn shell_escape_prompt(prompt: &str) -> String {
    let escaped = prompt
        .replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace('\'', "'\\''");
    format!("'{}'", escaped)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_config(prompt: &str) -> AgentStartConfig {
        AgentStartConfig {
            prompt: prompt.to_string(),
            cwd: PathBuf::from("/tmp"),
            skip_permissions: false,
            mcp_config: None,
            system_prompt_file: None,
            model: None,
            secondary_paths: Vec::new(),
            continue_session: false,
        }
    }

    #[test]
    fn test_claude_basic_command() {
        let provider = ClaudeProvider;
        let config = default_config("hello world");
        let cmd = provider.build_command(&config, None);
        assert_eq!(cmd[0], "claude");
        assert!(cmd.contains(&"--print".to_string()));
    }

    #[test]
    fn test_claude_skip_permissions() {
        let provider = ClaudeProvider;
        let mut config = default_config("test");
        config.skip_permissions = true;
        let cmd = provider.build_command(&config, None);
        assert!(cmd.contains(&"--dangerously-skip-permissions".to_string()));
    }

    #[test]
    fn test_claude_super_agent_flags() {
        let provider = ClaudeProvider;
        let mut config = default_config("orchestrate");
        config.skip_permissions = true;
        config.mcp_config = Some(PathBuf::from("/home/user/.claude/mcp.json"));
        config.system_prompt_file = Some(PathBuf::from("/home/user/.dorotoring/instructions.md"));
        let cmd = provider.build_command(&config, None);

        assert!(cmd.contains(&"--dangerously-skip-permissions".to_string()));
        assert!(cmd.contains(&"--mcp-config".to_string()));
        assert!(cmd.contains(&"--append-system-prompt-file".to_string()));
    }

    #[test]
    fn test_claude_secondary_paths() {
        let provider = ClaudeProvider;
        let mut config = default_config("test");
        config.secondary_paths = vec!["/path/a".into(), "/path/b".into()];
        let cmd = provider.build_command(&config, None);

        let add_dir_count = cmd.iter().filter(|s| *s == "--add-dir").count();
        assert_eq!(add_dir_count, 2);
    }

    #[test]
    fn test_claude_custom_cli_path() {
        let provider = ClaudeProvider;
        let config = default_config("test");
        let cmd = provider.build_command(&config, Some("/usr/local/bin/claude"));
        assert_eq!(cmd[0], "/usr/local/bin/claude");
    }

    #[test]
    fn test_codex_full_auto() {
        let provider = CodexProvider;
        let mut config = default_config("test");
        config.skip_permissions = true;
        let cmd = provider.build_command(&config, None);
        assert!(cmd.contains(&"--full-auto".to_string()));
        assert!(!cmd.contains(&"--dangerously-skip-permissions".to_string()));
    }

    #[test]
    fn test_codex_no_mcp_support() {
        let provider = CodexProvider;
        assert!(!provider.supports_mcp());
    }

    #[test]
    fn test_gemini_skip_permissions() {
        let provider = GeminiProvider;
        let mut config = default_config("test");
        config.skip_permissions = true;
        let cmd = provider.build_command(&config, None);
        assert!(cmd.contains(&"-y".to_string()));
    }

    #[test]
    fn test_gemini_prompt_flag() {
        let provider = GeminiProvider;
        let config = default_config("hello");
        let cmd = provider.build_command(&config, None);
        assert!(cmd.contains(&"-p".to_string()));
    }

    #[test]
    fn test_get_provider_returns_correct_type() {
        let p = get_provider(&Provider::Claude);
        assert_eq!(p.name(), "claude");
        assert!(p.supports_mcp());

        let p = get_provider(&Provider::Codex);
        assert_eq!(p.name(), "codex");
        assert!(!p.supports_mcp());

        let p = get_provider(&Provider::Gemini);
        assert_eq!(p.name(), "gemini");
    }

    #[test]
    fn test_shell_escape_single_quotes() {
        let result = shell_escape_prompt("it's a test");
        assert_eq!(result, "'it'\\''s a test'");
    }

    #[test]
    fn test_shell_escape_newlines() {
        let result = shell_escape_prompt("line1\nline2");
        assert_eq!(result, "'line1\\nline2'");
    }

    #[test]
    fn test_claude_continue_session() {
        let provider = ClaudeProvider;
        let mut config = default_config("test");
        config.continue_session = true;
        let cmd = provider.build_command(&config, None);
        assert!(cmd.contains(&"--continue".to_string()));
    }

    #[test]
    fn test_empty_prompt_no_print_flag() {
        let provider = ClaudeProvider;
        let config = default_config("");
        let cmd = provider.build_command(&config, None);
        assert!(!cmd.contains(&"--print".to_string()));
    }
}
```

- [ ] **Step 2: Add module to agent/mod.rs**

Update `src-tauri/src/agent/mod.rs`:

```rust
pub mod model;
pub mod event_bus;
pub mod provider;
```

- [ ] **Step 3: Run tests**

Run: `cd src-tauri && cargo test agent::provider::tests -- --nocapture 2>&1 | tail -20`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/agent/provider.rs src-tauri/src/agent/mod.rs
git commit -m "feat(agent): add AgentProvider trait with Claude/Codex/Gemini/Opencode impls"
```

---

## Task 5: Agent Manager — Scope Enforcement + State Machine

**Files:**
- Create: `src-tauri/src/agent/manager.rs`
- Modify: `src-tauri/src/agent/mod.rs`

- [ ] **Step 1: Write agent manager with tests**

Create `src-tauri/src/agent/manager.rs`:

```rust
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::Mutex;

use super::event_bus::{AgentEvent, EventBus};
use super::model::{Agent, AgentId, AgentRole, AgentState, Provider, Scope, TabId};

/// Manages agent state, persistence, and scope enforcement.
pub struct AgentManager {
    agents: Mutex<HashMap<AgentId, Agent>>,
    event_bus: Arc<EventBus>,
    data_dir: PathBuf,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct AgentsFile {
    #[serde(default = "default_schema_version")]
    schema_version: u32,
    agents: HashMap<AgentId, Agent>,
}

fn default_schema_version() -> u32 {
    1
}

impl AgentManager {
    pub fn new(event_bus: Arc<EventBus>, data_dir: PathBuf) -> Self {
        AgentManager {
            agents: Mutex::new(HashMap::new()),
            event_bus,
            data_dir,
        }
    }

    /// Load agents from disk.
    pub async fn load(&self) {
        let path = self.data_dir.join("agents.json");
        if !path.exists() {
            return;
        }
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => return,
        };
        let file: AgentsFile = match serde_json::from_str(&content) {
            Ok(f) => f,
            Err(_) => return,
        };
        let mut agents = self.agents.lock().await;
        *agents = file.agents;
    }

    /// Save agents to disk.
    pub async fn save(&self) {
        let agents = self.agents.lock().await;
        let file = AgentsFile {
            schema_version: 2,
            agents: agents.clone(),
        };
        let path = self.data_dir.join("agents.json");
        if let Ok(json) = serde_json::to_string_pretty(&file) {
            let _ = std::fs::write(&path, json);
        }
    }

    /// Create a new agent.
    pub async fn create(&self, agent: Agent) -> Agent {
        let agent_clone = agent.clone();
        self.agents
            .lock()
            .await
            .insert(agent.id.clone(), agent.clone());
        self.event_bus.emit(AgentEvent::Created {
            agent_id: agent.id.clone(),
            parent_id: agent.parent_id.clone(),
            tab_id: agent.tab_id.clone(),
        });
        self.save().await;
        agent_clone
    }

    /// Get an agent by ID.
    pub async fn get(&self, id: &AgentId) -> Option<Agent> {
        self.agents.lock().await.get(id).cloned()
    }

    /// List all agents, optionally filtered by tab_id.
    pub async fn list(&self, tab_id: Option<&TabId>) -> Vec<Agent> {
        let agents = self.agents.lock().await;
        agents
            .values()
            .filter(|a| tab_id.map_or(true, |tid| &a.tab_id == tid))
            .cloned()
            .collect()
    }

    /// Remove an agent.
    pub async fn remove(&self, id: &AgentId) -> Option<Agent> {
        let removed = self.agents.lock().await.remove(id);
        if removed.is_some() {
            self.event_bus.emit(AgentEvent::Removed {
                agent_id: id.clone(),
            });
            self.save().await;
        }
        removed
    }

    /// Update agent state with transition validation.
    pub async fn set_state(&self, id: &AgentId, new_state: AgentState) -> Result<Agent, String> {
        let mut agents = self.agents.lock().await;
        let agent = agents.get_mut(id).ok_or("agent not found")?;
        let old_state = agent.state.clone();
        old_state.can_transition_to(&new_state)?;

        agent.state = new_state.clone();
        agent.last_activity = chrono::Utc::now().to_rfc3339();
        let agent_clone = agent.clone();

        // Release lock before emitting
        drop(agents);

        self.event_bus.emit(AgentEvent::StateChanged {
            agent_id: id.clone(),
            old: old_state,
            new: new_state,
        });

        self.save().await;
        Ok(agent_clone)
    }

    /// Update mutable fields on an agent. Returns the updated agent.
    pub async fn update<F>(&self, id: &AgentId, updater: F) -> Result<Agent, String>
    where
        F: FnOnce(&mut Agent),
    {
        let mut agents = self.agents.lock().await;
        let agent = agents.get_mut(id).ok_or("agent not found")?;
        updater(agent);
        agent.last_activity = chrono::Utc::now().to_rfc3339();
        let agent_clone = agent.clone();
        drop(agents);
        self.save().await;
        Ok(agent_clone)
    }

    /// Promote an agent to Super Agent with the given scope.
    /// Returns error if the provider doesn't support MCP.
    pub async fn promote_super(
        &self,
        id: &AgentId,
        scope: Scope,
    ) -> Result<Agent, String> {
        let mut agents = self.agents.lock().await;
        let agent = agents.get_mut(id).ok_or("agent not found")?;

        let provider_impl = super::provider::get_provider(&agent.provider);
        if !provider_impl.supports_mcp() {
            return Err(format!(
                "provider '{}' does not support MCP — cannot promote to Super Agent",
                provider_impl.name()
            ));
        }

        agent.role = AgentRole::Super { scope };
        agent.last_activity = chrono::Utc::now().to_rfc3339();
        let agent_clone = agent.clone();
        drop(agents);
        self.save().await;
        Ok(agent_clone)
    }

    /// Enforce scope: can the caller agent access the target agent?
    pub fn enforce_scope(caller: &Agent, target: &Agent) -> Result<(), String> {
        match &caller.role {
            AgentRole::Normal => Err("caller is not a super agent".into()),
            AgentRole::Super { scope } => match scope {
                Scope::Tab => {
                    if caller.tab_id != target.tab_id {
                        Err(format!(
                            "agent '{}' is outside your tab scope (caller tab: {}, target tab: {})",
                            target.id, caller.tab_id, target.tab_id
                        ))
                    } else {
                        Ok(())
                    }
                }
                Scope::Workspace | Scope::Global => Ok(()),
            },
        }
    }

    /// Set status_line for an agent (called by hooks).
    pub async fn set_status_line(&self, id: &AgentId, line: String) {
        let mut agents = self.agents.lock().await;
        if let Some(agent) = agents.get_mut(id) {
            agent.status_line = Some(line.clone());
        }
        drop(agents);

        self.event_bus.emit(AgentEvent::StatusLineUpdated {
            agent_id: id.clone(),
            line,
        });
        self.save().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    async fn test_manager() -> (AgentManager, Arc<EventBus>) {
        let bus = Arc::new(EventBus::new());
        let dir = tempdir().unwrap();
        let mgr = AgentManager::new(bus.clone(), dir.path().to_path_buf());
        (mgr, bus)
    }

    #[tokio::test]
    async fn test_create_and_get() {
        let (mgr, _bus) = test_manager().await;
        let agent = Agent::new("a1".into(), "/tmp".into(), "t1".into());
        mgr.create(agent.clone()).await;

        let found = mgr.get(&"a1".into()).await;
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, "a1");
    }

    #[tokio::test]
    async fn test_create_emits_event() {
        let (mgr, bus) = test_manager().await;
        let mut rx = bus.subscribe_events();

        let agent = Agent::new("a1".into(), "/tmp".into(), "t1".into());
        mgr.create(agent).await;

        let event = rx.try_recv().unwrap();
        match event {
            AgentEvent::Created { agent_id, .. } => assert_eq!(agent_id, "a1"),
            _ => panic!("expected Created event"),
        }
    }

    #[tokio::test]
    async fn test_list_all() {
        let (mgr, _) = test_manager().await;
        mgr.create(Agent::new("a1".into(), "/tmp".into(), "t1".into())).await;
        mgr.create(Agent::new("a2".into(), "/tmp".into(), "t2".into())).await;

        let all = mgr.list(None).await;
        assert_eq!(all.len(), 2);
    }

    #[tokio::test]
    async fn test_list_filtered_by_tab() {
        let (mgr, _) = test_manager().await;
        mgr.create(Agent::new("a1".into(), "/tmp".into(), "t1".into())).await;
        mgr.create(Agent::new("a2".into(), "/tmp".into(), "t2".into())).await;

        let filtered = mgr.list(Some(&"t1".into())).await;
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, "a1");
    }

    #[tokio::test]
    async fn test_remove() {
        let (mgr, bus) = test_manager().await;
        let mut rx = bus.subscribe_events();

        mgr.create(Agent::new("a1".into(), "/tmp".into(), "t1".into())).await;
        let _ = rx.try_recv(); // consume Created event

        let removed = mgr.remove(&"a1".into()).await;
        assert!(removed.is_some());
        assert!(mgr.get(&"a1".into()).await.is_none());

        let event = rx.try_recv().unwrap();
        match event {
            AgentEvent::Removed { agent_id } => assert_eq!(agent_id, "a1"),
            _ => panic!("expected Removed event"),
        }
    }

    #[tokio::test]
    async fn test_set_state_valid_transition() {
        let (mgr, _) = test_manager().await;
        mgr.create(Agent::new("a1".into(), "/tmp".into(), "t1".into())).await;

        let agent = mgr.set_state(&"a1".into(), AgentState::Running).await;
        assert!(agent.is_ok());
        assert_eq!(agent.unwrap().state, AgentState::Running);
    }

    #[tokio::test]
    async fn test_set_state_invalid_transition() {
        let (mgr, _) = test_manager().await;
        mgr.create(Agent::new("a1".into(), "/tmp".into(), "t1".into())).await;

        let result = mgr.set_state(&"a1".into(), AgentState::Completed).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_set_state_emits_event() {
        let (mgr, bus) = test_manager().await;
        let mut rx = bus.subscribe_events();
        mgr.create(Agent::new("a1".into(), "/tmp".into(), "t1".into())).await;
        let _ = rx.try_recv(); // consume Created

        mgr.set_state(&"a1".into(), AgentState::Running).await.unwrap();

        let event = rx.try_recv().unwrap();
        match event {
            AgentEvent::StateChanged { old, new, .. } => {
                assert_eq!(old, AgentState::Inactive);
                assert_eq!(new, AgentState::Running);
            }
            _ => panic!("expected StateChanged event"),
        }
    }

    #[tokio::test]
    async fn test_promote_super_claude() {
        let (mgr, _) = test_manager().await;
        mgr.create(Agent::new("a1".into(), "/tmp".into(), "t1".into())).await;

        let agent = mgr.promote_super(&"a1".into(), Scope::Tab).await;
        assert!(agent.is_ok());
        assert!(agent.unwrap().is_super_agent());
    }

    #[tokio::test]
    async fn test_promote_super_codex_fails() {
        let (mgr, _) = test_manager().await;
        let mut agent = Agent::new("a1".into(), "/tmp".into(), "t1".into());
        agent.provider = Provider::Codex;
        mgr.create(agent).await;

        let result = mgr.promote_super(&"a1".into(), Scope::Tab).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not support MCP"));
    }

    #[test]
    fn test_enforce_scope_tab_same_tab() {
        let mut caller = Agent::new("s1".into(), "/tmp".into(), "t1".into());
        caller.role = AgentRole::Super { scope: Scope::Tab };
        let target = Agent::new("a1".into(), "/tmp".into(), "t1".into());

        assert!(AgentManager::enforce_scope(&caller, &target).is_ok());
    }

    #[test]
    fn test_enforce_scope_tab_different_tab() {
        let mut caller = Agent::new("s1".into(), "/tmp".into(), "t1".into());
        caller.role = AgentRole::Super { scope: Scope::Tab };
        let target = Agent::new("a1".into(), "/tmp".into(), "t2".into());

        assert!(AgentManager::enforce_scope(&caller, &target).is_err());
    }

    #[test]
    fn test_enforce_scope_workspace_crosses_tabs() {
        let mut caller = Agent::new("s1".into(), "/tmp".into(), "t1".into());
        caller.role = AgentRole::Super {
            scope: Scope::Workspace,
        };
        let target = Agent::new("a1".into(), "/tmp".into(), "t2".into());

        assert!(AgentManager::enforce_scope(&caller, &target).is_ok());
    }

    #[test]
    fn test_enforce_scope_normal_agent_fails() {
        let caller = Agent::new("a1".into(), "/tmp".into(), "t1".into());
        let target = Agent::new("a2".into(), "/tmp".into(), "t1".into());

        assert!(AgentManager::enforce_scope(&caller, &target).is_err());
    }

    #[tokio::test]
    async fn test_set_status_line() {
        let (mgr, bus) = test_manager().await;
        let mut rx = bus.subscribe_events();
        mgr.create(Agent::new("a1".into(), "/tmp".into(), "t1".into())).await;
        let _ = rx.try_recv(); // consume Created

        mgr.set_status_line(&"a1".into(), "task done".into()).await;

        let agent = mgr.get(&"a1".into()).await.unwrap();
        assert_eq!(agent.status_line, Some("task done".into()));

        let event = rx.try_recv().unwrap();
        match event {
            AgentEvent::StatusLineUpdated { line, .. } => assert_eq!(line, "task done"),
            _ => panic!("expected StatusLineUpdated event"),
        }
    }

    #[tokio::test]
    async fn test_persistence_round_trip() {
        let dir = tempdir().unwrap();
        let bus = Arc::new(EventBus::new());

        // Create and save
        {
            let mgr = AgentManager::new(bus.clone(), dir.path().to_path_buf());
            mgr.create(Agent::new("a1".into(), "/tmp".into(), "t1".into())).await;
        }

        // Load in new manager
        {
            let mgr = AgentManager::new(bus.clone(), dir.path().to_path_buf());
            mgr.load().await;
            let agent = mgr.get(&"a1".into()).await;
            assert!(agent.is_some());
            assert_eq!(agent.unwrap().id, "a1");
        }
    }
}
```

- [ ] **Step 2: Add module to agent/mod.rs**

Update `src-tauri/src/agent/mod.rs`:

```rust
pub mod model;
pub mod event_bus;
pub mod provider;
pub mod manager;
```

- [ ] **Step 3: Run tests**

Run: `cd src-tauri && cargo test agent::manager::tests -- --nocapture 2>&1 | tail -30`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/agent/manager.rs src-tauri/src/agent/mod.rs
git commit -m "feat(agent): add AgentManager with state machine, scope enforcement, persistence"
```

---

## Task 6: PTY Session with Catch-Up Buffer

**Files:**
- Create: `src-tauri/src/agent/pty_session.rs`
- Modify: `src-tauri/src/agent/mod.rs`

- [ ] **Step 1: Write PtySession with tests**

Create `src-tauri/src/agent/pty_session.rs`:

```rust
use bytes::Bytes;
use std::collections::VecDeque;
use std::sync::Mutex;
use tokio::sync::broadcast;

/// Max size of the catch-up ring buffer in bytes.
const CATCHUP_BUFFER_MAX_BYTES: usize = 64 * 1024; // 64KB

/// A PTY session wraps the output broadcast channel and catch-up buffer.
pub struct PtySession {
    /// Broadcast channel for live PTY output.
    output_tx: broadcast::Sender<Bytes>,

    /// Ring buffer of recent output for catch-up when a new viewer connects.
    recent_output: Mutex<CatchUpBuffer>,
}

struct CatchUpBuffer {
    chunks: VecDeque<Bytes>,
    total_bytes: usize,
}

impl CatchUpBuffer {
    fn new() -> Self {
        CatchUpBuffer {
            chunks: VecDeque::new(),
            total_bytes: 0,
        }
    }

    fn push(&mut self, data: Bytes) {
        self.total_bytes += data.len();
        self.chunks.push_back(data);

        // Evict oldest chunks until we're under the limit
        while self.total_bytes > CATCHUP_BUFFER_MAX_BYTES {
            if let Some(old) = self.chunks.pop_front() {
                self.total_bytes -= old.len();
            } else {
                break;
            }
        }
    }

    fn drain(&self) -> Vec<Bytes> {
        self.chunks.iter().cloned().collect()
    }

    fn clear(&mut self) {
        self.chunks.clear();
        self.total_bytes = 0;
    }
}

impl PtySession {
    pub fn new(output_tx: broadcast::Sender<Bytes>) -> Self {
        PtySession {
            output_tx,
            recent_output: Mutex::new(CatchUpBuffer::new()),
        }
    }

    /// Push output data: broadcast to subscribers AND append to catch-up buffer.
    pub fn push_output(&self, data: Bytes) {
        self.recent_output.lock().unwrap().push(data.clone());
        let _ = self.output_tx.send(data);
    }

    /// Get the catch-up buffer contents (for new WebSocket connections).
    pub fn get_catchup(&self) -> Vec<Bytes> {
        self.recent_output.lock().unwrap().drain()
    }

    /// Subscribe to the live output stream.
    pub fn subscribe(&self) -> broadcast::Receiver<Bytes> {
        self.output_tx.subscribe()
    }

    /// Clear the catch-up buffer (e.g., on terminal reset).
    pub fn clear_buffer(&self) {
        self.recent_output.lock().unwrap().clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_session() -> PtySession {
        let (tx, _) = broadcast::channel(256);
        PtySession::new(tx)
    }

    #[test]
    fn test_push_and_catchup() {
        let session = make_session();
        session.push_output(Bytes::from("hello "));
        session.push_output(Bytes::from("world"));

        let catchup = session.get_catchup();
        assert_eq!(catchup.len(), 2);
        assert_eq!(catchup[0], Bytes::from("hello "));
        assert_eq!(catchup[1], Bytes::from("world"));
    }

    #[test]
    fn test_catchup_buffer_eviction() {
        let session = make_session();
        // Push more than 64KB
        let big_chunk = Bytes::from(vec![b'x'; 32 * 1024]); // 32KB each
        session.push_output(big_chunk.clone()); // 32KB
        session.push_output(big_chunk.clone()); // 64KB
        session.push_output(big_chunk.clone()); // 96KB → evicts first chunk

        let catchup = session.get_catchup();
        let total: usize = catchup.iter().map(|c| c.len()).sum();
        assert!(total <= CATCHUP_BUFFER_MAX_BYTES);
        assert_eq!(catchup.len(), 2); // oldest evicted
    }

    #[test]
    fn test_subscriber_receives_pushed_data() {
        let session = make_session();
        let mut rx = session.subscribe();

        session.push_output(Bytes::from("data"));
        let received = rx.try_recv().unwrap();
        assert_eq!(received, Bytes::from("data"));
    }

    #[test]
    fn test_clear_buffer() {
        let session = make_session();
        session.push_output(Bytes::from("data"));
        assert!(!session.get_catchup().is_empty());

        session.clear_buffer();
        assert!(session.get_catchup().is_empty());
    }

    #[test]
    fn test_no_subscribers_does_not_panic() {
        let session = make_session();
        session.push_output(Bytes::from("data")); // no subscribers, should not panic
    }
}
```

- [ ] **Step 2: Add module to agent/mod.rs**

Update `src-tauri/src/agent/mod.rs`:

```rust
pub mod model;
pub mod event_bus;
pub mod provider;
pub mod manager;
pub mod pty_session;
```

- [ ] **Step 3: Run tests**

Run: `cd src-tauri && cargo test agent::pty_session::tests -- --nocapture 2>&1 | tail -20`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/agent/pty_session.rs src-tauri/src/agent/mod.rs
git commit -m "feat(agent): add PtySession with catch-up ring buffer for WebSocket viewers"
```

---

## Task 7: Rewrite Super Agent Instructions

**Files:**
- Modify: `electron/resources/super-agent-instructions.md`

- [ ] **Step 1: Rewrite the instructions file**

Replace the entire content of `electron/resources/super-agent-instructions.md`:

```markdown
# You are a Dorotoring Super Agent

You orchestrate other agents using MCP tools. Your job is to delegate work and synthesize results.

## Available Tools

| Tool | Purpose |
|------|---------|
| `list_agents` | List visible agents (filtered by your scope) |
| `get_agent` | Get agent details and current status |
| `create_agent` | Create a new sub-agent |
| `delegate_task` | **Primary tool** — start agent, wait for completion, return output |
| `start_agent` | Start an agent with a prompt |
| `stop_agent` | Stop a running agent |
| `send_message` | Write to an agent's PTY (for agents in "waiting" state) |
| `wait_for_agent` | Long-poll until an agent finishes |

## Rules

1. **Use `delegate_task` for the standard pattern** — it handles start + wait + output in one call
2. **Never `send_message` to a Running agent** — it may interfere with ongoing work
3. **Sub-agents you create inherit your tab_id** — they stay in your scope
4. **Use `list_agents` first** to see what's available before creating new agents
5. When an agent is "waiting", it needs input — use `send_message` to provide it

## Workflows

### Simple task
1. `list_agents` — find an available agent
2. `delegate_task` — assign work and wait for result
3. Use the result to continue your reasoning

### Complex task (parallel)
1. `list_agents` — find or create multiple agents
2. `start_agent` on each — kick off parallel work
3. `wait_for_agent` on each — collect results
4. Synthesize the outputs

### Agent needs input
1. `wait_for_agent` returns status "waiting"
2. `get_agent` — read its output to understand what it needs
3. `send_message` — provide the requested input
4. `wait_for_agent` again — wait for completion

## Autonomous mode

When delegating to sub-agents, include in their prompts:
- "Work autonomously — make decisions without waiting for confirmation"
- "If unsure, pick the most reasonable option and proceed"

This ensures sub-agents don't block on user input.
```

- [ ] **Step 2: Commit**

```bash
git add electron/resources/super-agent-instructions.md
git commit -m "docs: simplify super agent instructions — core tools only, no scheduling/messaging"
```

---

## Task 8: Rewrite MCP Thin Proxy

**Files:**
- Rewrite: `mcp-orchestrator/src/index.ts`
- Modify: `mcp-orchestrator/src/tools/agents.ts`

- [ ] **Step 1: Rewrite index.ts as thin proxy entry point**

Replace `mcp-orchestrator/src/index.ts` with:

```typescript
#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAgentProxy } from "./tools/agents.js";
import { registerMessagingTools } from "./tools/messaging.js";
import { registerSchedulerTools } from "./tools/scheduler.js";
import { registerAutomationTools } from "./tools/automations.js";

const server = new McpServer({
  name: "dorotoring",
  version: "2.0.0",
});

// Core agent tools — thin proxy to Rust API
registerAgentProxy(server);

// Legacy tools — kept as-is for now (out of scope for rewrite)
registerMessagingTools(server);
registerSchedulerTools(server);
registerAutomationTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Dorotoring MCP proxy connected (stdio)");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

- [ ] **Step 2: Rewrite agents.ts as pure HTTP proxy**

Replace `mcp-orchestrator/src/tools/agents.ts` with:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiRequest } from "../utils/api.js";

/**
 * Register agent tools as thin HTTP proxies to the Rust backend.
 * Zero business logic — every tool is a single HTTP call.
 */
export function registerAgentProxy(server: McpServer): void {
  server.tool(
    "list_agents",
    "List all agents with their current status",
    { tabId: z.string().optional().describe("Filter by tab ID") },
    async ({ tabId }) => {
      const params = tabId ? `?tab_id=${tabId}` : "";
      const data = await apiRequest(`/api/agents${params}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    "get_agent",
    "Get detailed information about an agent",
    { id: z.string().describe("Agent ID") },
    async ({ id }) => {
      const data = await apiRequest(`/api/agents/${id}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    "create_agent",
    "Create a new agent",
    {
      name: z.string().optional().describe("Agent name"),
      cwd: z.string().describe("Working directory"),
      skills: z.array(z.string()).optional().describe("Skills to enable"),
      character: z.string().optional().describe("Visual character"),
      tabId: z.string().optional().describe("Tab to assign to"),
      provider: z.string().optional().describe("CLI provider (claude, gemini, codex)"),
    },
    async (args) => {
      const data = await apiRequest("/api/agents", "POST", args);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    "start_agent",
    "Start an agent with a prompt",
    {
      id: z.string().describe("Agent ID"),
      prompt: z.string().describe("Prompt to send"),
      model: z.string().optional().describe("Model override"),
    },
    async ({ id, ...body }) => {
      const data = await apiRequest(`/api/agents/${id}/start`, "POST", body);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    "stop_agent",
    "Stop a running agent",
    { id: z.string().describe("Agent ID") },
    async ({ id }) => {
      const data = await apiRequest(`/api/agents/${id}/stop`, "POST");
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    "send_message",
    "Send a message to an agent's terminal. Auto-starts idle agents.",
    {
      id: z.string().describe("Agent ID"),
      message: z.string().describe("Message to send"),
    },
    async ({ id, message }) => {
      const data = await apiRequest(`/api/agents/${id}/message`, "POST", { message });
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    "wait_for_agent",
    "Wait for an agent to reach a terminal state (completed, error, waiting)",
    {
      id: z.string().describe("Agent ID"),
      timeout: z.number().optional().default(300).describe("Timeout in seconds"),
    },
    async ({ id, timeout }) => {
      const data = await apiRequest(`/api/agents/${id}/wait?timeout=${timeout}`);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    "delegate_task",
    "Delegate a task to an agent: start, wait for completion, return output. This is the primary tool for task delegation.",
    {
      id: z.string().describe("Agent ID"),
      prompt: z.string().describe("Task to delegate"),
      model: z.string().optional().describe("Model override"),
      timeoutSeconds: z.number().optional().default(300).describe("Timeout in seconds"),
    },
    async ({ id, prompt, model, timeoutSeconds }) => {
      const data = await apiRequest(`/api/agents/${id}/delegate`, "POST", {
        prompt,
        model,
        timeoutSeconds,
      });
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    "remove_agent",
    "Permanently delete an agent",
    { id: z.string().describe("Agent ID") },
    async ({ id }) => {
      const data = await apiRequest(`/api/agents/${id}`, "DELETE");
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
  );
}
```

- [ ] **Step 3: Build the MCP proxy**

Run: `cd mcp-orchestrator && npm run build 2>&1 | tail -5`
Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
git add mcp-orchestrator/src/index.ts mcp-orchestrator/src/tools/agents.ts
git commit -m "refactor(mcp): rewrite agent tools as thin HTTP proxy — zero business logic"
```

---

## Task 9: API Server — REST Endpoints Rewrite

**Files:**
- Rewrite: `src-tauri/src/api_server.rs`

This is the largest task. The API server needs to be rewritten to use the new agent module, add WebSocket endpoints, and implement the delegate endpoint. Due to the size, this task covers the REST endpoints; WebSocket is Task 10.

- [ ] **Step 1: Read the current api_server.rs to understand non-agent routes**

Read `src-tauri/src/api_server.rs` completely to identify any routes or logic outside of agents that must be preserved (health, telegram, slack, etc.).

- [ ] **Step 2: Write the new api_server.rs with REST endpoints**

Rewrite `src-tauri/src/api_server.rs`. The new version uses:
- `AgentManager` instead of raw `AppState.agents` mutex
- `EventBus` for status broadcasting
- Provider trait for CLI command building
- New `/api/agents/{id}/delegate` endpoint

Key structure:

```rust
use axum::{
    extract::{Path, Query, State, WebSocketUpgrade},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

use crate::agent::{
    event_bus::EventBus,
    manager::AgentManager,
    model::{Agent, AgentId, AgentRole, AgentState, Provider, Scope},
    provider::{get_provider, AgentStartConfig},
};
use crate::pty::PtyManager;

pub struct ApiState {
    pub agent_manager: Arc<AgentManager>,
    pub event_bus: Arc<EventBus>,
    pub pty_manager: Arc<PtyManager>,
    pub app_handle: tauri::AppHandle,
    pub api_token: String,
}
```

The full implementation should include:
- All REST routes from the spec
- Auth middleware via `check_auth()`
- `build_cli_command()` using provider trait
- `delegate_handler()` with start → wait → get_output logic
- `hook_status()` and `hook_output()` endpoints

Due to the complexity and length of this file (~500 lines), the implementing agent should:
1. Start from the current `api_server.rs` as reference
2. Replace all direct `app_state.agents.lock()` usage with `agent_manager` calls
3. Replace `status_tx.send()` with `event_bus.emit()`
4. Add the `/delegate` endpoint
5. Keep `build_cli_command()` but delegate to provider trait
6. Keep `ensure_api_token()` as-is
7. Add `X-Agent-Id` header extraction: read from request headers, look up caller agent, pass to `AgentManager::enforce_scope()` on MCP-originated calls (see spec: "Super Agent Scope Enforcement" section)
8. Add dormant/reanimate/promote routes: `POST /api/agents/{id}/dormant`, `POST /api/agents/{id}/reanimate`, `POST /api/agents/{id}/promote`

- [ ] **Step 3: Verify compilation**

Run: `cd src-tauri && cargo check 2>&1 | tail -10`
Expected: compilation succeeds

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/api_server.rs
git commit -m "refactor(api): rewrite REST endpoints using AgentManager + EventBus"
```

---

## Task 10: API Server — WebSocket Endpoints

**Files:**
- Modify: `src-tauri/src/api_server.rs`

- [ ] **Step 1: Add WebSocket handler for /ws/events**

Add to `api_server.rs` the `/ws/events` handler that streams `AgentEvent` as JSON lines:

```rust
use axum::extract::ws::{Message, WebSocket};

async fn ws_events_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<ApiState>>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| ws_events(socket, state))
}

async fn ws_events(mut socket: WebSocket, state: Arc<ApiState>) {
    let mut rx = state.event_bus.subscribe_events();

    loop {
        tokio::select! {
            event = rx.recv() => {
                match event {
                    Ok(evt) => {
                        let json = serde_json::to_string(&evt).unwrap_or_default();
                        if socket.send(Message::Text(json.into())).await.is_err() {
                            break; // client disconnected
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        eprintln!("ws_events: lagged by {n} events");
                        continue;
                    }
                    Err(_) => break,
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {} // ignore client messages
                }
            }
        }
    }
}
```

- [ ] **Step 2: Add WebSocket handler for /ws/pty/{id}**

Add the duplex PTY WebSocket handler:

```rust
use bytes::Bytes;

#[derive(serde::Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum PtyWsMessage {
    Input { data: String },
    Resize { cols: u16, rows: u16 },
}

async fn ws_pty_handler(
    ws: WebSocketUpgrade,
    Path(agent_id): Path<String>,
    State(state): State<Arc<ApiState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| ws_pty(socket, agent_id, state))
}

async fn ws_pty(mut socket: WebSocket, agent_id: String, state: Arc<ApiState>) {
    // Get agent's PTY session for catch-up buffer
    // First, send catch-up data
    if let Some(session) = state.get_pty_session(&agent_id) {
        for chunk in session.get_catchup() {
            if socket.send(Message::Binary(chunk.to_vec().into())).await.is_err() {
                return;
            }
        }
    }

    // Subscribe to live PTY output
    let pty_rx = state.event_bus.subscribe_pty(&agent_id);
    if pty_rx.is_none() {
        let _ = socket.send(Message::Close(None)).await;
        return;
    }
    let mut pty_rx = pty_rx.unwrap();

    loop {
        tokio::select! {
            // Downstream: PTY output → WebSocket
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
            // Upstream: WebSocket → PTY stdin
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(msg) = serde_json::from_str::<PtyWsMessage>(&text) {
                            match msg {
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
                        // Raw binary input → PTY stdin
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
```

- [ ] **Step 3: Register WebSocket routes**

Add to the router in the `start()` function:

```rust
.route("/ws/events", get(ws_events_handler))
.route("/ws/pty/{agent_id}", get(ws_pty_handler))
```

- [ ] **Step 4: Verify compilation**

Run: `cd src-tauri && cargo check 2>&1 | tail -10`
Expected: compilation succeeds

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/api_server.rs
git commit -m "feat(api): add WebSocket endpoints for agent events and duplex PTY streaming"
```

---

## Task 11: Wire New Agent Module into AppState and lib.rs

**Files:**
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Update AppState to include new agent types**

In `src-tauri/src/state.rs`, add the new agent module types to `AppState`:

```rust
use crate::agent::event_bus::EventBus;
use crate::agent::manager::AgentManager;

pub struct AppState {
    // Keep existing fields that are still used (settings, tabs)
    pub settings: Mutex<AppSettings>,
    pub tabs: Arc<Mutex<Vec<Tab>>>,

    // New agent system
    pub agent_manager: Arc<AgentManager>,
    pub event_bus: Arc<EventBus>,

    // Legacy — keep status_tx for backward compat during migration
    pub status_tx: StatusTx,
}
```

Update `AppState::load()` to initialize the new agent module:

```rust
pub fn load() -> Self {
    let dir = Self::data_dir();
    let event_bus = Arc::new(EventBus::new());
    let agent_manager = Arc::new(AgentManager::new(event_bus.clone(), dir.clone()));

    // Load agents via the new manager (in a blocking context since load is sync)
    let rt = tokio::runtime::Handle::current();
    rt.block_on(agent_manager.load());

    let (status_tx, _) = broadcast::channel(128);

    AppState {
        settings: Mutex::new(Self::load_settings(&dir)),
        tabs: Arc::new(Mutex::new(Self::load_tabs(&dir))),
        agent_manager,
        event_bus,
        status_tx,
    }
}
```

- [ ] **Step 2: Update lib.rs boot sequence**

In `src-tauri/src/lib.rs`, update the API server startup to pass the new types:

```rust
// In the setup closure:
let agent_manager = app_state.agent_manager.clone();
let event_bus = app_state.event_bus.clone();

// Start API server with new types
let api_pty = pty_manager_clone.clone();
let api_handle = app.handle().clone();
tauri::async_runtime::spawn(async move {
    crate::api_server::start(agent_manager, event_bus, api_pty, api_handle).await;
});
```

- [ ] **Step 3: Verify compilation**

Run: `cd src-tauri && cargo check 2>&1 | tail -10`
Expected: compilation succeeds (may have warnings about unused old code)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/lib.rs
git commit -m "refactor: wire AgentManager + EventBus into AppState and boot sequence"
```

---

## Task 12: Rewrite Tauri Agent Commands

**Files:**
- Rewrite: `src-tauri/src/commands/agent.rs`

- [ ] **Step 1: Rewrite agent commands using AgentManager**

The commands become thin wrappers around `AgentManager`. Key changes:
- `agent_create` → `agent_manager.create()`
- `agent_start` → `agent_manager.set_state(Running)` + PTY spawn
- `agent_stop` → PTY kill + `agent_manager.set_state(Inactive)`
- `agent_promote_super` → `agent_manager.promote_super()`
- All commands use `tauri::async_runtime::block_on` or become async

The implementing agent should:
1. Read the current `commands/agent.rs` for the full list of commands
2. Rewrite each to use `AgentManager` and `EventBus`
3. Keep the same `#[tauri::command]` signatures for frontend compatibility
4. Use provider trait for `build_cli_command` in `agent_start`
5. Integrate PTY spawn with `EventBus.create_pty_channel()` and `PtySession`

- [ ] **Step 2: Verify compilation**

Run: `cd src-tauri && cargo check 2>&1 | tail -10`
Expected: compilation succeeds

- [ ] **Step 3: Run existing tests**

Run: `cd src-tauri && cargo test 2>&1 | tail -20`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/agent.rs
git commit -m "refactor(commands): rewrite agent commands using AgentManager + EventBus + Provider trait"
```

---

## Task 13: Frontend Types Update

**Files:**
- Modify: `src/types/electron.d.ts`

- [ ] **Step 1: Update Agent type and add new types**

In `src/types/electron.d.ts`, update the `Agent` interface and add `AgentRole`/`Scope`:

```typescript
// Replace the existing ProcessState
type ProcessState = 'inactive' | 'running' | 'waiting' | 'error' | 'completed' | 'dormant';

// New types
type Scope = 'tab' | 'workspace' | 'global';

interface AgentRoleNormal {
  type: 'normal';
}

interface AgentRoleSuper {
  type: 'super';
  scope: Scope;
}

type AgentRole = AgentRoleNormal | AgentRoleSuper;

// Updated Agent interface
interface Agent {
  id: string;
  name?: string;
  provider: AgentProvider;

  // Topology
  tabId: string;
  parentId?: string;  // NEW

  // Runtime
  state: ProcessState;  // renamed from processState
  ptyId?: string;

  // Role
  role: AgentRole;  // NEW — replaces isSuperAgent + superAgentScope

  // Config
  cwd: string;
  secondaryPaths: string[];
  skills: string[];
  character?: AgentCharacter;

  // Output
  statusLine?: string;
  error?: string;

  // Timestamps
  lastActivity: string;
  createdAt: string;

  // Legacy compat (kept temporarily)
  isSuperAgent?: boolean;
  superAgentScope?: 'tab' | 'all';
  processState?: ProcessState;
}
```

- [ ] **Step 2: Add AgentEvent type for WebSocket**

```typescript
// WebSocket event types
interface AgentCreatedEvent {
  type: 'created';
  agent_id: string;
  parent_id?: string;
  tab_id: string;
}

interface AgentStateChangedEvent {
  type: 'state_changed';
  agent_id: string;
  old: ProcessState;
  new: ProcessState;
}

interface AgentRemovedEvent {
  type: 'removed';
  agent_id: string;
}

interface AgentStatusLineUpdatedEvent {
  type: 'status_line_updated';
  agent_id: string;
  line: string;
}

type AgentWsEvent =
  | AgentCreatedEvent
  | AgentStateChangedEvent
  | AgentRemovedEvent
  | AgentStatusLineUpdatedEvent;
```

- [ ] **Step 3: Commit**

```bash
git add src/types/electron.d.ts
git commit -m "types: update Agent type with AgentRole, Scope, parentId, WebSocket events"
```

---

## Task 14: WebSocket Hooks for Frontend

**Files:**
- Create: `src/hooks/useAgentWebSocket.ts`

- [ ] **Step 1: Write the WebSocket hooks**

Create `src/hooks/useAgentWebSocket.ts`:

```typescript
import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentWsEvent } from '../types/electron.d';

const WS_BASE = 'ws://localhost:31415';

/**
 * Subscribe to the global agent event stream via WebSocket.
 * Returns events that the consumer can react to.
 */
export function useAgentEvents(onEvent?: (event: AgentWsEvent) => void) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const ws = new WebSocket(`${WS_BASE}/ws/events`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      // Reconnect after 2s
      setTimeout(() => {
        if (wsRef.current === ws) {
          wsRef.current = null;
          // Trigger re-render to reconnect
        }
      }, 2000);
    };
    ws.onmessage = (msg) => {
      try {
        const event: AgentWsEvent = JSON.parse(msg.data);
        onEventRef.current?.(event);
      } catch {
        // ignore malformed messages
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, []);

  return { connected };
}

/**
 * Duplex WebSocket connection to a specific agent's PTY.
 * Returns:
 * - write(data): send input to the PTY
 * - resize(cols, rows): resize the PTY
 * - onData callback is called with raw output bytes
 */
export function useAgentPtyWebSocket(
  agentId: string | null,
  onData: (data: Uint8Array) => void,
) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  useEffect(() => {
    if (!agentId) return;

    const ws = new WebSocket(`${WS_BASE}/ws/pty/${agentId}`);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (msg) => {
      if (msg.data instanceof ArrayBuffer) {
        onDataRef.current(new Uint8Array(msg.data));
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [agentId]);

  const write = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data }));
    }
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }, []);

  return { connected, write, resize };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useAgentWebSocket.ts
git commit -m "feat(frontend): add WebSocket hooks for agent events and duplex PTY streaming"
```

---

## Task 15: Rewrite Terminal Dialog to Use WebSocket

**Files:**
- Modify: `src/components/AgentTerminalDialog/useAgentDialogTerminal.ts`

- [ ] **Step 1: Rewrite the terminal hook**

Replace the Tauri IPC-based terminal with WebSocket duplex. The hook should:
1. Use `useAgentPtyWebSocket(agentId, onData)` instead of `listen('agent:output')`
2. Feed WebSocket output directly to xterm.js `terminal.write()`
3. Send user input via `ws.write(data)` instead of `invoke('agent_send_input')`
4. Send resize via `ws.resize(cols, rows)` instead of `invoke('pty_resize')`
5. Keep FitAddon, ResizeObserver, and fullscreen handling as-is

Key changes in the hook:

```typescript
import { useAgentPtyWebSocket } from '../../hooks/useAgentWebSocket';

// Inside the hook:
const { connected, write, resize } = useAgentPtyWebSocket(
  agent?.id ?? null,
  (data) => {
    // Write raw bytes to xterm.js
    xtermRef.current?.write(data);
  }
);

// User input handler:
xtermRef.current.onData((data) => {
  write(data);
});

// Resize handler:
const handleResize = () => {
  fitAddonRef.current?.fit();
  const term = xtermRef.current;
  if (term) {
    resize(term.cols, term.rows);
  }
};
```

- [ ] **Step 2: Verify the app builds**

Run: `cd /home/flavien/projects/Dorotoring && npm run build 2>&1 | tail -10`
Expected: build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/components/AgentTerminalDialog/useAgentDialogTerminal.ts
git commit -m "refactor(terminal): switch from Tauri IPC to duplex WebSocket for PTY streaming"
```

---

## Task 16: UI — Parent-Child Hierarchy + Interference Warning

**Files:**
- Modify: `src/components/AgentList/AgentCard.tsx`
- Modify: `src/components/AgentTerminalDialog/index.tsx`

- [ ] **Step 1: Add parent-child indentation to AgentCard**

In `AgentCard.tsx`, add indentation for agents with `parentId`:

```tsx
// Inside the card component, wrap with conditional indentation:
const isSubAgent = agent.parentId != null;

<div style={{ marginLeft: isSubAgent ? 24 : 0 }}>
  {/* existing card content */}
  {isSubAgent && (
    <span className="text-xs text-muted-foreground">
      delegated by {parentName}
    </span>
  )}
</div>
```

The implementing agent should read the current `AgentCard.tsx` and add the indentation + label without breaking existing layout.

- [ ] **Step 2: Add interference warning banner to terminal dialog**

In `AgentTerminalDialog/index.tsx`, add a warning banner when a sub-agent is being managed:

```tsx
{agent?.parentId && agent?.state === 'running' && (
  <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-950 border-t border-amber-600 text-amber-500 text-xs">
    <span>⚠️</span>
    <span>Super Agent is managing this agent — typing here may interfere</span>
  </div>
)}
```

- [ ] **Step 3: Add auto-open for sub-agent terminals**

In the terminal dialog, subscribe to `AgentWsEvent` and auto-open a tab when a sub-agent is created:

```tsx
import { useAgentEvents } from '../../hooks/useAgentWebSocket';

// Inside the dialog component:
useAgentEvents((event) => {
  if (event.type === 'created' && event.parent_id) {
    // Auto-open terminal tab for the new sub-agent
    addTerminalTab(event.agent_id);
  }
});
```

The implementing agent should read the current dialog component to understand the tab management API and wire this in.

- [ ] **Step 4: Verify the app builds**

Run: `cd /home/flavien/projects/Dorotoring && npm run build 2>&1 | tail -10`
Expected: build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/components/AgentList/AgentCard.tsx src/components/AgentTerminalDialog/index.tsx
git commit -m "feat(ui): add parent-child hierarchy, interference warning, auto-open sub-agent terminals"
```

---

## Task 17: Integration Wiring — useElectron Agent Events via WebSocket

**Files:**
- Modify: `src/hooks/useElectron.ts`

- [ ] **Step 1: Wire WebSocket events into useElectronAgents**

In `useElectronAgents()`, replace the Tauri event listeners (`agent:status`, `agents:tick`) with WebSocket events for real-time updates:

```typescript
import { useAgentEvents } from './useAgentWebSocket';

// Inside useElectronAgents:
useAgentEvents((event) => {
  switch (event.type) {
    case 'state_changed':
      setAgents(prev => prev.map(a =>
        a.id === event.agent_id
          ? { ...a, state: event.new, processState: event.new }
          : a
      ));
      break;
    case 'created':
      // Refresh full list to get the new agent
      fetchAgents();
      break;
    case 'removed':
      setAgents(prev => prev.filter(a => a.id !== event.agent_id));
      break;
    case 'status_line_updated':
      setAgents(prev => prev.map(a =>
        a.id === event.agent_id
          ? { ...a, statusLine: event.line }
          : a
      ));
      break;
  }
});
```

Keep the existing Tauri event listeners as fallback (they still fire for non-WebSocket consumers like the tray icon). The WebSocket events provide faster, more reliable updates.

- [ ] **Step 2: Remove polling from useAgents.ts**

In `src/hooks/useAgents.ts`, remove the 10-second polling interval since WebSocket now provides real-time updates. Keep `fetchAgents()` for initial load and manual refresh.

- [ ] **Step 3: Verify the app builds**

Run: `cd /home/flavien/projects/Dorotoring && npm run build 2>&1 | tail -10`
Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useElectron.ts src/hooks/useAgents.ts
git commit -m "refactor(frontend): replace polling with WebSocket events for real-time agent updates"
```

---

## Task 18: End-to-End Smoke Test

**Files:** none (verification only)

- [ ] **Step 1: Run all Rust tests**

Run: `cd src-tauri && cargo test 2>&1 | tail -30`
Expected: all tests pass

- [ ] **Step 2: Build the full app**

Run: `cd /home/flavien/projects/Dorotoring && npm run build 2>&1 | tail -10`
Expected: build succeeds

- [ ] **Step 3: Build the MCP proxy**

Run: `cd mcp-orchestrator && npm run build 2>&1 | tail -5`
Expected: build succeeds

- [ ] **Step 4: Run MCP proxy tests (if any)**

Run: `cd mcp-orchestrator && npm test 2>&1 | tail -10`
Expected: tests pass (or no tests to run)

- [ ] **Step 5: Verify Tauri dev build starts**

Run: `cd /home/flavien/projects/Dorotoring && npx tauri dev 2>&1 | head -20`
Expected: app starts without crash, API server binds on :31415

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve integration issues from agent rewrite"
```
