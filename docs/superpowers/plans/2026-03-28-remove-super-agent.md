# Remove Super Agent — Universal Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Super Agent / Normal Agent distinction so every agent has orchestration capabilities natively.

**Architecture:** Delete `AgentRole` and `Scope` enums, replace scope-based visibility with tab-level filtering, auto-setup MCP orchestrator at app startup, inject lightweight prompt to all agents, clean up all UI references.

**Tech Stack:** Rust (Tauri backend), TypeScript/React (frontend), Node.js (MCP orchestrator)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src-tauri/src/agent/model.rs` | Modify | Remove `AgentRole`, `Scope`, `role` field, related methods and tests |
| `src-tauri/src/agent/manager.rs` | Modify | Remove `promote_super`, `enforce_scope`, role imports; add random character assignment |
| `src-tauri/src/api_server.rs` | Modify | Replace `enforce_caller_scope` with tab visibility; remove role from create/promote; give MCP config to all agents |
| `src-tauri/src/commands/agent.rs` | Modify | Remove `agent_promote_super`, remove role/scope logic from create/update |
| `src-tauri/src/commands/orchestrator.rs` | Modify | Add `ensure_orchestrator_setup()` for auto-boot |
| `src-tauri/src/lib.rs` | Modify | Replace `ensure_super_agent_instructions` with `ensure_agent_instructions`; call auto-setup at startup; remove `agent_promote_super` from handler list |
| `electron/resources/super-agent-instructions.md` | Delete | Replaced by new lightweight prompt |
| `electron/resources/agent-instructions.md` | Create | Lightweight orchestration reminder (~10 lines) |
| `src/types/electron.d.ts` | Modify | Remove `AgentRole`, `Scope`, `role`, legacy compat fields |
| `src/components/ConfigWheel/SuperAgentToggle.tsx` | Delete | No longer needed |
| `src/components/ConfigWheel/index.tsx` | Modify | Remove SuperAgentToggle section, MCP status, promote props |
| `src/components/AgentList/AgentCard.tsx` | Modify | Remove super agent badge, shimmer, crown |
| `src/components/AgentList/AgentManagementCard.tsx` | Modify | Remove super agent badge, scope display |
| `src/components/AgentList/constants.ts` | Modify | Remove `isSuperAgentCheck`, `ORCHESTRATOR_PROMPT` |
| `src/components/AgentTerminalDialog/AgentDialogTypes.ts` | Modify | Remove `isSuperAgent`, `isAgentSuperRole` |
| `src/components/AgentTerminalDialog/AgentDialogSuperAgentSidebar.tsx` | Rename+Modify | Rename to `AgentDialogSidebar.tsx`, remove super agent filtering |
| `src/components/AgentTerminalDialog/AgentDialogHeader.tsx` | Modify | Remove `isSuperAgentMode` prop and conditional rendering |
| `src/components/AgentTerminalDialog/index.tsx` | Modify | Remove `isSuperAgent` import and mode detection |
| `src/components/CanvasView/hooks/useCanvasNodes.ts` | Modify | Remove `isSuperAgent` function and super agent exclusion |
| `src/components/CanvasView/hooks/index.ts` | Modify | Remove `isSuperAgent` export |
| `src/components/CanvasView/hooks/useAgentActions.ts` | Modify | Remove `role` from `CreateAgentConfig` |
| `src/components/MosaicTerminalView/index.tsx` | Modify | Remove `getSuperAgentBadge`, `tabHasSuperAgent`, `onPromoteSuper`, scope styling |
| `src/components/TerminalsView/index.tsx` | Modify | Remove `isSuperAgent`/`superAgentScope` from create callback |
| `src/components/NewChatModal/types.ts` | Modify | Remove `isSuperAgent`, `superAgentScope` from `NewChatModalProps` |
| `src/hooks/useAgentFiltering.ts` | Modify | Remove super agent priority sorting |
| `src/routes/agents.tsx` | Modify | Remove `isSuperAgent`/`superAgentScope` from create callback |
| `src/routes/projects.tsx` | Modify | Remove `isSuperAgent`/`superAgentScope` from create callback |

---

### Task 1: Remove `AgentRole` and `Scope` from Rust model

**Files:**
- Modify: `src-tauri/src/agent/model.rs`

- [ ] **Step 1: Remove `Scope` enum (lines 61-67)**

Delete:
```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    Tab,
    Workspace,
    Global,
}
```

- [ ] **Step 2: Remove `AgentRole` enum and its `Default` impl (lines 69-80)**

Delete:
```rust
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
```

- [ ] **Step 3: Remove `role` field from `Agent` struct (line 125)**

Delete:
```rust
    pub role: AgentRole,
