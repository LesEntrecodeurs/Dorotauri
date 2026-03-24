# Agent-Terminal Unification Design

## Summary

Unify the Agent and Terminal concepts into a single primitive: **Agent**. Every terminal is an Agent with optional enrichable metadata. Agents persist beyond terminal closure (dormant state), support intelligent state inference, and organize into teams via tabs with promotable Super Agents.

## Motivation

The current system separates Agents (created via a multi-step wizard with mandatory project path, provider, and prompt) from Terminals (display layer for agent output). This creates friction:

- Creation is heavyweight — too many required fields upfront
- Agents are permanently bound to a project at creation time
- The mental model requires understanding two concepts (Agent + Terminal) that should be one

The new model: **open a terminal, you have an Agent. Configure it whenever you want.**

## Core Model: `Agent`

The single entity replacing `AgentStatus`:

```typescript
interface Agent {
  id: string;

  // Identity (all optional, enrichable at any time via config wheel)
  name?: string;                 // "Mon reviewer", "Backend dev"
  role?: string;                 // Free-text role description
  character?: AgentCharacter;    // robot, wizard, ninja, astronaut, knight, pirate, alien, viking, frog
  skills: string[];              // Attached skills, add/remove anytime

  // Project context (dynamic)
  cwd: string;                   // Current working directory of the PTY — source of truth
  secondaryPaths: string[];      // Additional paths (--add-dir)

  // Process
  ptyId?: string;                // Active PTY (null when dormant)
  provider?: AgentProvider;      // claude, codex, gemini, opencode, pi, local (null if pure shell)
  localModel?: string;           // Model name if provider = local
  skipPermissions: boolean;      // Autonomous mode (--dangerously-skip-permissions)

  // States
  processState: ProcessState;
  businessState?: string;        // Inferred by AI — free-text semantic state
  businessStateUpdatedBy?: 'inference' | 'super_agent'; // Who last set the businessState
  businessStateUpdatedAt?: string; // ISO timestamp of last businessState update
  statusLine?: string;           // ANSI-stripped last output line for state inference

  // Coordination
  tabId: string;                 // Tab this agent belongs to
  isSuperAgent: boolean;         // Promoted to orchestrator
  superAgentScope?: 'tab' | 'all'; // Scope: this tab only or all tabs

  // Scheduling links
  scheduledTaskIds: string[];    // Linked recurring tasks
  automationIds: string[];       // Linked automations

  // Metadata
  output: string[];              // Terminal output buffer for replay
  lastActivity: string;          // ISO timestamp
  createdAt: string;
}

type ProcessState = 'inactive' | 'running' | 'waiting' | 'error' | 'completed' | 'dormant';
```

### Carried-forward fields (unchanged from current `AgentStatus`)

These fields exist in the current model and are preserved as-is in the new `Agent` model:

- `worktreePath?: string` — Git worktree path if enabled
- `branchName?: string` — Git branch name for worktree
- `error?: string` — Error message string when `processState` is `error`
- `obsidianVaultPaths?: string[]` — Obsidian vault paths mounted via `--add-dir`
- `pathMissing?: boolean` — Warning flag if `cwd` directory was deleted
- `kanbanTaskId?: string` — Links agent to a Kanban board task (used by Kanban integration for task assignment)
- `currentSessionId?: string` — Tracks the current AI session ID

### Key design decisions

- **`cwd` replaces `projectPath`** — dynamic, updates when the PTY changes directory. No project picker needed. See "cwd tracking" section below.
- **`processState` is semi-automatic** — some transitions are automatic (PTY exit → `completed`/`error`), others are command-driven (`agent_start` → `running`). See "processState inference" section below.
- **`businessState` is inferred** — the AI deduces semantic state from its own context. The Super Agent can enrich/correct it.
- **`currentTask` is dropped** — the context is the terminal history. The `AgentTickItem` type used for the periodic tick system is updated to derive its display text from `businessState` + `statusLine` instead of `currentTask`.
- **`progress` is dropped** — the `progress?: number` field and associated `AgentEvent` progress type are removed. Progress is now communicated through `businessState` semantically (e.g., "testing 3/5") rather than a numeric percentage.
- **`ActiveTab` project variant is dropped** — the current `ActiveTab` has a `{ type: 'project'; projectPath: string }` variant for auto-grouping agents by project. Since `projectPath` no longer exists as a static field (replaced by dynamic `cwd`), this variant is removed. Users organize agents into tabs manually. A future enhancement could auto-group by `cwd` if needed.
- **`ptyId` is nullable** — null means the agent is dormant (terminal closed, agent persisted).
- **`secondaryPaths` is an array** — migrated from the current singular `secondaryProjectPath`. The config wheel allows adding/removing multiple paths. Existing single values are migrated into a one-element array. Note: `obsidianVaultPaths` remains a separate field because Obsidian vaults are mounted read-only with specific semantics, whereas `secondaryPaths` are general-purpose `--add-dir` paths.
- **`createdAt` is new** — existing agents use their `lastActivity` value as the migration default.
- **`lastCleanOutput` is replaced by `statusLine`** — both serve the same purpose (ANSI-stripped last output for Super Agent consumption). `lastCleanOutput` is migrated to `statusLine` during data migration. Only `statusLine` exists in the new model.

