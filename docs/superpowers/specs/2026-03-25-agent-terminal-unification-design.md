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

### Key design decisions

- **`cwd` replaces `projectPath`** — dynamic, updates when the PTY changes directory. No project picker needed.
- **`processState` is automatic** — derived from PTY process status. No manual state management.
- **`businessState` is inferred** — the AI deduces semantic state from its own context. The Super Agent can enrich/correct it.
- **No `currentTask` or `prompt` field** — the context is the terminal history.
- **`ptyId` is nullable** — null means the agent is dormant (terminal closed, agent persisted).

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
- Keeps output buffer for history review
- Can be "reanimated" at any time — creates a new PTY, agent resumes in its team/tab
- Recurring tasks and automations can reanimate a dormant agent to execute, then it returns to dormant

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

- **statusLine**: last output line from the AI, parsed continuously. "Running tests..." → `businessState: "testing"`. "Waiting for PR review" → `businessState: "awaiting review"`.
- **Super Agent**: periodically observes agents' businessStates and enriches/corrects with global coordination context. Example: knows an agent is blocked because it's waiting for another agent's result → sets "blocked by Agent X".

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

### Tab behavior

- Creating a tab creates an empty workspace
- Opening a terminal in a tab assigns the new Agent to that tab
- Agents can be dragged between tabs
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
| Super Agent (tab) | **Bold violet** text on name | 👑👑 |
| Super Agent (all) | **Bold violet** text on name + border | 👑👑 |

- Name rendered in **bold violet** in the tab and in agent cards
- Double crown emoji (👑👑) next to the name
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
- New MCP tools added for `businessState` updates

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

- Existing `AgentStatus` records converted to `Agent`:
  - `projectPath` → `cwd`
  - `status` → `processState` (mapped: `idle` → `inactive`)
  - New fields default: `isSuperAgent: false`, `businessState: null`, `tabId` assigned to a default tab
- Migration runs once on first launch with new version

### UI migration

- Agents page becomes a combined view: active terminals + dormant agents list
- New Agent wizard replaced by config wheel + optional quick-create button
- Tab headers show Super Agent badge when applicable