```

- [ ] **Step 4: Remove `role` from `Agent::new()` (line 150)**

Delete:
```rust
            role: AgentRole::default(),
```

- [ ] **Step 5: Remove `is_super_agent()` and `scope()` methods (lines 162-171)**

Delete:
```rust
    pub fn is_super_agent(&self) -> bool {
        matches!(self.role, AgentRole::Super { .. })
    }

    pub fn scope(&self) -> Option<&Scope> {
        match &self.role {
            AgentRole::Super { scope } => Some(scope),
            AgentRole::Normal => None,
        }
    }
```

- [ ] **Step 6: Remove role-related tests (lines 224-238, 267-277)**

Delete `test_agent_role_default_is_normal`, `test_agent_is_super`, and `test_agent_role_serializes_tagged` tests.

- [ ] **Step 7: Verify model compiles**

Run: `cd /home/flavien/projects/Dorotoring/src-tauri && cargo check 2>&1 | head -40`
Expected: Compilation errors in files that still reference `AgentRole`/`Scope`/`role` — this is expected, we'll fix those in subsequent tasks.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/agent/model.rs
git commit -m "refactor(model): remove AgentRole, Scope, and role field from Agent"
```

---

### Task 2: Clean up `AgentManager` — remove role/scope logic, add random character

**Files:**
- Modify: `src-tauri/src/agent/manager.rs`

- [ ] **Step 1: Update imports (line 8)**

Replace:
```rust
use super::model::{Agent, AgentId, AgentRole, AgentState, Provider, Scope, TabId};
```
With:
```rust
use super::model::{Agent, AgentId, AgentState, TabId};
```

- [ ] **Step 2: Remove `promote_super` method (lines 160-184)**

Delete the entire `promote_super` method.

- [ ] **Step 3: Replace `enforce_scope` with `enforce_tab_visibility` (lines 186-203)**

Replace:
```rust
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
```
With:
```rust
    pub fn enforce_tab_visibility(caller: &Agent, target: &Agent) -> Result<(), String> {
        if caller.tab_id != target.tab_id {
            Err(format!(
                "agent '{}' is outside your tab (caller tab: {}, target tab: {})",
                target.id, caller.tab_id, target.tab_id
            ))
        } else {
            Ok(())
        }
    }
```

- [ ] **Step 4: Add `assign_random_character` helper**

Add after `enforce_tab_visibility`:
```rust
    pub fn assign_random_character() -> String {
        const CHARACTERS: &[&str] = &[
            "robot", "ninja", "wizard", "astronaut", "knight", "pirate", "alien", "viking", "frog",
        ];
        use rand::Rng;
        let idx = rand::thread_rng().gen_range(0..CHARACTERS.len());
        CHARACTERS[idx].to_string()
    }
```

Note: Check if `rand` is already a dependency in `Cargo.toml`. If not, add it:
```bash
cd /home/flavien/projects/Dorotoring/src-tauri && cargo add rand
```

- [ ] **Step 5: Verify manager compiles**

Run: `cd /home/flavien/projects/Dorotoring/src-tauri && cargo check 2>&1 | head -40`

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/agent/manager.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "refactor(manager): replace enforce_scope with tab visibility, add random character"
```

---

### Task 3: Update `api_server.rs` — visibility, create, start config

**Files:**
- Modify: `src-tauri/src/api_server.rs`

- [ ] **Step 1: Update imports (lines 24-26)**

Replace:
```rust
use crate::agent::model::{
    Agent, AgentRole, AgentState, Provider, Scope,
};
```
With:
```rust
use crate::agent::model::{Agent, AgentState, Provider};
```

- [ ] **Step 2: Replace `enforce_caller_scope` function (lines 94-108)**

Replace:
```rust
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
```
With:
```rust
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
```

- [ ] **Step 3: Update all call sites of `enforce_caller_scope` to `enforce_caller_tab`**

There are 5 call sites (lines ~298, ~327, ~460, ~503, ~611). Replace `enforce_caller_scope` with `enforce_caller_tab` at each.

- [ ] **Step 4: Remove `is_super_agent` and `super_agent_scope` from `CreateAgentBody` (lines 136-137)**

Delete:
```rust
    is_super_agent: Option<bool>,
    super_agent_scope: Option<String>,
