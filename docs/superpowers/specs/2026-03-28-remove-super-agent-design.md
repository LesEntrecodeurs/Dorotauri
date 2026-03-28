# Remove Super Agent Concept — Universal Orchestration

**Date:** 2026-03-28
**Status:** Approved
**Approach:** Chirurgical removal (Approach A)

## Summary

Remove the Super Agent / Normal Agent distinction. All agents have orchestration capabilities natively. The MCP orchestrator is always enabled, configured automatically at app startup. No more role-based access control — visibility is scoped to the agent's tab.

## Decisions

| Decision | Choice |
|----------|--------|
| Orchestration access | All agents, systematically |
| Visibility scope | Same tab only (no Tab/Workspace/Global) |
| MCP orchestrator setup | Automatic at app startup |
| System prompt | Lightweight reminder (~10 lines), injected to all agents |
| UI distinction | None — no toggle, no badge, no visual difference |
| Sub-agent creation | Name required, champion assigned randomly by backend |

## 1. Data Model Changes

### Rust (`agent/model.rs`)

**Remove:**
- `enum AgentRole { Normal, Super { scope: Scope } }`
- `enum Scope { Tab, Workspace, Global }`
- `role: AgentRole` field from `Agent` struct

**Keep unchanged:**
- `parent_id: Option<AgentId>` — carries the orchestration hierarchy
- All other fields (`state`, `provider`, `tab_id`, `character`, etc.)

### TypeScript (`types/electron.d.ts`)

**Remove:**
- `role: AgentRole` from `Agent` interface
- `type AgentRole = { type: 'normal' } | { type: 'super'; scope: ... }`
- Legacy compat fields: `isSuperAgent`, `superAgentScope`

### Serialization (`agents.json`)

- `role` field no longer written
- On read: if `role` is present, ignore it silently (backward compat)

## 2. Visibility Control

### Current

`enforce_caller_scope()` in `api_server.rs` checks the caller's `Scope` (Tab/Workspace/Global) to filter which agents it can see and control.

### New behavior

Replace with a single rule: **an agent can only see agents in its own `tab_id`**.

```rust
fn enforce_tab_visibility(caller: &Agent, target: &Agent) -> bool {
    caller.tab_id == target.tab_id
}
```

Applied to:
- `GET /api/agents` (via MCP): filter by caller's `tab_id`
- `POST /api/agents/{id}/start`, `/stop`, `/message`, `/wait`: verify target is in same tab
- No additional auth — Bearer token already authenticates MCP orchestrator calls

### Sub-agent creation

- `POST /api/agents`: new agent inherits `tab_id` from caller
- `name` parameter is **required**
- `character` (champion) is **assigned randomly** by the backend (same pool as manual creation)
- No `scope` parameter

## 3. Automatic MCP Orchestrator Setup

### Current

User clicks "Enable orchestrator" in UI → `orchestrator_setup` command → writes `~/.claude/mcp.json` + API token + super-agent instructions.

### New behavior

**At Dorotoring app startup:**

1. Check if `~/.claude/mcp.json` contains `claude-mgr-orchestrator` entry
2. If missing or bundle path is stale → write/update the entry automatically
3. Generate API token if absent (`~/.dorotoring/api-token`)
4. Write lightweight prompt to `~/.dorotoring/agent-instructions.md` (renamed from `super-agent-instructions.md`)

### UI changes

**Remove:**
- "Enable orchestrator" toggle/button in settings
- `orchestrator_setup` as a user-facing Tauri command (the setup logic itself moves to app initialization in `lib.rs`)

**Keep:**
- `orchestrator_get_status` — useful for debug/diagnostics
- `orchestrator_remove` — clean uninstall if needed

## 4. Lightweight Agent Prompt

### Current

`super-agent-instructions.md` is a detailed prompt (~50+ lines) explaining each MCP tool and delegation patterns.

### New prompt (`agent-instructions.md`, ~10 lines)

Content (indicative):
- You have access to orchestration tools via MCP (`create_agent`, `delegate_task`, `list_agents`, etc.)
- You can create sub-agents to parallelize work
- Each sub-agent you create must have a descriptive `name`
- Use `delegate_task` to delegate and wait for results
- You can only see agents in your own workspace

No detailed tutorial — Claude Code already discovers MCP tools and their descriptions via the MCP protocol. The prompt is just a contextual reminder.

### Injection

`--append-system-prompt-file ~/.dorotoring/agent-instructions.md` is passed to **all** agents at launch (in the CLI command construction in `api_server.rs`).

## 5. UI Cleanup

### Components removed

- **`SuperAgentToggle.tsx`** — switch on/off + scope selector → delete entirely
- **Super Agent badge** in `AgentCard.tsx` — gold shimmer background → delete

### Components modified

- **`AgentCard.tsx`** — remove conditional logic on `role.type === 'super'`, remove badge. Status, provider, parent-child indent remain
- **`AgentDialogSuperAgentSidebar.tsx`** — rename to `AgentDialogSidebar.tsx`. Remove all "super agent" references. Content (agent list grouped by status) remains relevant for any agent with sub-agents
- **`ConfigWheel`** — remove `SuperAgentToggle` import and rendering

### No replacement components

Parent-child indentation in the agent list is sufficient to show orchestration relationships.

## 6. Migration & Backward Compatibility

### `agents.json`

- On read: `role` field ignored silently if present
- On write: `role` no longer serialized
- No explicit migration — file updates naturally on next save

### MCP orchestrator (`mcp-orchestrator/src/`)

- Remove `scope` parameter from `create_agent` tool
- Remove scope filtering logic in HTTP calls (Rust backend filters by `tab_id` now)
- All other tools (`delegate_task`, `list_agents`, `send_message`, etc.) remain functional as-is

### API HTTP (`api_server.rs`)

- Remove `enforce_caller_scope()` → replace with `enforce_tab_visibility()`
- Remove `role` field from JSON serialization on all endpoints
- `X-Agent-Id` header remains — still used to identify caller for tab filtering

### Hooks (`hooks.sh`)

- No changes — hooks don't reference the super agent concept

## Files Impacted

| File | Action |
|------|--------|
| `src-tauri/src/agent/model.rs` | Remove `AgentRole`, `Scope`, `role` field |
| `src-tauri/src/agent/manager.rs` | Remove role-related logic, add random champion assignment |
| `src-tauri/src/api_server.rs` | Replace `enforce_caller_scope` with `enforce_tab_visibility`, remove role from serialization |
| `src-tauri/src/lib.rs` | Auto-setup orchestrator at startup, rename instructions file |
| `src-tauri/src/commands/orchestrator.rs` | Remove `orchestrator_setup` from frontend-exposed commands |
| `electron/resources/super-agent-instructions.md` | Replace with lightweight `agent-instructions.md` |
| `mcp-orchestrator/src/tools/agents.ts` | Remove scope parameter from `create_agent` |
| `src/types/electron.d.ts` | Remove `AgentRole`, `role`, legacy compat fields |
| `src/components/ConfigWheel/SuperAgentToggle.tsx` | Delete |
| `src/components/AgentList/AgentCard.tsx` | Remove super agent badge and role checks |
| `src/components/AgentTerminalDialog/AgentDialogSuperAgentSidebar.tsx` | Rename to `AgentDialogSidebar.tsx`, remove super agent references |
| `src/components/ConfigWheel/` (parent) | Remove SuperAgentToggle import |
