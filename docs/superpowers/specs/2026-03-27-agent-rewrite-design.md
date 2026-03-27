# Agent Rewrite — Thin MCP Proxy + Event Bus

**Date:** 2026-03-27
**Scope:** Agents + Super Agent + real-time observability
**Out of scope:** Scheduling, automations, messaging (Telegram/Slack), GitHub/JIRA integrations

## Motivation

1. Current agent code has grown organically and is tangled — needs a clean rewrite
2. No real-time terminal observability — when a Super Agent delegates a task, the sub-agent's PTY output is invisible to the user until completion
3. Business logic split between Rust and Node.js (MCP orchestrator) — hard to maintain

## Architecture

**Approach: Thin MCP Proxy + Centralized Event Bus**

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (React/Tauri)                                      │
│  ┌──────────────────────┐  ┌──────────────────────────────┐ │
│  │  Terminal Views       │  │  Agent Dashboard             │ │
│  │  xterm.js per agent   │  │  status, tabs, scoping       │ │
│  └──────────────────────┘  └──────────────────────────────┘ │
│         ↕ WebSocket (duplex)         ↕ WebSocket (events)    │
└─────────────────────────────────────────────────────────────┘
                                        │
┌─────────────────────────────────────────────────────────────┐
│  Rust Backend (Tauri + Axum on :31415)                       │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Event Bus (Tokio broadcast channels)                   │ │
│  │  - global_tx: AgentEvent stream (lifecycle, status)     │ │
│  │  - pty_channels[agent_id]: raw bytes (high frequency)   │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌──────────────┐ ┌──────────────┐ ┌───────────────────┐   │
│  │ Agent Manager │ │ PTY Manager  │ │ HTTP API + WS     │   │
│  │ state machine │ │ spawn/kill   │ │ REST + WebSocket   │   │
│  │ provider trait│ │ duplex I/O   │ │ auth + scope check │   │
│  │ scope enforce │ │ output→bus   │ │                    │   │
│  └──────────────┘ └──────────────┘ └───────────────────┘   │
└─────────────────────────────────────────────────────────────┘
         ↑ HTTP                          ↓ spawn PTY
┌────────────────────┐  ┌────────────────────────────────────┐
│ MCP Thin Proxy     │  │ Agent PTYs                          │
│ (Node.js, ~50 LOC) │  │ 👑 Super Agent  Sub-A  Sub-B  ...  │
│ MCP protocol only  │  │ claude | gemini | codex | ...       │
│ forwards to HTTP   │  └────────────────────────────────────┘
└────────────────────┘
```

**Key flows:**
- PTY output → event bus → WebSocket → xterm.js (real-time)
- User input → WebSocket → PTY stdin (duplex, full control)
- Super Agent MCP call → thin proxy → HTTP API → Rust logic
- Hooks still report status, but event bus is the primary mechanism

## Agent Model

```rust
struct Agent {
    // Identity
    id: AgentId,
    name: String,
    provider: Provider,          // Claude, Gemini, Codex, ...

    // Topology
    tab_id: TabId,
    parent_id: Option<AgentId>,  // who created me (Super Agent → sub-agents)

    // Runtime
    state: AgentState,
    pty_id: Option<PtyId>,

    // Super Agent
    role: AgentRole,

    // Config
    cwd: PathBuf,
    skills: Vec<String>,

    // Output
    status_line: Option<String>,
}

enum AgentState {
    Inactive,   // created, not started
    Running,    // PTY active, working
    Waiting,    // agent expects user input
    Completed,  // task finished
    Error,      // crash or timeout
    Dormant,    // PTY closed, preserved for reanimation
}

enum AgentRole {
    Normal,
    Super { scope: Scope },
}

enum Scope {
    Tab,        // sees only agents in its tab
    Workspace,  // sees all tabs
    Global,     // full access (requires explicit user confirmation)
}
```

**State transitions:**
```
Inactive → Running → Waiting ⇄ Running → Completed
                  ↘ Error
Any → Dormant (terminal closed)
Dormant → Inactive (reanimate)
```

**Changes from current model:**
- `parent_id` — traces Super Agent → sub-agent hierarchy for UI display
- `AgentRole` replaces `is_super_agent` + `super_agent_scope` + `skip_permissions`
- `Scope` with 3 levels — `Global` requires explicit UI confirmation
- Removed: `scheduled_task_ids`, `automation_ids`, `business_state` (out of scope)

**`parent_id` is optional** — an agent created manually by the user has `parent_id: None`. A Super Agent can still `delegate_task` or `send_message` to it. The parent-child relationship is about creation provenance, not runtime management.

## Event Bus

```rust
struct EventBus {
    // Global channel — all structured events (low frequency)
    global_tx: broadcast::Sender<AgentEvent>,

    // Per-agent PTY channels — raw bytes (high frequency)
    pty_channels: Mutex<HashMap<AgentId, broadcast::Sender<Bytes>>>,
}

