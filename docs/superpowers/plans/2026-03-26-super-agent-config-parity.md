# Super Agent Config Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify Super Agent creation, add Git Worktree + MCP status to ConfigWheel, implement real tab-scoped filtering for Super Agents.

**Architecture:** Backend-first — add tabId filter to Axum API, inject DOROTORING_TAB_ID env var into tab-scoped super agent PTYs, implement Git Worktree at agent_start. Then extend ConfigWheel with always-visible sections, remove duplicate Super Agent buttons, and wire OrchestratorModeToggle to actually set isSuperAgent:true on submit.

**Tech Stack:** Rust (Tauri/Axum), TypeScript/React, Node.js (MCP server)

---

## File Map

| File | Change |
|---|---|
| `src-tauri/src/api_server.rs` | Add `?tabId` query param to `list_agents` |
| `src-tauri/src/commands/agent.rs` | Add `branchName` to `agent_update`; inject `DOROTORING_TAB_ID`; Git Worktree at start |
| `src-tauri/src/api_server.rs` `build_cli_command` | Inject `DOROTORING_TAB_ID` for API-started super agents |
| `mcp-orchestrator/src/tools/agents.ts` | Read `DOROTORING_TAB_ID`, pass `?tabId` to list + tabId to create |
| `src/components/ConfigWheel/ConfigWheelWorktree.tsx` | New — Git Worktree section |
| `src/components/ConfigWheel/index.tsx` | Add Git Worktree + MCP status sections with dividers |
| `src/components/AgentList/AgentListHeader.tsx` | Remove Super Agent button + props |
| `src/components/CanvasView/components/CanvasToolbar.tsx` | Remove Super Agent button |
| `src/components/CanvasView/components/SuperAgentButton.tsx` | Delete |
| `src/components/CanvasView/hooks/useAgentActions.ts` | Remove `handleSuperAgentClick` |
| `src/hooks/useSuperAgent.ts` | Delete |
| `src/routes/agents.tsx` | Remove `useSuperAgent` usage |
| `src/components/NewChatModal/OrchestratorModeToggle.tsx` | Add `scope`/`onScopeChange` props, inline scope buttons |
| `src/components/NewChatModal/types.ts` | Add `isSuperAgent` + `superAgentScope` to `onSubmit` |
| `src/components/NewChatModal/index.tsx` | Add `orchestratorScope` state, wire submit |
| `src/components/NewChatModal/StepTask.tsx` | Pass scope props to OrchestratorModeToggle |
| `src/hooks/useElectron.ts` | Add `superAgentScope` to `createAgent` config type |

---

## Task 1: Add branchName to agent_update (Rust)

**Files:**
- Modify: `src-tauri/src/commands/agent.rs:406-426`

- [ ] **Step 1: Add branchName handling in agent_update**

In `agent_update`, after the `obsidianVaultPaths` block (~line 410) and before the `tabId` block, add:

```rust
        if let Some(branch_name) = params.get("branchName") {
            if branch_name.is_null() {
                agent.branch_name = None;
            } else if let Some(b) = branch_name.as_str() {
                agent.branch_name = if b.is_empty() { None } else { Some(b.to_string()) };
            }
        }
```

- [ ] **Step 2: Verify it compiles**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -3
```
Expected: `Finished dev profile`

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/agent.rs
git commit -m "feat(rust): add branchName to agent_update"
```

---

## Task 2: API tabId filter

**Files:**
- Modify: `src-tauri/src/api_server.rs:80-156`

- [ ] **Step 1: Add ListAgentsQuery struct** after the `WaitQuery` struct (~line 87):

```rust
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ListAgentsQuery {
    tab_id: Option<String>,
}
```

- [ ] **Step 2: Update list_agents handler signature and body**

Replace the existing `list_agents` handler (lines 144-156) with:

```rust
async fn list_agents(
    AxumState(state): AxumState<ApiState>,
    headers: HeaderMap,
    Query(query): Query<ListAgentsQuery>,
) -> Result<impl IntoResponse, StatusCode> {
    check_auth(&headers, &state.api_token)?;

    let agents: Vec<Agent> = {
        let agents = state.app_state.agents.lock().unwrap();
        agents
            .values()
            .filter(|a| {
                query.tab_id.as_ref().map_or(true, |tid| &a.tab_id == tid)
            })
            .cloned()
            .collect()
    };

    Ok(Json(serde_json::json!({ "agents": agents })))
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -3
```
Expected: `Finished dev profile`

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/api_server.rs
git commit -m "feat(api): add tabId query param to GET /api/agents"
```

---

## Task 3: Inject DOROTORING_TAB_ID env var (Rust)

**Files:**
- Modify: `src-tauri/src/commands/agent.rs` (agent_start PTY writes, agent_promote_super relaunch thread)
- Modify: `src-tauri/src/api_server.rs` (build_cli_command)

- [ ] **Step 1: Inject env var in agent_start**

In `agent_start`, find the PTY write section (~line 223):
```rust
    pty_manager.write(&pty_id, b"clear\n")?;
    pty_manager.write(&pty_id, format!("{cmd_string}\n").as_bytes())?;
```

Replace with:

```rust
    // For tab-scoped super agents: export the tab ID so the MCP server can filter
    if agent_snapshot.is_super_agent
        && agent_snapshot.super_agent_scope.as_deref() == Some("tab")
    {
        let tab_id = &agent_snapshot.tab_id;
        pty_manager
            .write(&pty_id, format!("export DOROTORING_TAB_ID={tab_id}\n").as_bytes())?;
    }
    pty_manager.write(&pty_id, b"clear\n")?;
    pty_manager.write(&pty_id, format!("{cmd_string}\n").as_bytes())?;
```

- [ ] **Step 2: Inject env var in agent_promote_super relaunch thread**

In the `agent_promote_super` relaunch thread (~line 681), find:
```rust
                let cmd = cmd_parts.join(" ");
                let _ = pty_mgr.write(&pty_id_clone, format!("{cmd}\n").as_bytes());
```

Replace with:

```rust
                let cmd = cmd_parts.join(" ");
                // For tab-scoped super agents: export tab ID before relaunching
                if agent.super_agent_scope.as_deref() == Some("tab") {
                    let tab_id = &agent.tab_id;
                    let _ = pty_mgr.write(
                        &pty_id_clone,
                        format!("export DOROTORING_TAB_ID={tab_id}\n").as_bytes(),
                    );
                }
                let _ = pty_mgr.write(&pty_id_clone, format!("{cmd}\n").as_bytes());
```

- [ ] **Step 3: Inject env var in build_cli_command (api_server.rs)**

In `build_cli_command` in `api_server.rs`, this function returns a `String` — it doesn't write to PTY directly. The injection has to happen at call site. Find where `build_cli_command` is called and the result is written to the PTY. Search for `build_cli_command`:

```bash
grep -n "build_cli_command" src-tauri/src/api_server.rs
```

At the call site, before writing the command string to the PTY, add the env var export if the agent is a tab-scoped super agent. The call site writes the command via `pty_mgr.write`. Add before it:

```rust
if agent.is_super_agent && agent.super_agent_scope.as_deref() == Some("tab") {
    let _ = pty_mgr.write(
        &pty_id,
        format!("export DOROTORING_TAB_ID={}\n", agent.tab_id).as_bytes(),
    );
}
```

- [ ] **Step 4: Verify it compiles**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -3
```
Expected: `Finished dev profile`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/agent.rs src-tauri/src/api_server.rs
git commit -m "feat(rust): inject DOROTORING_TAB_ID for tab-scoped super agents"
```

---

## Task 4: Git Worktree at agent_start (Rust)

**Files:**
- Modify: `src-tauri/src/commands/agent.rs` (agent_start)

- [ ] **Step 1: Add worktree helper function** before `agent_start`:

```rust
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
```

- [ ] **Step 2: Use resolve_agent_cwd in agent_start**

In `agent_start`, find the PTY spawn line (~line 158):
```rust
    pty_manager.spawn(&pty_id, &agent_snapshot.id, &agent_snapshot.cwd, &app_handle, None, None)?;