## cwd Tracking

The `cwd` field replaces the static `projectPath`. It is updated dynamically based on the shell process running in the PTY.

### Mechanism

- **Linux**: Poll `/proc/<pid>/cwd` symlink for the shell process PID (not the foreground process group — we want the shell's cwd, not a subprocess's).
- **macOS**: Use `libproc::proc_pidinfo` or `lsof -p <pid>` to read the shell process's cwd.
- **Polling interval**: Every 2 seconds while the PTY is active. No polling when dormant.
- **PID acquisition**: `portable_pty::Child` provides the child PID. Store it in `PtyManager` alongside the PTY handle.

### Edge cases

- **Directory deleted**: If `cwd` points to a deleted directory, set `pathMissing: true` on the agent. The UI shows a warning. The agent continues to function (the shell handles missing cwd natively).
- **Rapid directory changes**: The 2-second polling means brief intermediate directories may be missed. This is acceptable — we want the "resting" directory, not a full history.
- **Dormant agents**: `cwd` is frozen at the last known value when the terminal was closed. On reanimation, the new PTY is spawned with this `cwd` (if it still exists) or the user's home directory (if not).

## processState Inference

The `processState` is updated through a mix of command-driven and automatic transitions:

| Transition | Trigger |
|---|---|
| `→ inactive` | Terminal opened, no AI process launched yet |
| `→ running` | `agent_start` command called (launches AI CLI in PTY) |
| `→ waiting` | Output-based detection: pattern matching on known prompt patterns (e.g., `? `, `(y/n)`, Claude's permission prompts). Same heuristic as current `waiting` detection. |
| `→ completed` | PTY reader thread detects AI process exit with code 0 (shell stays alive). Detected by monitoring output for shell prompt return after AI CLI execution. |
| `→ error` | AI process exits with non-zero code, or PTY reader detects error patterns in output |
| `→ dormant` | Terminal closed by user (PTY destroyed) |
| `→ inactive` (from completed/error) | User interacts with the shell again after AI process has finished |

### Detection approach

The current system already sets states via commands (`agent_start` → running) and events (`agent:complete` → completed). The new model keeps this approach and adds:
- **Shell prompt detection**: When the AI CLI exits and the shell prompt reappears, transition from `running`/`completed` back to `inactive` if the user starts typing.
- **Waiting detection**: Existing output-based heuristic (pattern matching on prompt lines) is preserved and extended.

## Agent Lifecycle

### Three levels of "stopping"

| Action | AI Process | PTY/Terminal | Agent |
|---|---|---|---|
| Kill process | Stopped | Stays open | Persists |
| Close terminal | Stopped | Destroyed | Persists (dormant, no PTY) |
| Delete agent | Stopped | Destroyed | Deleted |

### Dormant agents

When a terminal is closed, the Agent enters `dormant` state:
- Keeps all metadata (name, role, skills, character, team assignment)
- Keeps output buffer for history review (capped at 10,000 lines — older lines are discarded)
- Can be "reanimated" at any time — creates a new PTY, agent resumes in its team/tab
- Recurring tasks and automations can reanimate a dormant agent to execute, then it returns to dormant

### Reanimation

When a dormant agent is reopened:

1. A new PTY is spawned with `cwd` set to the agent's last known directory (falls back to `$HOME` if the directory no longer exists)
2. The agent's saved output buffer is replayed into the new xterm instance so the user sees the previous session's context
3. The AI CLI is **not** auto-relaunched — the user gets a shell and can decide to launch an AI session or not
4. If reanimated by a recurring task or automation, the scheduled prompt triggers `agent_start` which launches the CLI automatically
5. `processState` transitions from `dormant` → `inactive` (or `running` if auto-launched by a schedule)
6. The agent reappears in its original tab (`tabId` preserved)

### Typical user journey

1. Open a tab → empty terminal appears → Agent created (`processState: inactive`, no name, no role, `cwd` = default directory)
2. User launches `claude` in terminal → `processState: running`, `provider: claude`
3. Optionally, user opens config wheel → sets name, role, skills
4. User works interactively, or gives a mission and leaves
5. AI infers `businessState` as it works
6. User closes terminal → agent becomes `dormant`
7. Later, user finds the agent in dormant agents list, reopens it → new PTY, same agent

### Quick creation (optional shortcut)

A "New Agent" button opens a simplified form (name + role + skills + prompt + provider) to create a pre-configured agent in one step. This is a shortcut, not the primary path.

## Intelligent States

### Two layers

**1. `processState` — automatic, PTY-based**

| State | Condition |
|---|---|
| `inactive` | No AI process running (pure shell or just opened) |
| `running` | AI process is active |
| `waiting` | AI is waiting for user input |
| `error` | Process crashed |
| `completed` | Process finished normally |
| `dormant` | Terminal closed, agent persisted without PTY |

**2. `businessState` — AI-inferred, semantic**

No predefined list. Free-text string inferred from two sources:

- **statusLine → businessState inference**: The backend parses the `statusLine` on each update. A lightweight classifier (keyword/pattern matching, not LLM-based) maps common patterns to business states: "running tests" → "testing", "reviewing" → "in review", "waiting for" → "awaiting input", etc. This runs in the Rust backend on each `statusLine` update — no polling needed, it piggybacks on the existing `agent:output` event stream.
- **Super Agent enrichment**: The Super Agent periodically polls its agents' `businessState` via MCP `get_agent` tool and can override/enrich via a new MCP tool `update_agent_business_state(agentId, state)`. Example: knows an agent is blocked because it's waiting for another agent's result → sets "blocked by Agent X". When both sources disagree, the Super Agent's value takes precedence (it has more context). The statusLine-based inference resumes if the Super Agent hasn't updated the value in the last 60 seconds (tracked via `businessStateUpdatedBy` and `businessStateUpdatedAt` on the Agent model).

### Display

- `processState` = status icon (existing color scheme: green, blue, amber, red)
- `businessState` = small text label below the agent name in the card/tab

### Super Agent decision-making

The Super Agent uses businessStates to make decisions:
- Agent "blocked" or "error" for too long → intervene
- Agent "completed" → launch next step in the chain
- Agent "awaiting review" → assign another agent to review

## Teams via Tabs

No new `Team` abstraction. Tabs are the existing grouping mechanism, enriched with Super Agent coordination.

### Tab persistence

Currently tabs are frontend-only (localStorage via `useTabManager`). With the new model, `tabId` is on the Agent model (backend-persisted in `agents.json`). To keep data co-located and avoid split-brain:

- **Tab metadata** (name, layout, ordering) moves to backend persistence: `~/.dorothy/tabs.json`
- **Agent membership** is derived from `Agent.tabId` — no duplicate `agentIds[]` array on the tab
- **Frontend `useTabManager`** becomes a thin wrapper over Tauri IPC calls instead of localStorage
- **Migration**: existing localStorage tabs are read once, written to `tabs.json`, then localStorage is cleared

### `tabs.json` schema

```typescript
interface TabsFile {
  schemaVersion: number;       // starts at 1
  tabs: Tab[];                 // ordered array — position = display order
}

interface Tab {
  id: string;                  // UUID
  name: string;                // "General", "Backend team", etc.
  layout: MosaicLayout;        // React Mosaic layout tree (same format as current)
}
```

Agent membership is NOT stored on the Tab — it is derived from `Agent.tabId`. The `Tab` object only holds presentation concerns (name, layout, ordering).

### Tab behavior

- Creating a tab creates an empty workspace
- Opening a terminal in a tab assigns the new Agent to that tab
- Agents can be dragged between tabs (updates `Agent.tabId` via backend)
- An agent belongs to one tab at a time
- Dormant agents keep their `tabId` — reanimation restores them in their team

### Two organization patterns

- **Same project, different roles** → Tab "Project X" with a dev agent, a reviewer agent, a tester agent
- **Same role, different projects** → Tab "Coders" with one agent per project

### Super Agent per tab

- Any agent can be promoted to Super Agent via the config wheel
- One Super Agent maximum per tab
- `superAgentScope: 'tab'` — controls only agents in its tab
- `superAgentScope: 'all'` — controls agents across all tabs (inter-tab orchestrator)
- Validation: only one Super Agent with scope `all` at a time

### Super Agent state transitions

- **Promotion**: Agent gains `isSuperAgent: true` + `superAgentScope` via config wheel. MCP orchestrator tools become available to the AI process.
- **Demotion**: User toggles off Super Agent in config wheel. Agent becomes a normal agent. Any running orchestration stops.
- **Tab move**: Dragging a Super Agent to another tab — it keeps `isSuperAgent: true` but the previous tab loses its Super Agent. If the target tab already has a Super Agent, the user is prompted to confirm (the existing one is demoted).
- **Tab deletion**: All agents in the tab become dormant. A tab-scoped Super Agent keeps `isSuperAgent: true` in dormancy — on reanimation in a new tab, it resumes as Super Agent of that tab.
- **Dormancy**: A dormant Super Agent keeps its flag. When reanimated, it resumes its orchestrator role.
- **Scope `tab` and `all` are mutually exclusive** — an agent is either a tab-scoped or global-scoped Super Agent, not both.

## Config Wheel

Accessible via ⚙️ icon or right-click context menu on the terminal tab. All fields editable at any time:

| Field | Behavior |
|---|---|
| **Name** | Free text, editable anytime |
| **Role** | Free text description |
| **Persona** | Character emoji picker (existing 9 options) |
| **Skills** | Multi-select from installed skills, add/remove on the fly |
| **Provider** | Claude, Codex, Gemini, etc. — changeable between sessions |
| **Autonomous mode** | Toggle skip permissions on/off |
| **Super Agent** | Toggle promotion + scope picker (tab / all) |

## Super Agent Visual Distinction

Super Agents must be immediately identifiable:

| Type | Terminal appearance | Tab badge |
|---|---|---|
| Normal agent | Standard | None |
| Super Agent (tab) | **Bold** text on name | 👑 |
| Super Agent (all) | **Bold** text on name + border | 👑👑 |

- Name rendered in **bold** in the tab and in agent cards
- Single crown emoji (👑) for tab-scoped Super Agent, double crown (👑👑) for inter-tab
- Inter-tab Super Agent additionally gets a distinct border or glow to differentiate from tab-scoped ones

## Notifications

### Desktop notifications

Triggered by `processState` changes:
- `completed` → "Agent X finished its task"
- `error` → "Agent X encountered an error"
- `waiting` → "Agent X is waiting for a response"

### External integrations

For when the user is away from Dorothy:

| Channel | Status |
|---|---|
| Telegram | Existing — preserved |
| Slack | Existing — preserved |
| Discord | Deferred — to be added later |

Capabilities: receive state notifications, receive Super Agent team summaries, send commands to Dorothy (start/stop agent, send message).

## Compatibility

### Recurring tasks

- Continue to reference agents by `id` (UUID unchanged)
- `projectPath` in the task config is used to set the agent's `cwd` before execution
- Can reanimate dormant agents to execute scheduled tasks
- No changes to `~/.claude/schedules.json` format or `launchd`/`crontab` execution

### Automations

- Continue to reference agents by `id`
- Same reanimation behavior for dormant agents
- `automationIds` on the Agent model provides reverse lookup
- No changes to `~/.dorothy/automations.json` format or MCP tools

### MCP Orchestrator

- Existing MCP tools (`list_agents`, `create_agent`, `start_agent`, etc.) updated to work with the new Agent model
- Super Agent still uses MCP for agent control
- New MCP tools:
  - `update_agent_business_state(agentId, state)` — Super Agent sets/overrides an agent's businessState
  - `get_team_status(tabId?)` — returns all agents in a tab with their processState and businessState (if no tabId, returns all agents across all tabs)
  - `promote_super_agent(agentId, scope)` — programmatically promote an agent to Super Agent
  - `demote_super_agent(agentId)` — programmatically demote a Super Agent

### Preserved features

- React Mosaic multi-terminal layout with drag-and-drop
- Layout presets (single, 2-col, 2-row, quad, 3+1)
- Character emoji system (9 personas)
- Persistence to `~/.dorothy/agents.json`
- Broadcast input to all terminals (Ctrl+B)
- Multi-provider support (Claude, Codex, Gemini, OpenCode, Pi, local)
- Worktree support per agent
- Obsidian vault integration

## Migration

### Data migration

A version field (`schemaVersion: number`) is added to `agents.json` via a wrapper object. Current (unversioned) data is a bare `HashMap<AgentId, AgentStatus>`. Migration to version 1 wraps it:

```typescript
interface AgentsFile {
  schemaVersion: number;       // starts at 1
  agents: Record<string, Agent>;
}
```

On startup, deserialization tries the new `AgentsFile` wrapper first. If that fails (no `schemaVersion` key), it falls back to the bare `HashMap` and triggers migration.

**Before migration**: a backup of `agents.json` is written to `agents.json.v0.backup`. If migration fails midway, the app loads the backup using the old `AgentStatus` deserializer, presents all agents as dormant with their original metadata intact, and logs the error. The user can retry migration on next restart or report the issue.

| Old field | New field | Mapping |
|---|---|---|
| `projectPath` | `cwd` | Direct copy |
| `secondaryProjectPath` | `secondaryPaths` | Wrapped in single-element array, or `[]` if null |
| `status` (`idle`) | `processState` | `idle` → `dormant` (no PTY survives app restart) |
| `status` (`running`) | `processState` | `running` → `dormant` (no PTY survives app restart) |
| `status` (`completed`) | `processState` | `completed` → `dormant` |
| `status` (`error`) | `processState` | `error` → `dormant` |
| `status` (`waiting`) | `processState` | `waiting` → `dormant` |
| (absent) | `createdAt` | Defaults to `lastActivity` value |
| (absent) | `role` | Defaults to `null` |
| (absent) | `isSuperAgent` | Defaults to `false` |
| (absent) | `superAgentScope` | Defaults to `null` |
| (absent) | `businessState` | Defaults to `null` |
| (absent) | `tabId` | Assigned to a default "General" tab |
| (absent) | `scheduledTaskIds` | Defaults to `[]` |
| (absent) | `automationIds` | Defaults to `[]` |

All carried-forward fields (`worktreePath`, `branchName`, `error`, `obsidianVaultPaths`, `pathMissing`, `kanbanTaskId`, `currentSessionId`, `character`) are copied as-is. `lastCleanOutput` is migrated to `statusLine`. `currentTask` is dropped (replaced by `businessState` + `statusLine`).

### DisplayStatus migration

The current frontend `DisplayStatus` type (`'working' | 'waiting' | 'done' | 'ready' | 'stopped' | 'error'`) is replaced by a new mapping from `processState`:

| `processState` | Display | Icon color |
|---|---|---|
| `inactive` | "Ready" | Emerald |
| `running` | "Working" | Blue |
| `waiting` | "Waiting" | Amber |
| `completed` | "Done" | Blue |
| `error` | "Error" | Red |
| `dormant` | "Sleeping" | Gray |

The `DisplayStatus` type is updated to include `'sleeping'` and remove `'stopped'`. The `AgentTickItem` type is updated to use `businessState` and `statusLine` instead of `currentTask` for its display text.

### Tab migration

Tab migration joins the existing localStorage tabs with agent `tabId` assignment:

1. Read localStorage key `terminals-tab-manager` → get list of `CustomTab` objects (each with `id`, `name`, `agentIds[]`, `layout`)
2. For each `CustomTab`, create a `Tab` entry in `tabs.json` (copying `id`, `name`, `layout` — dropping `agentIds`)
3. For each agent found in a `CustomTab.agentIds`, set that agent's `tabId` to the tab's `id` in `agents.json`
4. Any agents NOT found in any tab's `agentIds` are assigned to a default "General" tab
5. Write `tabs.json`, clear localStorage key
6. If no localStorage data exists, a single default "General" tab is created and all agents are assigned to it

### Output buffer migration

- Existing `output: Vec<String>` is truncated to 10,000 lines if longer
- No other changes to output format

### UI migration

- Agents page becomes a combined view: active terminals + dormant agents list
- New Agent wizard replaced by config wheel + optional quick-create button
- Tab headers show Super Agent badge when applicable