enum AgentEvent {
    Created { agent_id: AgentId, parent_id: Option<AgentId>, tab_id: TabId },
    StateChanged { agent_id: AgentId, old: AgentState, new: AgentState },
    Removed { agent_id: AgentId },
    StatusLineUpdated { agent_id: AgentId, line: String },
}
```

**Two levels of channels:**

1. `global_tx` — structured events, low frequency. Dashboard subscribes for status cards, indicators. Single channel for everything.

2. `pty_channels[agent_id]` — raw PTY bytes, high frequency. Frontend subscribes only when a terminal is open. Closing a tab drops the subscription (zero cost when nobody watches).

**PTY reader task** runs continuously per agent. If nobody subscribes, messages are dropped (native `broadcast::Sender` behavior). Near-zero cost.

**Multiple simultaneous viewers** on the same agent are supported natively by broadcast channels.

## WebSocket Endpoints

```
ws://localhost:31415/ws/events          → AgentEvent stream (dashboard)
ws://localhost:31415/ws/pty/{agent_id}  → duplex: output bytes ↓ + input bytes ↑
```

**PTY WebSocket is duplex:**
- Downstream: PTY Manager reads PTY → pushes to `pty_channels[agent_id]` → WebSocket relays to xterm.js
- Upstream: user types in xterm.js → WebSocket receives → writes to PTY stdin

**Message types:**
```
Upstream:   Input(bytes) | Resize(cols, rows)
Downstream: Output(bytes)
```

**Catch-up buffer** — when opening a terminal mid-task:

```rust
struct PtySession {
    stdin: Mutex<OwnedWriteHalf>,
    output_tx: broadcast::Sender<Bytes>,
    recent_output: Mutex<VecDeque<Bytes>>,  // ring buffer, ~64KB
}
```

On WebSocket connect, send `recent_output` contents first, then switch to live stream. No blank screen.

**Concurrent writes (user + Super Agent):**

```rust
struct PtyHandle {
    stdin: Mutex<OwnedWriteHalf>,  // simple mutex, FIFO
}
```

Simple mutex, no priority system. The rare case where user and Super Agent write simultaneously is handled by a UI warning, not backend locking.

## MCP Thin Proxy

The Node.js MCP orchestrator is reduced to a pure HTTP forwarding proxy (~50 LOC). All business logic moves to Rust.

```typescript
const server = new McpServer({ name: "dorotoring", version: "2.0.0" });