```

Replace with:

```rust
    let resolved_cwd = resolve_agent_cwd(
        &agent_snapshot.cwd,
        agent_snapshot.branch_name.as_deref(),
        &agent_snapshot.id,
    );
    pty_manager.spawn(&pty_id, &agent_snapshot.id, &resolved_cwd, &app_handle, None, None)?;
```

- [ ] **Step 3: Verify it compiles**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -3
```
Expected: `Finished dev profile`

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/agent.rs
git commit -m "feat(rust): git worktree support at agent_start"
```

---

## Task 5: MCP tab filtering

**Files:**
- Modify: `mcp-orchestrator/src/tools/agents.ts`

- [ ] **Step 1: Update list_agents tool** — find the `apiRequest("/api/agents")` call and replace with:

```typescript
  server.tool(
    "list_agents",
    "List all agents and their current status. Returns agent IDs, names, status (idle/running/waiting/completed/error), projects, and current tasks.",
    {},
    async () => {
      try {
        const tabId = process.env.DOROTORING_TAB_ID;
        const url = tabId ? `/api/agents?tabId=${encodeURIComponent(tabId)}` : '/api/agents';
        const data = (await apiRequest(url)) as { agents: unknown[] };
        return {
          content: [{ type: "text", text: JSON.stringify(data.agents, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error listing agents: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
```

- [ ] **Step 2: Update create_agent tool** — find the `apiRequest("/api/agents", "POST", {...})` call and add `tabId` to the body:

```typescript
        const data = (await apiRequest("/api/agents", "POST", {
          projectPath,
          name,
          skills,
          character,
          skipPermissions,
          secondaryProjectPath,
          // Inherit tab context so new agents land in the same tab as the super agent
          ...(process.env.DOROTORING_TAB_ID ? { tabId: process.env.DOROTORING_TAB_ID } : {}),
        })) as { agent: { id: string; name: string } };
```

- [ ] **Step 3: Rebuild the MCP bundle**

```bash
cd mcp-orchestrator && npm run build 2>&1 | tail -5
```
Expected: `Done in Xms`

- [ ] **Step 4: Commit**

```bash
cd .. && git add mcp-orchestrator/src/tools/agents.ts mcp-orchestrator/dist/bundle.js
git commit -m "feat(mcp): filter agents by tabId for tab-scoped super agents"
```

---

## Task 6: ConfigWheelWorktree component

**Files:**
- Create: `src/components/ConfigWheel/ConfigWheelWorktree.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState, useEffect } from 'react';
import { GitBranch } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface ConfigWheelWorktreeProps {
  branchName?: string;
  onUpdate: (branchName: string) => void;
}

export function ConfigWheelWorktree({ branchName, onUpdate }: ConfigWheelWorktreeProps) {
  const [enabled, setEnabled] = useState(!!branchName);
  const [value, setValue] = useState(branchName || '');

  // Sync when agent prop changes (e.g. external update)
  useEffect(() => {
    setEnabled(!!branchName);
    setValue(branchName || '');
  }, [branchName]);

  const handleToggle = () => {
    const next = !enabled;
    setEnabled(next);
    if (!next) {
      setValue('');
      onUpdate('');
    }
  };

  const handleBlur = () => {
    if (enabled) onUpdate(value.trim());
  };

  return (
    <div className="space-y-1.5">
      <button
        onClick={handleToggle}
        className="flex items-center gap-2 w-full group"
      >
        <div
          className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
            enabled ? 'bg-primary border-primary' : 'border-border group-hover:border-primary/50'
          }`}
        >
          {enabled && (
            <svg viewBox="0 0 10 8" className="w-2 h-2 fill-primary-foreground">
              <path d="M1 4l2.5 2.5L9 1" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
        <GitBranch className="w-3 h-3 text-muted-foreground" />
        <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
          Git Worktree
        </span>
      </button>

      {enabled && (
        <div className="ml-5 space-y-1">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={handleBlur}
            placeholder="feature/branch-name"
            className="h-6 text-xs"
          />
          <p className="text-[10px] text-muted-foreground">Applied on next restart</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep "ConfigWheelWorktree" | head -5
```
Expected: no output (no errors)

- [ ] **Step 3: Commit**

```bash
git add src/components/ConfigWheel/ConfigWheelWorktree.tsx
git commit -m "feat(ui): add ConfigWheelWorktree component"
```

---

## Task 7: ConfigWheel extended layout

**Files:**
- Modify: `src/components/ConfigWheel/index.tsx`

- [ ] **Step 1: Add imports** — add at the top of the import list:

```tsx
import { Zap, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { ConfigWheelWorktree } from './ConfigWheelWorktree';
```

Replace the existing `import { Settings, Crown, Dices } from 'lucide-react';` with:
```tsx
import { Settings, Crown, Dices, Zap, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { ConfigWheelWorktree } from './ConfigWheelWorktree';
```

- [ ] **Step 2: Add MCP status state + effect** inside the `ConfigWheel` component, after the `stopMosaicDrag` callback:

```tsx
  // MCP status for Super Agent section (reuses module-level cache from OrchestratorModeToggle)
  const [mcpStatus, setMcpStatus] = useState<'loading' | 'configured' | 'not-configured' | 'error'>('loading');

  useEffect(() => {
    invoke<{ configured?: boolean; error?: string }>('orchestrator_get_status')
      .then((r) => setMcpStatus(r.configured ? 'configured' : 'not-configured'))
      .catch(() => setMcpStatus('not-configured'));
  }, []);

  const handleMcpSetup = useCallback(async () => {
    try {
      const r = await invoke<{ success?: boolean }>('orchestrator_setup');
      if (r.success) setMcpStatus('configured');
    } catch {
      setMcpStatus('error');
    }
  }, []);
```

- [ ] **Step 3: Replace the `PopoverContent` body** — replace everything inside `<PopoverContent ...>` with the new layout:

```tsx
        {/* ── Identity ─────────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          {(() => {
            const iconUrl = agent.name ? getChampionIconUrl(agent.name) : null;
            if (iconUrl) return <img src={iconUrl} alt="" className="w-5 h-5 rounded-sm object-cover shrink-0" />;
            if (agent.character) return <span className="text-base shrink-0">{CHARACTER_FACES[agent.character] || '🤖'}</span>;
            return null;
          })()}
          <span className="text-xs font-medium text-foreground truncate flex-1">{agent.name || 'Unnamed'}</span>
          {onRerollName && (
            <button
              onClick={() => onRerollName(agent.id)}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Random name"
            >
              <Dices className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="cw-role" className="text-xs">Role</Label>
          <Input
            id="cw-role"
            value={agent.role || ''}
            onChange={(e) => update({ role: e.target.value })}
            onPointerDown={stopMosaicDrag}
            placeholder="e.g. frontend engineer, reviewer..."
            className="h-7 text-xs"
          />
        </div>

        {availableSkills.length > 0 && (
          <div className="space-y-1">
            <Label className="text-xs">Skills</Label>
            <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
              {availableSkills.map((skill) => {
                const active = agent.skills?.includes(skill);
                return (
                  <button
                    key={skill}
                    onClick={() => toggleSkill(skill)}
                    className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ${
                      active
                        ? 'bg-primary/20 border-primary/50 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/30'
                    }`}
                  >
                    {skill}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-1">
          <Label className="text-xs">Provider</Label>
          <Select
            value={agent.provider || 'claude'}
            onValueChange={(value: string) => update({ provider: value as AgentProvider })}
          >
            <SelectTrigger className="h-7 text-xs" onPointerDown={stopMosaicDrag}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent onPointerDown={stopMosaicDrag}>
              {PROVIDERS.map((p) => (
                <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* ── AUTONOMY ─────────────────────────────────────────── */}
        <div className="border-t border-border pt-2">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Autonomy</p>
          <div className="flex items-center justify-between">
            <Label htmlFor="cw-autonomous" className="text-xs cursor-pointer flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-amber-400" />
              Skip Permissions
            </Label>
            <Switch
              id="cw-autonomous"
              checked={agent.skipPermissions}
              onCheckedChange={(checked) => update({ skipPermissions: checked })}
              className="scale-75 origin-right"
            />
          </div>
        </div>

        {/* ── GIT WORKTREE ─────────────────────────────────────── */}
        <div className="border-t border-border pt-2">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Git Worktree</p>
          <ConfigWheelWorktree
            branchName={agent.branchName}
            onUpdate={(branchName) => update({ branchName: branchName || undefined })}
          />
        </div>

        {/* ── SUPER AGENT ──────────────────────────────────────── */}
        <div className="border-t border-border pt-2">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
            <Crown className="w-3 h-3 text-amber-400" />
            Super Agent
          </p>

          {tabHasSuperAgent && !agent.isSuperAgent ? (
            <p className="text-[10px] text-muted-foreground">A Super Agent already exists in this tab</p>
          ) : (
            <div className="space-y-2">
              <SuperAgentToggle
                isSuperAgent={agent.isSuperAgent}
                scope={agent.superAgentScope}
                onChange={(isSuperAgent, scope) => {
                  if (isSuperAgent && onPromoteSuper) {
                    onPromoteSuper(agent.id, scope || 'tab');
                  } else {
                    update({ isSuperAgent, superAgentScope: scope });
                  }
                }}
              />

              {/* MCP status — shown always so user knows the state */}
              <div className="flex items-center gap-1.5 ml-4">
                {mcpStatus === 'loading' && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                {mcpStatus === 'configured' && <CheckCircle className="w-3 h-3 text-green-500" />}
                {(mcpStatus === 'not-configured' || mcpStatus === 'error') && <XCircle className="w-3 h-3 text-destructive" />}
                <span className="text-[10px] text-muted-foreground">
                  {mcpStatus === 'loading' && 'Checking MCP...'}
                  {mcpStatus === 'configured' && 'MCP ready'}
                  {mcpStatus === 'not-configured' && (
                    <button onClick={handleMcpSetup} className="text-primary hover:underline">
                      Setup MCP orchestrator
                    </button>
                  )}
                  {mcpStatus === 'error' && 'MCP setup failed'}
                </span>
              </div>
            </div>
          )}
        </div>
```

- [ ] **Step 4: Add `useState`, `useEffect` to imports** — update the React import line:

```tsx
import { memo, useCallback, useState, useEffect } from 'react';
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E "ConfigWheel|error TS" | grep -v "vault-handlers" | head -10
```
Expected: no errors related to ConfigWheel

- [ ] **Step 6: Commit**

```bash
git add src/components/ConfigWheel/index.tsx src/components/ConfigWheel/ConfigWheelWorktree.tsx
git commit -m "feat(ui): extend ConfigWheel with Git Worktree + MCP status sections"
```

---

## Task 8: Remove Create Super Agent buttons

**Files:**
- Modify: `src/components/AgentList/AgentListHeader.tsx`
- Modify: `src/components/CanvasView/components/CanvasToolbar.tsx`
- Delete: `src/components/CanvasView/components/SuperAgentButton.tsx`
- Modify: `src/components/CanvasView/hooks/useAgentActions.ts`
- Delete: `src/hooks/useSuperAgent.ts`
- Modify: `src/routes/agents.tsx`

- [ ] **Step 1: Simplify AgentListHeader** — replace entire file with:

```tsx
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AgentListHeaderProps {
  onNewAgentClick: () => void;
}

export function AgentListHeader({ onNewAgentClick }: AgentListHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 lg:mb-6">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold tracking-tight text-foreground">AI Agents Control Center</h1>
        <p className="text-muted-foreground text-xs lg:text-sm mt-1 hidden sm:block">
          Dorotoring is watching your AI Agents.
        </p>
      </div>
      <Button onClick={onNewAgentClick} size="sm" className="gap-1.5 font-medium">
        <Plus className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">New Agent</span>
        <span className="sm:hidden">New</span>
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Remove SuperAgentButton from CanvasToolbar**

In `src/components/CanvasView/components/CanvasToolbar.tsx`, remove the `superAgent` and `onSuperAgentClick` props and the `SuperAgentButton` usage. Remove the import of `SuperAgentButton`. The toolbar should only keep zoom controls, filter, and reset.

The new interface:
```tsx
interface CanvasToolbarProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  filter: string;
  onFilterChange: (f: string) => void;
  agentCount: number;
}
```

Remove all references to `superAgent`, `isCreatingSuperAgent`, `onSuperAgentClick`, and `SuperAgentButton` from the component body.

- [ ] **Step 3: Delete SuperAgentButton.tsx**

```bash
git rm src/components/CanvasView/components/SuperAgentButton.tsx
```

- [ ] **Step 4: Remove handleSuperAgentClick from useAgentActions**

In `src/components/CanvasView/hooks/useAgentActions.ts`:
- Remove `superAgent` from the `UseAgentActionsProps` interface
- Remove the `isCreatingSuperAgent` state
- Remove the `orchestratorPrompt` const
- Remove the entire `handleSuperAgentClick` function
- Remove `isCreatingSuperAgent`, `handleSuperAgentClick` from the return object
- Remove the `invoke` import if no longer used (check other usages first)

- [ ] **Step 5: Delete useSuperAgent.ts**

```bash
git rm src/hooks/useSuperAgent.ts
```

- [ ] **Step 6: Clean up routes/agents.tsx**

Remove:
```tsx
import { useSuperAgent } from '@/hooks/useSuperAgent';
```
and the hook call:
```tsx
const { superAgent, isCreatingSuperAgent, handleSuperAgentClick } = useSuperAgent({...});
```

Update `AgentListHeader` usage — remove `superAgent`, `isCreatingSuperAgent`, `onSuperAgentClick` props:
```tsx
<AgentListHeader
  onNewAgentClick={() => setShowNewChatModal(true)}
/>
```

- [ ] **Step 7: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "vault-handlers" | head -10
```
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add src/components/AgentList/AgentListHeader.tsx \
        src/components/CanvasView/components/CanvasToolbar.tsx \
        src/components/CanvasView/hooks/useAgentActions.ts \
        src/routes/agents.tsx
git add -u  # picks up deleted files
git commit -m "feat(ui): remove Create Super Agent buttons — promotion-only via ConfigWheel"
```

---

## Task 9: OrchestratorModeToggle with scope

**Files:**
- Modify: `src/components/NewChatModal/OrchestratorModeToggle.tsx`
- Modify: `src/components/NewChatModal/StepTask.tsx`

- [ ] **Step 1: Update OrchestratorModeToggle props and scope UI**

Replace the `OrchestratorModeToggleProps` interface and add scope props:

```tsx
interface OrchestratorModeToggleProps {
  isOrchestrator: boolean;
  onToggle: (enabled: boolean) => void;
  scope: 'tab' | 'all';
  onScopeChange: (scope: 'tab' | 'all') => void;
}
```

Update the function signature:
```tsx
export default function OrchestratorModeToggle({
  isOrchestrator,
  onToggle,
  scope,
  onScopeChange,
}: OrchestratorModeToggleProps) {
```

Inside the `{status === 'configured' && ...}` block, after the checkbox row, add the scope selector when orchestrator is enabled:

```tsx
          {status === 'configured' && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                <span className="text-xs text-green-500">MCP orchestrator is configured</span>
              </div>

              {isOrchestrator && (
                <div className="mt-2">
                  <p className="text-[10px] text-muted-foreground mb-1.5">Scope</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => onScopeChange('tab')}
                      className={`text-xs px-3 py-1 rounded border transition-colors ${
                        scope === 'tab'
                          ? 'bg-primary/20 border-primary/50 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/30'
                      }`}
                    >
                      👑 Tab only
                    </button>
                    <button
                      onClick={() => onScopeChange('all')}
                      className={`text-xs px-3 py-1 rounded border transition-colors ${
                        scope === 'all'
                          ? 'bg-primary/20 border-primary/50 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/30'
                      }`}
                    >
                      👑👑 Global
                    </button>
                  </div>
                </div>
              )}

              <button
                onClick={handleRemove}
                disabled={isSettingUp}
                className="text-xs text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1 mt-3"
              >
                {isSettingUp ? (
                  <><Loader2 className="w-3 h-3 animate-spin" />Removing...</>
                ) : (
                  <><X className="w-3 h-3" />Remove orchestrator config</>
                )}
              </button>
            </div>
          )}
```

- [ ] **Step 2: Update StepTask to pass scope props**

In `src/components/NewChatModal/StepTask.tsx`, update the `StepTaskProps` interface:

```tsx
interface StepTaskProps {
  prompt: string;
  onPromptChange: (prompt: string) => void;
  selectedSkills: string[];
  useWorktree: boolean;
  onToggleWorktree: () => void;
  branchName: string;
  onBranchNameChange: (name: string) => void;
  skipPermissions: boolean;
  onToggleSkipPermissions: () => void;
  isOrchestrator: boolean;
  onOrchestratorToggle: (enabled: boolean) => void;
  orchestratorScope: 'tab' | 'all';
  onOrchestratorScopeChange: (scope: 'tab' | 'all') => void;
  provider: AgentProvider;
  model: string;
  selectedObsidianVaults: string[];
}
```

Add `orchestratorScope` and `onOrchestratorScopeChange` to the destructured props, and pass them to `OrchestratorModeToggle`:

```tsx
<OrchestratorModeToggle
  isOrchestrator={isOrchestrator}
  onToggle={onOrchestratorToggle}
  scope={orchestratorScope}
  onScopeChange={onOrchestratorScopeChange}
/>
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "vault-handlers" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add src/components/NewChatModal/OrchestratorModeToggle.tsx \
        src/components/NewChatModal/StepTask.tsx
git commit -m "feat(ui): add scope selector to OrchestratorModeToggle"
```

---

## Task 10: NewChatModal submit wiring

**Files:**
- Modify: `src/components/NewChatModal/types.ts`
- Modify: `src/components/NewChatModal/index.tsx`
- Modify: `src/hooks/useElectron.ts`

- [ ] **Step 1: Update NewChatModalProps.onSubmit signature** in `types.ts`:

```tsx
export interface NewChatModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (
    skills: string[],
    prompt: string,
    model?: string,
    worktree?: WorktreeConfig,
    character?: AgentCharacter,
    name?: string,
    skipPermissions?: boolean,
    provider?: AgentProvider,
    localModel?: string,
    obsidianVaultPaths?: string[],
    isSuperAgent?: boolean,
    superAgentScope?: 'tab' | 'all',
  ) => void;
  onUpdate?: (id: string, updates: {
    skills?: string[];
    secondaryPaths?: string[] | null;
    skipPermissions?: boolean;
    name?: string;
    character?: AgentCharacter;
  }) => void;
  editAgent?: EditAgentData | null;
  installedSkills?: string[];
  allInstalledSkills?: ClaudeSkill[];
  onRefreshSkills?: () => void;
  initialStep?: number;
}
```

- [ ] **Step 2: Add orchestratorScope state in index.tsx**

In `NewChatModal/index.tsx`, add state after `isOrchestrator`:

```tsx
  const [orchestratorScope, setOrchestratorScope] = useState<'tab' | 'all'>('tab');
```

Reset it in the `useEffect` when modal opens:

```tsx
      setOrchestratorScope('tab');
```
(add this line in both the edit and create reset blocks)

- [ ] **Step 3: Update handleSubmit to pass isSuperAgent + scope**

Replace the `onSubmit(...)` call in `handleSubmit`:

```tsx
    onSubmit(
      selectedSkills,
      finalPrompt,
      model,
      worktreeConfig,
      agentCharacter,
      finalName,
      skipPermissions,
      provider,
      localModel,
      selectedObsidianVaults.length > 0 ? selectedObsidianVaults : undefined,
      isOrchestrator || undefined,
      isOrchestrator ? orchestratorScope : undefined,
    );
```

- [ ] **Step 4: Pass scope props to StepTask**

In the `step === 3` block, update the `StepTask` usage:

```tsx
            {step === 3 && (
              <StepTask
                prompt={prompt}
                onPromptChange={setPrompt}
                selectedSkills={selectedSkills}
                useWorktree={useWorktree}
                onToggleWorktree={() => setUseWorktree(prev => !prev)}
                branchName={branchName}
                onBranchNameChange={setBranchName}
                skipPermissions={skipPermissions}
                onToggleSkipPermissions={() => setSkipPermissions(prev => !prev)}
                isOrchestrator={isOrchestrator}
                onOrchestratorToggle={handleOrchestratorToggle}
                orchestratorScope={orchestratorScope}
                onOrchestratorScopeChange={setOrchestratorScope}
                provider={provider}
                model={model}
                selectedObsidianVaults={selectedObsidianVaults}
              />
            )}
```

- [ ] **Step 5: Update useElectron.ts createAgent config type**

Add `superAgentScope` to the config type:

```tsx
  const createAgent = useCallback(async (config: {
    cwd?: string;
    skills?: string[];
    worktree?: { enabled: boolean; branchName: string };
    character?: AgentCharacter;
    name?: string;
    secondaryPaths?: string[];
    skipPermissions?: boolean;
    provider?: AgentProvider;
    localModel?: string;
    obsidianVaultPaths?: string[];
    tabId?: string;
    isSuperAgent?: boolean;
    superAgentScope?: 'tab' | 'all';
  }) => {
```

- [ ] **Step 6: Wire onSubmit in the consumers of NewChatModal**

Find all callers of `onSubmit` (search for `onSubmit` in the codebase) and update their handler signatures to accept the two new optional params. Since they're optional (`| undefined`), existing callers compile without changes — but the main handler in `MosaicTerminalView` or wherever the modal is instantiated must pass `isSuperAgent` and `superAgentScope` to `createAgent`.

Search:
```bash
grep -rn "onSubmit.*skills\|handleModalSubmit\|handleNewAgent" src/ --include="*.tsx" --include="*.ts" | head -10
```

In the handler, add `isSuperAgent` and `superAgentScope` to the `createAgent` call config.

- [ ] **Step 7: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "vault-handlers" | head -15
```
Expected: no new errors

- [ ] **Step 8: Commit**

```bash
git add src/components/NewChatModal/types.ts \
        src/components/NewChatModal/index.tsx \
        src/hooks/useElectron.ts
git commit -m "feat(ui): wire OrchestratorMode → isSuperAgent + scope on submit"
```

---

## Self-Review

**Spec coverage check:**
- ✅ §1.1 API tabId filter → Task 2
- ✅ §1.2 DOROTORING_TAB_ID injection (agent_start + promote relaunch) → Task 3
- ✅ §1.3 MCP list_agents + create_agent → Task 5
- ✅ §1.4 Git Worktree at agent_start → Task 4 (+ Task 1 for agent_update)
- ✅ §2 ConfigWheel Git Worktree + MCP status → Tasks 6 + 7
- ✅ §3 Remove Super Agent buttons → Task 8
- ✅ §4 OrchestratorModeToggle scope + submit wiring → Tasks 9 + 10
- ✅ routes/agents.tsx cleanup (noted in spec) → Task 8 Step 6

**Type consistency:**
- `branchName` used in Task 1 (Rust `agent_update`), Task 6 (`ConfigWheelWorktree` prop), Task 7 (`update({ branchName })`) — consistent
- `orchestratorScope` introduced in Task 9 (StepTask), passed in Task 10 (index.tsx) — consistent
- `isSuperAgent`/`superAgentScope` in onSubmit (Task 10 Step 1) match createAgent config (Task 10 Step 5) — consistent