```

- [ ] **Step 5: Remove `PromoteBody` struct (lines 158-162)**

Delete:
```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromoteBody {
    scope: Option<String>,
}
```

- [ ] **Step 6: Remove super agent role handling from `create_agent` handler (lines 257-266)**

Delete:
```rust
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
```

Replace with (assign random character if none provided):
```rust
    let skip_perms = body.skip_permissions.unwrap_or(false);
    if agent.character.is_none() {
        agent.character = Some(AgentManager::assign_random_character());
    }
```

- [ ] **Step 7: Remove super-agent-specific tab_id export from `start_agent` (lines 395-406)**

Delete:
```rust
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
```

Replace with (always export tab_id for all agents):
```rust
    // Export tab ID for tab-scoped visibility
    state
        .pty_manager
        .write(
            &pty_id,
            format!("export DOROTORING_TAB_ID={}\n", agent_snapshot.tab_id).as_bytes(),
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
```

- [ ] **Step 8: Same change in `start_agent_inner` (lines 1015-1026)**

Replace the identical super-agent tab_id export block with the unconditional export (same code as step 7).

- [ ] **Step 9: Update `build_start_config` to always include MCP config (lines 1070-1096)**

Replace:
```rust
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
```
With:
```rust
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
```

- [ ] **Step 10: Remove `promote_handler` function (lines 673-700)**

Delete the entire `promote_handler` function.

- [ ] **Step 11: Remove the `/api/agents/{id}/promote` route (line 1174)**

Delete:
```rust
        .route("/api/agents/{id}/promote", post(promote_handler))
```

- [ ] **Step 12: Verify compiles**

Run: `cd /home/flavien/projects/Dorotoring/src-tauri && cargo check 2>&1 | head -40`

- [ ] **Step 13: Commit**

```bash
git add src-tauri/src/api_server.rs
git commit -m "refactor(api): replace scope enforcement with tab visibility, give all agents MCP config"
```

---

### Task 4: Update `commands/agent.rs` — remove promote, role logic

**Files:**
- Modify: `src-tauri/src/commands/agent.rs`

- [ ] **Step 1: Update imports (line 6)**

Replace:
```rust
use crate::agent::model::{
    Agent, AgentRole, AgentState, Provider, Scope,
};
```
With:
```rust
use crate::agent::model::{Agent, AgentState, Provider};
```

- [ ] **Step 2: Remove super agent role handling from `agent_create` (lines 108-123)**

Delete the `is_super`/`scope`/`AgentRole::Super` block. Add random character assignment:
```rust
    if agent.character.is_none() {
        agent.character = Some(crate::agent::manager::AgentManager::assign_random_character());
    }
```

- [ ] **Step 3: Remove role/scope handling from `agent_update` (lines 569-595)**

Delete the `isSuperAgent`/`superAgentScope` blocks that set `agent.role`.

- [ ] **Step 4: Update `build_start_config` in commands/agent.rs (line 213)**

Replace the super-agent conditional MCP config logic with unconditional:
```rust
    let mcp_config = dirs::home_dir()
        .map(|h| h.join(".claude").join("mcp.json"))
        .filter(|p| p.exists());
    let system_prompt_file = crate::ensure_agent_instructions();
```

- [ ] **Step 5: Remove super agent tab_id export (lines 366-371)**

Replace the conditional `is_super_agent()` tab_id export with unconditional:
```rust
    // Export tab ID for tab-scoped visibility
    pty_manager.write(&pty_id, format!("export DOROTORING_TAB_ID={}\n", agent_snapshot.tab_id).as_bytes())?;
```

- [ ] **Step 6: Remove `agent_promote_super` command (lines ~815-900+)**

Delete the entire `agent_promote_super` function.

- [ ] **Step 7: Remove super agent log reference (line ~340)**

Replace `is_super_agent={}` in the log line with just the agent id.

- [ ] **Step 8: Verify compiles**

Run: `cd /home/flavien/projects/Dorotoring/src-tauri && cargo check 2>&1 | head -40`

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/commands/agent.rs
git commit -m "refactor(commands): remove promote_super command and role logic from agent CRUD"
```

---

### Task 5: Update `lib.rs` — auto-setup orchestrator, rename instructions

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Create: `electron/resources/agent-instructions.md`
- Delete: `electron/resources/super-agent-instructions.md`

- [ ] **Step 1: Create lightweight `agent-instructions.md`**

Create `electron/resources/agent-instructions.md`:
```markdown
# Orchestration

You have access to orchestration tools via MCP (from "claude-mgr-orchestrator"):
- `create_agent` — create a new sub-agent (provide a descriptive `name`)
- `delegate_task` — start an agent, wait for completion, return output (primary tool)
- `list_agents` — list agents in your workspace
- `send_message` — send input to a waiting agent
- `wait_for_agent` — long-poll until an agent finishes

You can create sub-agents to parallelize work. Use `delegate_task` for the standard pattern.
```

- [ ] **Step 2: Replace `ensure_super_agent_instructions` with `ensure_agent_instructions` in `lib.rs`**

Replace:
```rust
/// Writes the embedded super-agent instructions to ~/.dorotoring/ and returns the path.
/// Called before launching any Super Agent to ensure the instructions file is up-to-date.
pub fn ensure_super_agent_instructions() -> Option<std::path::PathBuf> {
    const INSTRUCTIONS: &str =
        include_str!("../../electron/resources/super-agent-instructions.md");
    let path = dirs::home_dir()?
        .join(".dorotoring")
        .join("super-agent-instructions.md");
    std::fs::create_dir_all(path.parent()?).ok()?;
    std::fs::write(&path, INSTRUCTIONS).ok()?;
    Some(path)
}
```
With:
```rust
/// Writes the embedded agent instructions to ~/.dorotoring/ and returns the path.
/// Called before launching any agent to ensure the instructions file is up-to-date.
pub fn ensure_agent_instructions() -> Option<std::path::PathBuf> {
    const INSTRUCTIONS: &str =
        include_str!("../../electron/resources/agent-instructions.md");
    let path = dirs::home_dir()?
        .join(".dorotoring")
        .join("agent-instructions.md");
    std::fs::create_dir_all(path.parent()?).ok()?;
    std::fs::write(&path, INSTRUCTIONS).ok()?;
    Some(path)
}
```

- [ ] **Step 3: Add auto-setup orchestrator at startup**

In the `.setup(move |app| { ... })` block, after `usage_watcher::ensure_hooks();` (line 89), add:
```rust
            // Auto-setup MCP orchestrator for universal orchestration
            if let Err(e) = commands::orchestrator::ensure_orchestrator_setup() {
                eprintln!("[setup] MCP orchestrator auto-setup failed: {e}");
            }
```

- [ ] **Step 4: Remove `agent_promote_super` from invoke_handler list (line 125)**

Delete:
```rust
            commands::agent::agent_promote_super,
```

- [ ] **Step 5: Delete old instructions file**

```bash
rm electron/resources/super-agent-instructions.md
```

- [ ] **Step 6: Add `ensure_orchestrator_setup` to `commands/orchestrator.rs`**

Add a new public function:
```rust
/// Auto-setup the MCP orchestrator at app startup.
/// Ensures mcp.json has the orchestrator entry and the API token exists.
pub fn ensure_orchestrator_setup() -> Result<(), String> {
    let bundle = bundle_path().ok_or("MCP orchestrator bundle not found")?;
    let config_path = mcp_config_path();

    // Only write if not already configured or bundle path changed
    if !get_status_inner(&config_path) {
        setup_inner(&config_path, &bundle)?;
    }

    // Ensure API token exists
    crate::api_server::ensure_api_token();

    Ok(())
}
```

- [ ] **Step 7: Verify compiles**

Run: `cd /home/flavien/projects/Dorotoring/src-tauri && cargo check 2>&1 | head -40`
Expected: PASS — all Rust references should be resolved now.

- [ ] **Step 8: Run Rust tests**

Run: `cd /home/flavien/projects/Dorotoring/src-tauri && cargo test 2>&1 | tail -20`
Expected: All tests pass (role-related tests were deleted in Task 1).

- [ ] **Step 9: Commit**

```bash
git add -A src-tauri/src/lib.rs src-tauri/src/commands/orchestrator.rs electron/resources/
git commit -m "refactor: auto-setup orchestrator at startup, replace super-agent instructions with lightweight prompt"
```

---

### Task 6: Clean up TypeScript types

**Files:**
- Modify: `src/types/electron.d.ts`

- [ ] **Step 1: Remove `Scope` type (line 133)**

Delete:
```typescript
export type Scope = 'tab' | 'workspace' | 'global';
```

- [ ] **Step 2: Remove `AgentRoleNormal`, `AgentRoleSuper`, `AgentRole` (lines 135-144)**

Delete:
```typescript
export interface AgentRoleNormal {
  type: 'normal';
}

export interface AgentRoleSuper {
  type: 'super';
  scope: Scope;
}

export type AgentRole = AgentRoleNormal | AgentRoleSuper;
```

- [ ] **Step 3: Remove `role` from `Agent` interface (lines 159-160)**

Delete:
```typescript
  // Role
  role: AgentRole;  // NEW — replaces isSuperAgent + superAgentScope
```

- [ ] **Step 4: Remove legacy compat fields (lines 176-178)**

Delete:
```typescript
  // Legacy compat (kept temporarily — remove once all consumers are migrated)
  isSuperAgent?: boolean;
  superAgentScope?: 'tab' | 'all';
```

- [ ] **Step 5: Commit**

```bash
git add src/types/electron.d.ts
git commit -m "refactor(types): remove AgentRole, Scope, and legacy super agent fields"
```

---

### Task 7: Clean up frontend utilities and helpers

**Files:**
- Modify: `src/components/AgentList/constants.ts`
- Modify: `src/components/AgentTerminalDialog/AgentDialogTypes.ts`
- Modify: `src/hooks/useAgentFiltering.ts`
- Modify: `src/components/CanvasView/hooks/useCanvasNodes.ts`
- Modify: `src/components/CanvasView/hooks/index.ts`

- [ ] **Step 1: Remove `isSuperAgentCheck` and `ORCHESTRATOR_PROMPT` from constants.ts**

In `src/components/AgentList/constants.ts`:

Delete `ORCHESTRATOR_PROMPT` (lines 55-77) and `isSuperAgentCheck` (lines 79-81).

- [ ] **Step 2: Remove `isSuperAgent` and `isAgentSuperRole` from AgentDialogTypes.ts**

In `src/components/AgentTerminalDialog/AgentDialogTypes.ts`:

Delete lines 27-36:
```typescript
export function isSuperAgent(agent: { name?: string; role?: { type: string } } | null): boolean {
  if (!agent) return false;
  if ((agent as any).role?.type === 'super') return true;
  const name = agent.name?.toLowerCase() || '';
  return name.includes('super agent') || name.includes('orchestrator');
}

export function isAgentSuperRole(agent: { role?: { type: string } }): boolean {
  return agent.role?.type === 'super';
}
```

- [ ] **Step 3: Remove super agent priority sorting from useAgentFiltering.ts**

In `src/hooks/useAgentFiltering.ts`:

Remove import of `isSuperAgentCheck` (line 3):
```typescript
import { getStatusPriority } from '@/components/AgentList/constants';
```

Remove super agent sorting (lines 46-49):
```typescript
      const aIsSuper = isSuperAgentCheck(a);
      const bIsSuper = isSuperAgentCheck(b);
      if (aIsSuper && !bIsSuper) return -1;
      if (!aIsSuper && bIsSuper) return 1;
```

- [ ] **Step 4: Remove `isSuperAgent` from useCanvasNodes.ts**

In `src/components/CanvasView/hooks/useCanvasNodes.ts`:

Delete the `isSuperAgent` function (lines 5-9).

Remove `.filter(agent => !isSuperAgent(agent))` at lines 22 and 45 — show all agents.

Delete `superAgent` memo (lines 132-135) and remove `superAgent` from the return object.

- [ ] **Step 5: Remove `isSuperAgent` export from CanvasView hooks/index.ts**

In `src/components/CanvasView/hooks/index.ts` (line 4):

Replace:
```typescript
export { useCanvasNodes, isSuperAgent } from './useCanvasNodes';
```
With:
```typescript
export { useCanvasNodes } from './useCanvasNodes';
```

- [ ] **Step 6: Commit**

```bash
git add src/components/AgentList/constants.ts src/components/AgentTerminalDialog/AgentDialogTypes.ts src/hooks/useAgentFiltering.ts src/components/CanvasView/hooks/useCanvasNodes.ts src/components/CanvasView/hooks/index.ts
git commit -m "refactor(frontend): remove all super agent helper functions and sorting"
```

---

### Task 8: Clean up AgentCard and AgentManagementCard

**Files:**
- Modify: `src/components/AgentList/AgentCard.tsx`
- Modify: `src/components/AgentList/AgentManagementCard.tsx`

- [ ] **Step 1: Clean AgentCard.tsx**

Remove `isSuperAgentCheck` from import (line 6) — remove it from the destructured imports of constants.

Remove `const isSuper = isSuperAgentCheck(agent);` (line 28).

Replace the entire `className` on the outer card div (lines 38-46) — remove all `isSuper` conditionals:
```tsx
      className={`
        p-4 cursor-pointer transition-all relative
        ${isSubAgent
          ? 'border-b border-border/50 border-l-2 border-l-muted-foreground/30'
          : 'border-b border-border/50'}
        ${isSelected ? 'bg-primary/10' : 'hover:bg-muted/50'}
      `}
```

Delete the gold shimmer overlay (lines 48-51).

Replace the avatar section (lines 53-73) — remove isSuper branch, keep everything else:
```tsx
        <div className={`w-10 h-10 flex items-center justify-center shrink-0 relative overflow-hidden rounded-sm ${
          agent.name?.toLowerCase() === 'bitwonka'
            ? 'bg-success/20'
            : statusConfig.bg
        }`}>
          {(() => {
            const iconUrl = agent.name ? getChampionIconUrl(agent.name) : null;
            if (iconUrl) return <img src={iconUrl} alt="" className="w-10 h-10 object-cover" />;
            if (agent.name?.toLowerCase() === 'bitwonka') return <span className="text-xl">🐸</span>;
            if (agent.character) return <span className="text-xl">{CHARACTER_FACES[agent.character] || '🤖'}</span>;
            if (agent.processState === 'running') return <Loader2 className={`w-5 h-5 ${statusConfig.text} animate-spin`} />;
            return <StatusIcon className={`w-5 h-5 ${statusConfig.text}`} />;
          })()}
          {agent.processState === 'running' && (agent.character || agent.name?.toLowerCase() === 'bitwonka') && (
            <span className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full animate-pulse bg-primary" />
          )}
        </div>
```

Remove Crown import (line 1) and crown icon in h4 (line 77).

Remove `isSuper` conditional from badge styling (lines 117-119) — just use status colors.

Remove unused `Crown` import from lucide-react.

- [ ] **Step 2: Clean AgentManagementCard.tsx**

Remove `isSuperAgentCheck` import (line 10).

Remove `isSuper`, `isGlobalScope`, `crownBadge` variables (lines 37-42).

Remove any crown badge rendering and super agent conditional styling.

- [ ] **Step 3: Verify build**

Run: `cd /home/flavien/projects/Dorotoring && npx tsc --noEmit 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add src/components/AgentList/AgentCard.tsx src/components/AgentList/AgentManagementCard.tsx
git commit -m "refactor(ui): remove super agent badge and styling from agent cards"
```

---

### Task 9: Delete SuperAgentToggle and clean ConfigWheel

**Files:**
- Delete: `src/components/ConfigWheel/SuperAgentToggle.tsx`
- Modify: `src/components/ConfigWheel/index.tsx`

- [ ] **Step 1: Delete SuperAgentToggle.tsx**

```bash
rm src/components/ConfigWheel/SuperAgentToggle.tsx
```

- [ ] **Step 2: Clean ConfigWheel/index.tsx**

Remove `SuperAgentToggle` import (line 17):
```typescript
import { SuperAgentToggle } from './SuperAgentToggle';
```

Remove `Crown`, `CheckCircle`, `XCircle`, `Loader2` from lucide imports (line 2) if no longer used.

Remove props `tabHasSuperAgent` and `onPromoteSuper` from interface and destructuring (lines 28, 32, 39, 41).

Remove `mcpStatus` state and `useEffect` (lines 65-71).

Remove `handleMcpSetup` callback (lines 73-80).

Delete the entire Super Agent section (lines 207-248) — from `{/* ── SUPER AGENT ──` to the closing `</div>`.

Update the `skipPermissions` Switch — remove the `agent.role?.type === 'super'` fallback (line 191):
```tsx
checked={agent.skipPermissions ?? false}
```

- [ ] **Step 3: Commit**

```bash
git add -A src/components/ConfigWheel/
git commit -m "refactor(ui): delete SuperAgentToggle and remove super agent section from ConfigWheel"
```

---

### Task 10: Clean AgentTerminalDialog — sidebar rename, header cleanup

**Files:**
- Rename: `src/components/AgentTerminalDialog/AgentDialogSuperAgentSidebar.tsx` → `AgentDialogSidebar.tsx` (already exists as separate file — check first)
- Modify: `src/components/AgentTerminalDialog/index.tsx`
- Modify: `src/components/AgentTerminalDialog/AgentDialogHeader.tsx`

- [ ] **Step 1: Check if AgentDialogSidebar.tsx already exists**

```bash
ls src/components/AgentTerminalDialog/AgentDialog*Sidebar*
```

If `AgentDialogSidebar.tsx` already exists separately, the `SuperAgentSidebar` may need to be merged or simply deleted. Read both files to decide.

- [ ] **Step 2: Update AgentDialogSuperAgentSidebar.tsx**

Remove the `isSuperAgent` import (line 6) and the `!isSuperAgent(a)` filter (line 29). The sidebar should show all agents:
```typescript
const otherAgents = agents;
```

Remove the Crown import (line 2) and the "Orchestrator Mode" info box at the bottom (lines 167-179).

Rename the file:
```bash
git mv src/components/AgentTerminalDialog/AgentDialogSuperAgentSidebar.tsx src/components/AgentTerminalDialog/AgentDialogSubAgentSidebar.tsx
```

Update the component name inside from `AgentDialogSuperAgentSidebar` to `AgentDialogSubAgentSidebar`.

- [ ] **Step 3: Update index.tsx**

Remove `isSuperAgent` import (line 10):
```typescript
import { isSuperAgent } from './AgentDialogTypes';
```

Remove `isSuperAgentMode` (line 34):
```typescript
const isSuperAgentMode = isSuperAgent(agent);
```

Update the import of the renamed sidebar:
```typescript
import { AgentDialogSubAgentSidebar } from './AgentDialogSubAgentSidebar';
```

Remove `isSuperAgentMode` from the `AgentDialogHeader` props.

Replace any `isSuperAgentMode` usage with `false` or remove the conditional branches entirely.

- [ ] **Step 4: Update AgentDialogHeader.tsx**

Remove `isSuperAgentMode` from props interface and destructuring.

Replace `isSuperAgentMode` crown rendering with the standard champion icon/character.

Remove the "Orchestrator" label conditional.

Remove the conditional that hides action buttons for super agents.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/AgentTerminalDialog/
git commit -m "refactor(ui): rename SuperAgentSidebar, remove super agent mode from terminal dialog"
```

---

### Task 11: Clean MosaicTerminalView

**Files:**
- Modify: `src/components/MosaicTerminalView/index.tsx`

- [ ] **Step 1: Remove `getSuperAgentBadge` function**

Delete the function definition (~line 226).

- [ ] **Step 2: Remove `tabHasSuperAgent` memo**

Delete the `useMemo` that computes `tabHasSuperAgent` (~line 605).

- [ ] **Step 3: Remove all `getSuperAgentBadge(...)` calls**

Replace badge rendering with just the agent name — remove crown emoji badges.

- [ ] **Step 4: Remove `onPromoteSuper` and `tabHasSuperAgent` from ConfigWheel usages**

Remove these props from all `<ConfigWheel ... />` instances.

- [ ] **Step 5: Remove super agent-specific styling**

Remove `agent.role?.type === 'super'` conditional bold/styling, `isWideScopeSuper` checks, and amber border styling.

- [ ] **Step 6: Commit**

```bash
git add src/components/MosaicTerminalView/index.tsx
git commit -m "refactor(ui): remove super agent badges and styling from MosaicTerminalView"
```

---

### Task 12: Clean remaining route files and NewChatModal

**Files:**
- Modify: `src/routes/agents.tsx`
- Modify: `src/routes/projects.tsx`
- Modify: `src/components/TerminalsView/index.tsx`
- Modify: `src/components/NewChatModal/types.ts`
- Modify: `src/components/CanvasView/hooks/useAgentActions.ts`

- [ ] **Step 1: Clean `src/routes/agents.tsx`**

Remove `isSuperAgent` and `superAgentScope` from the `onSubmit` callback signature (lines 95-96).

Remove the role spread in the `createAgent` call (line 99) — remove the `...(isSuperAgent ? { role: ... } : {})` ternary.

- [ ] **Step 2: Clean `src/routes/projects.tsx`**

Same pattern — remove `isSuperAgent`/`superAgentScope` from the callback and remove the role spread.

- [ ] **Step 3: Clean `src/components/TerminalsView/index.tsx`**

Remove `isSuperAgent`/`superAgentScope` from the create callback.

- [ ] **Step 4: Clean `src/components/NewChatModal/types.ts`**

Remove from `NewChatModalProps.onSubmit` (lines 41-42):
```typescript
    isSuperAgent?: boolean,
    superAgentScope?: 'tab' | 'all',
```

- [ ] **Step 5: Clean `src/components/CanvasView/hooks/useAgentActions.ts`**

Remove `role` from `CreateAgentConfig` interface (line 10):
```typescript
  role?: { type: 'super'; scope: string };
```

- [ ] **Step 6: Verify full TypeScript build**

Run: `cd /home/flavien/projects/Dorotoring && npx tsc --noEmit 2>&1 | head -30`
Expected: PASS — no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/routes/agents.tsx src/routes/projects.tsx src/components/TerminalsView/index.tsx src/components/NewChatModal/types.ts src/components/CanvasView/hooks/useAgentActions.ts
git commit -m "refactor(frontend): remove super agent params from all create/submit callbacks"
```

---

### Task 13: Update MCP orchestrator docs

**Files:**
- Modify: `docs/mcp-orchestrator.md`

- [ ] **Step 1: Update the doc to reflect universal orchestration**

Remove all references to "Super Agent" as a special role. Update to reflect:
- All agents have orchestration capabilities
- Visibility is tab-scoped (no more Scope enum)
- MCP orchestrator is auto-configured at app startup
- No promote endpoint

- [ ] **Step 2: Commit**

```bash
git add docs/mcp-orchestrator.md
git commit -m "docs: update MCP orchestrator docs for universal orchestration"
```

---

### Task 14: Final verification

- [ ] **Step 1: Full Rust build + tests**

Run: `cd /home/flavien/projects/Dorotoring/src-tauri && cargo build 2>&1 | tail -5`
Run: `cd /home/flavien/projects/Dorotoring/src-tauri && cargo test 2>&1 | tail -20`
Expected: Both pass.

- [ ] **Step 2: Full TypeScript check**

Run: `cd /home/flavien/projects/Dorotoring && npx tsc --noEmit 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 3: Search for remaining references**

Run: `grep -rn "super.agent\|SuperAgent\|is_super\|isSuperAgent\|AgentRole\|Scope::" --include="*.rs" --include="*.ts" --include="*.tsx" src/ src-tauri/src/ | grep -v node_modules | grep -v ".md"`
Expected: No matches (except possibly CSS class names or comments that are harmless).

- [ ] **Step 4: Verify app starts**

Run: `cd /home/flavien/projects/Dorotoring && cargo tauri dev 2>&1 | head -20`
Expected: App starts without errors, MCP orchestrator auto-configured.

- [ ] **Step 5: Commit any stragglers**

```bash
git add -A && git status
```
If clean, done. Otherwise commit any remaining changes.