function proxyTool(name, schema, method, path) {
  server.tool(name, schema, async (args) => {
    const result = await fetch(`${API_URL}${path(args)}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: method !== "GET" ? JSON.stringify(args) : undefined,
      signal: AbortSignal.timeout(isLongPoll(path(args)) ? 600_000 : 30_000),
    });
    return { content: [{ type: "text", text: JSON.stringify(await result.json()) }] };
  });
}

proxyTool("list_agents",    {...}, "GET",  (a) => `/api/agents?tabId=${a.tabId || ""}`);
proxyTool("get_agent",      {...}, "GET",  (a) => `/api/agents/${a.id}`);
proxyTool("create_agent",   {...}, "POST", ()  => `/api/agents`);
proxyTool("start_agent",    {...}, "POST", (a) => `/api/agents/${a.id}/start`);
proxyTool("stop_agent",     {...}, "POST", (a) => `/api/agents/${a.id}/stop`);
proxyTool("send_message",   {...}, "POST", (a) => `/api/agents/${a.id}/message`);
proxyTool("wait_for_agent", {...}, "GET",  (a) => `/api/agents/${a.id}/wait?timeout=${a.timeout || 300}`);
proxyTool("delegate_task",  {...}, "POST", (a) => `/api/agents/${a.id}/delegate`);

await server.connect(new StdioServerTransport());
```

**Litmus test:** if you replace this file with a stub that returns "ok" for everything, does all logic still run in Rust? **Yes.**

**What stays in Node.js:**
- MCP protocol handshake (stdio transport)
- Tool discovery (names, schemas, descriptions)
- HTTP forwarding

**What moves to Rust:**
- `delegate_task` logic (start → wait → get output) — new `POST /api/agents/{id}/delegate`
- `send_message` adaptive logic (start if idle, write if waiting)
- Timeout and error handling

## Multi-Provider Abstraction

```rust
trait AgentProvider {
    fn name(&self) -> &str;
    fn build_command(&self, config: &AgentStartConfig) -> Vec<String>;
    fn supports_mcp(&self) -> bool;
    fn supports_skip_permissions(&self) -> bool;
    fn supports_system_prompt_file(&self) -> bool;
}

struct AgentStartConfig {
    prompt: String,
    cwd: PathBuf,
    skip_permissions: bool,
    mcp_config: Option<PathBuf>,
    system_prompt_file: Option<PathBuf>,
    model: Option<String>,
}
```

Implementations: `ClaudeProvider`, `GeminiProvider`, `CodexProvider`, etc.

**Super Agent promotion** is rejected if the provider doesn't support MCP + skip_permissions.

**Output normalization** is not needed at the PTY level — raw terminal bytes are provider-agnostic. Provider-specific hooks (`hooks/gemini/session-end.sh` etc.) handle `status_line` extraction.

## Super Agent Scope Enforcement

Scope is enforced **in Rust**, not in the proxy. The proxy forwards blindly.

```rust
fn enforce_scope(caller: &Agent, target: &Agent) -> Result<()> {
    match &caller.role {
        AgentRole::Normal => Err("not a super agent"),
        AgentRole::Super { scope } => match scope {
            Scope::Tab => {
                if caller.tab_id != target.tab_id {
                    Err("agent outside your tab scope")
                } else { Ok(()) }
            }
            Scope::Workspace => Ok(()),
            Scope::Global => Ok(()),
        }
    }
}
```

**Caller identification:** The MCP proxy reads `DOROTORING_AGENT_ID` (env var injected at spawn) and passes it as `X-Agent-Id` HTTP header. The Rust API looks up the caller agent and enforces scope. Frontend calls (Tauri IPC) have no such header — the human user has unrestricted access.

**Workspace vs Global:** Both pass `enforce_scope` identically — the distinction is purely a UI gate. Promoting to `Global` requires an explicit confirmation dialog. `Workspace` does not. The backend treats them the same. This allows adding finer-grained Global restrictions later (e.g., cross-workspace access) without changing the model.

**Global scope promotion** triggers an explicit confirmation dialog in the UI.

## Super Agent Instructions

Simplified `super-agent-instructions.md` — only core agent tools:

```markdown
# You are a Dorotoring Super Agent

## Available tools
- list_agents — list visible agents (filtered by your scope)
- get_agent — agent details
- create_agent — create a sub-agent
- delegate_task — delegate a task (start + wait + output)
- start_agent / stop_agent — direct control
- send_message — write to an agent's PTY
- wait_for_agent — wait for an agent to finish

## Rules
- Use delegate_task for the standard pattern
- Do not send_message to a Running agent (interference risk)
- Sub-agents you create inherit your tab_id
```

No scheduling, automations, or messaging tools.

## HTTP API

```
REST Endpoints (Bearer auth):
  GET    /api/health                     — health check (no auth)

  GET    /api/agents                     — list agents (?tab_id=)
  POST   /api/agents                     — create agent
  GET    /api/agents/{id}                — get agent details
  DELETE /api/agents/{id}                — remove agent

  POST   /api/agents/{id}/start          — start with prompt
  POST   /api/agents/{id}/stop           — kill PTY
  POST   /api/agents/{id}/message        — adaptive: start if Inactive/Completed/Error, write to PTY if Running/Waiting
  GET    /api/agents/{id}/wait           — long-poll (?timeout=300)
  POST   /api/agents/{id}/delegate       — start + wait + get output (NEW)

  POST   /api/agents/{id}/dormant        — set dormant
  POST   /api/agents/{id}/reanimate      — reanimate
  POST   /api/agents/{id}/promote        — promote to super (?scope=tab)

  POST   /api/hooks/status               — hook callback (no auth)
  POST   /api/hooks/output               — hook callback (no auth)

WebSocket Endpoints:
  GET    /ws/events                      — AgentEvent stream (dashboard)
  GET    /ws/pty/{id}                    — duplex PTY I/O (terminal)
```

**Changes from current:**
- `POST /api/agents/{id}/delegate` — new, logic moved from Node.js
- `GET /api/agents/{id}/output` — removed, replaced by `status_line` in GET + live WebSocket stream
- `/ws/events` and `/ws/pty/{id}` — new, core of observability
- `X-Agent-Id` header for scope enforcement on MCP-originated calls

## Frontend Changes

**Existing UI is preserved.** Changes are additive:

1. **Terminal views switch from Tauri IPC to WebSocket** — `ws://localhost:31415/ws/pty/{id}` replaces the current PTY data flow. xterm.js connects directly via duplex WebSocket.

2. **Auto-open sub-agent terminals** — when `AgentEvent::Created { parent_id: Some(_) }` arrives on `/ws/events`, a new terminal tab appears automatically for the sub-agent.

3. **Parent-child hierarchy in sidebar** — sub-agents (those with `parent_id`) are indented under their parent in the agent list. A "delegated by X" label shows provenance.

4. **Interference warning banner** — when a sub-agent's terminal is open and the Super Agent is actively managing it (detected via `delegate_task` in progress), a warning banner appears: "Super Agent is managing this agent — typing here may interfere". The user can still type.

5. **Dashboard subscribes to `/ws/events`** — replaces polling for status updates. Real-time status card updates.
