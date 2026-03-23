# Dorothy Tauri Rewrite — Design Spec

## Overview

Rewrite Dorothy's desktop shell from Electron to Tauri v2, with the primary goal of enabling multi-window console management. The frontend migrates from Next.js to Vite + React. Backend services split between a Rust core (performance-critical path) and a Node.js sidecar (third-party integrations).

**Target platforms:** macOS + Linux (Fedora). Every phase must be testable on both.

## Goals

1. **Multi-window consoles** — detach agent terminals as independent OS windows, move them across monitors, fullscreen individually
2. **Flexible layout** — react-mosaic tiling in the hub replaces preset grid layouts
3. **Notification-driven navigation** — OS and in-app notifications that navigate to the right agent window
4. **Better terminal performance** — PTY in Rust removes one IPC hop from the output path
5. **Lighter runtime** — Tauri's Rust core vs Electron's bundled Chromium + Node.js

## Non-Goals

- Complete Rust rewrite of all services (Telegram, Slack, MCP stay in Node.js)
- New features beyond multi-window and layout (feature parity with current Dorothy)
- Windows support (future consideration, architecture supports it)

---

## Architecture

### High-Level

```
┌─────────────────────────────────────────────────────┐
│                    Tauri v2 App                      │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │   Hub    │  │ Pop-out  │  │ Pop-out  │  ...      │
│  │ Window   │  │ Console  │  │ Console  │          │
│  │(mosaic)  │  │ Agent A  │  │ Agent B  │          │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
│       │              │              │                │
│       └──────────────┼──────────────┘                │
│                      │                               │
│              Tauri Commands + Events                 │
│                      │                               │
│  ┌───────────────────┴───────────────────┐          │
│  │            Rust Core                   │          │
│  │  ┌─────────┐ ┌────────┐ ┌──────────┐ │          │
│  │  │  State  │ │  PTY   │ │ Windows  │ │          │
│  │  │ Manager │ │Manager │ │ Registry │ │          │
│  │  └─────────┘ └────────┘ └──────────┘ │          │
│  │  ┌─────────┐ ┌────────┐ ┌──────────┐ │          │
│  │  │  Notif  │ │ SQLite │ │ Sidecar  │ │          │
│  │  │ Manager │ │ (Vault)│ │ Bridge   │ │          │
│  │  └─────────┘ └────────┘ └──────────┘ │          │
│  └───────────────────┬───────────────────┘          │
│                      │                               │
│              JSON-RPC (stdin/stdout)                  │
│                      │                               │
│  ┌───────────────────┴───────────────────┐          │
│  │         Node.js Sidecar                │          │
│  │  Telegram │ Slack │ MCP │ API Server   │          │
│  │  JIRA │ GWS │ SocialData │ X API      │          │
│  └────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────┘
```

### Principle: Rust Core as Source of Truth

All windows (hub and pop-outs) are equal peers. They communicate exclusively through Tauri commands (requests) and Tauri events (updates). No window holds authoritative state — the Rust core does. This means:

- Closing the hub does not kill pop-out windows
- Any window can be reopened without state loss
- PTY output routes directly from Rust to the target window(s)

---

## Rust Core

### State Manager (`src-tauri/src/state.rs`)

Thread-safe shared state via `Arc<Mutex<AppState>>` exposed through `tauri::State<>`.

```rust
struct AppState {
    agents: HashMap<AgentId, AgentStatus>,
    pty_handles: HashMap<PtyId, PtyHandle>,
    settings: AppSettings,
    window_registry: WindowRegistry,
}
```

Persists to `~/.dorothy/` (agents.json, app-settings.json) — same locations as current Dorothy for migration continuity.

`AgentStatus` carries the same fields as the current TypeScript interface: id, status (idle/running/completed/error/waiting), projectPath, skills, output buffer, character, provider, etc.

**Note on PTY types:** The current Electron app manages four separate PTY maps (agents, skills, quick terminals, plugins). The Rust core unifies these into a single `pty_handles` map with a `PtyType` enum discriminator to simplify the API while preserving the distinct behaviors.

**CLI binary discovery:** `AppSettings` includes `cli_paths` tracking paths to provider binaries (claude, codex, gemini, pi, etc.). Tauri inherits the user's shell `$PATH` when spawning PTY processes, same as the current Electron behavior. The settings allow manual overrides for non-standard installations.

### PTY Manager (`src-tauri/src/pty.rs`)

Uses `portable-pty` crate (works on macOS and Linux).

- Each agent gets a `PtyPair` (master + child process)
- A dedicated reader thread per PTY reads output and dispatches via Tauri events
- Output routing is targeted: each PTY knows which `WebviewWindow`(s) display it, events go only to those windows
- Output is also buffered in `AgentStatus.output` for replay when a window opens after the agent started

**Output path:** `portable-pty read` → `Rust reader thread` → `window.emit_to(target, "agent:output", data)` → `xterm.js term.write(data)`. Two hops.

### Tauri Commands

```
// Agent lifecycle
agent_create(config: AgentConfig) -> AgentId
agent_start(id: AgentId, prompt: String, options: StartOptions) -> ()
agent_stop(id: AgentId) -> ()
agent_remove(id: AgentId) -> ()
agent_get(id: AgentId) -> AgentStatus
agent_list() -> Vec<AgentStatus>
agent_update(id: AgentId, updates: AgentUpdate) -> ()

// PTY interaction
pty_write(pty_id: PtyId, data: String) -> ()
pty_resize(pty_id: PtyId, cols: u16, rows: u16) -> ()

// Window management
window_popout(agent_id: AgentId) -> WindowId
window_dock(window_id: WindowId) -> ()
window_focus(window_id: WindowId) -> ()
window_list() -> Vec<WindowInfo>

// Notifications
notification_navigate(agent_id: AgentId) -> ()

// Settings
app_settings_get() -> AppSettings
app_settings_save(settings: AppSettings) -> ()

// Vault (SQLite)
vault_list(params: ListParams) -> Vec<Document>
vault_create(params: CreateParams) -> Document
vault_search(query: String) -> Vec<Document>

// Sidecar bridge
sidecar_call(method: String, params: Value) -> Value

// Shell & filesystem
shell_open_terminal(params: ShellParams) -> ()
dialog_open_folder() -> Option<String>
projects_list() -> Vec<ProjectInfo>

// Memory (reads ~/.claude/projects/*/memory/)
memory_list_projects() -> Vec<ProjectMemory>
memory_read_file(path: String) -> String
memory_write_file(path: String, content: String) -> ()
```

### Tauri Events

```
agent:output   { agent_id, data: Vec<u8> }    → targeted to displaying windows
agent:status   { agent_id, status }            → broadcast to all windows
agent:complete { agent_id, result }            → broadcast + triggers notification
sidecar:event  { type, payload }               → forwarded from Node.js sidecar
settings:updated { settings }                  → broadcast to all windows
```

---

## Window Management

### Window Registry (`src-tauri/src/windows.rs`)

```rust
struct WindowRegistry {
    windows: HashMap<WindowId, WindowInfo>,
}

struct WindowInfo {
    id: WindowId,
    window_type: WindowType,          // Hub or Console
    displayed_agents: Vec<AgentId>,
    position: Option<(f64, f64)>,
    size: Option<(f64, f64)>,
}

enum WindowType {
    Hub,
    Console { agent_id: AgentId },
}
```

### Hub Window

- Created at app launch
- Loads route `/` — renders sidebar + react-mosaic layout
- Sidebar shows: agent list, project groups, navigation to other pages (kanban, memory, vault, etc.)
- Mosaic area displays agent terminals in a flexible tiling layout
- Double-click or "pop-out" button on a mosaic tile → calls `window_popout(agent_id)`

### Pop-out Console Window

- Created by `window_popout()` → `WebviewWindow::builder(app, label).url("/console/{agent_id}")`
- Loads route `/console/:agentId` — minimal UI: xterm.js terminal + title bar (agent name, status badge, "re-dock" button)
- Registers in WindowRegistry, PTY output re-routes to include this window
- Independently resizable, fullscreen-able, movable to other monitors
- Closing → calls `window_dock()` which re-adds the agent to the hub mosaic
- Hub closing does NOT close pop-outs. Pop-outs can continue displaying agent output.

### Window Lifecycle

1. **Agent created** → appears in hub sidebar + optionally in mosaic
2. **Pop-out** → Rust creates `WebviewWindow`, updates registry, PTY routes output to new window, hub mosaic tile removed or grayed
3. **Re-dock** (button or close pop-out) → hub mosaic re-adds the agent tile, PTY re-routes to hub only
4. **Hub closed** → pop-outs persist, sidebar/mosaic unavailable until hub reopens
5. **Hub reopened** → reads registry, restores mosaic layout, shows pop-out status in sidebar

---

## Layout System

### react-mosaic in the Hub

Replaces the current `react-grid-layout` with preset grids. `react-mosaic-component` provides:

- Drag-and-drop tile reorganization
- Split/unsplit by dragging tiles
- Resize by dragging separators
- Programmatic layout control via React state

### Layout Model

```typescript
// react-mosaic uses a recursive tree type natively:
type MosaicNode<T> =
  | { direction: 'row' | 'column', first: MosaicNode<T>, second: MosaicNode<T>, splitPercentage?: number }
  | T  // leaf = AgentId string

// Persisted in ~/.dorothy/layouts.json
interface SavedLayouts {
  current: MosaicNode<string>
  saved: Record<string, MosaicNode<string>>  // named layouts
}
```

The current "custom tabs" feature (user-created agent groups) maps to **saved layouts** — each saved tab becomes a named layout the user can switch between.

### Layout Hook (`src/hooks/useLayout.ts`)

- Manages the mosaic tree state
- Persists to disk on change (debounced)
- Restores on app launch
- Handles pop-out (remove leaf from tree, rebalance) and re-dock (insert leaf)

---

## Notifications & Navigation

### Trigger Conditions

| Event | Notification Type |
|-------|-------------------|
| Agent completed (success) | OS + in-app |
| Agent completed (error) | OS + in-app |
| Agent waiting for input | OS + in-app |
| Telegram/Slack mention | OS + in-app (via sidecar event) |

### OS Notifications (app not focused)

- Tauri v2 `tauri-plugin-notification` (macOS Notification Center, libnotify on Linux)
- Each notification carries `agent_id` in payload
- Click handler → `notification_navigate(agent_id)`:
  1. Find which window displays this agent (registry lookup)
  2. If pop-out exists → `window.set_focus()`
  3. If in hub mosaic → focus hub, scroll/highlight the mosaic tile
  4. If not displayed anywhere → focus hub, add to mosaic

### In-App Notifications (app focused)

- Status badge on agent entry in hub sidebar (green=done, red=error, orange=waiting)
- Toast notification at bottom of the active window (agent name + status + "Go" action)
- Peonping sound if enabled (existing frontend system, unchanged)
- Click badge or toast → same `notification_navigate()` logic

### Focus Detection

Rust tracks window focus state via Tauri window events (`Focused`/`Unfocused`). If no Dorothy window has focus → OS notification. If any Dorothy window has focus → in-app notification.

---

## Node.js Sidecar

### Architecture

A standalone Node.js process bundled as a Tauri sidecar. Contains the services that don't need Rust performance:

- **Telegram bot** (node-telegram-bot-api)
- **Slack bot** (@slack/bolt)
- **MCP orchestrator** (spawns MCP server subprocesses)
- **API HTTP server** (port 1280, for external hooks and triggers)
- **Integration services** (JIRA, GWS, SocialData, X API)

### Communication: JSON-RPC over stdin/stdout

```
// Rust → Sidecar (request)
{ "jsonrpc": "2.0", "method": "telegram.sendMessage", "params": { "chatId": "...", "text": "..." }, "id": 1 }

// Sidecar → Rust (response)
{ "jsonrpc": "2.0", "result": { "messageId": "..." }, "id": 1 }

// Sidecar → Rust (notification, no id)
{ "jsonrpc": "2.0", "method": "agent.triggerStart", "params": { "agentId": "...", "prompt": "..." } }
```

### Sidecar Lifecycle

1. Rust starts sidecar at app launch via `tauri::api::process::Command::new_sidecar("dorothy-node")`
2. Sidecar initializes services based on `~/.dorothy/app-settings.json`
3. Bidirectional communication throughout app lifetime
4. Sidecar terminated on app quit

### Sidecar Source

The sidecar is built from a subset of the current `electron/` code:
- `electron/services/` → extracted into sidecar's service modules
- `electron/providers/` → extracted for provider integrations
- MCP packages (`mcp-*/`) bundled alongside
- No Electron dependencies — pure Node.js

---

## Frontend Migration: Next.js → Vite + React

### What Changes

| Current (Next.js) | Target (Vite + React) |
|---|---|
| `next.config.ts` | `vite.config.ts` + `@vitejs/plugin-react` |
| App Router (`src/app/*/page.tsx`) | React Router v7 (`src/routes/*.tsx`) |
| `useRouter()` / `Link` from next | `useNavigate()` / `Link` from react-router |
| API routes (`src/app/api/*`) | Removed — replaced by Tauri commands |
| `window.electronAPI.*` | `invoke()` from `@tauri-apps/api` |
| `ipcRenderer.on()` listeners | `listen()` from `@tauri-apps/api/event` |
| Static export (`output: 'export'`) | Vite build (default static) |

### What Stays the Same

- All React components (TerminalsView, AgentWorld, KanbanBoard, Memory, Vault, etc.)
- Tailwind CSS styling
- framer-motion animations
- @dnd-kit drag-and-drop
- Three.js / react-three-fiber (3D agent world)
- xterm.js terminal rendering
- prism-react-renderer code highlighting
- lucide-react icons

### Adaptation Layer (`src/hooks/useTauri.ts`)

```typescript
// Wraps invoke() with typed commands
export function useAgents() {
  const list = () => invoke<AgentStatus[]>('agent_list')
  const create = (config: AgentConfig) => invoke<string>('agent_create', { config })
  const start = (id: string, prompt: string) => invoke('agent_start', { id, prompt })
  // ...
}

// Wraps listen() for events
export function useTauriEvent<T>(event: string, handler: (payload: T) => void) {
  useEffect(() => {
    const unlisten = listen<T>(event, (e) => handler(e.payload))
    return () => { unlisten.then(fn => fn()) }
  }, [event, handler])
}
```

This replaces the current `useElectron*` hooks with the same interface shape, minimizing changes in consuming components.

### Routes

| Route | Component | Window |
|---|---|---|
| `/` | Hub (sidebar + mosaic) | Main window |
| `/console/:agentId` | Pop-out console | Detached windows |
| `/agents` | Agent dashboard | Hub (sidebar nav) |
| `/kanban` | Kanban board | Hub |
| `/memory` | Memory viewer | Hub |
| `/vault` | Knowledge vault | Hub |
| `/settings` | Settings | Hub |
| `/skills` | Skills marketplace | Hub |
| `/automations` | Automations | Hub |
| `/plugins` | Plugin management | Hub |
| `/projects` | Project browser | Hub |
| `/recurring-tasks` | Recurring tasks | Hub |
| `/usage` | Usage tracking | Hub |
| `/whats-new` | Changelog | Hub |
| `/tray-panel` | Tray popover | macOS tray |

---

## Project Structure

```
dorothy/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs              # Tauri entry point, plugin registration
│   │   ├── state.rs             # AppState, AgentStatus, persistence
│   │   ├── pty.rs               # portable-pty lifecycle, output routing
│   │   ├── windows.rs           # WindowRegistry, pop-out/dock
│   │   ├── notifications.rs     # OS + in-app notification dispatch
│   │   ├── sidecar.rs           # Node.js sidecar lifecycle, JSON-RPC
│   │   ├── db.rs                # rusqlite vault operations
│   │   └── commands/
│   │       ├── agent.rs         # agent_* commands
│   │       ├── pty.rs           # pty_* commands
│   │       ├── window.rs        # window_* commands
│   │       ├── settings.rs      # settings commands
│   │       ├── vault.rs         # vault_* commands
│   │       ├── memory.rs        # memory_* commands
│   │       ├── shell.rs         # shell/dialog commands
│   │       └── sidecar.rs       # sidecar_call command
│   ├── sidecars/
│   │   └── dorothy-node/        # Node.js sidecar bundle
│   │       ├── index.ts         # Entry point
│   │       ├── services/        # Telegram, Slack, MCP, API server
│   │       ├── providers/       # LLM provider integrations
│   │       └── package.json
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/
│   ├── main.tsx                 # React entry, router setup
│   ├── routes/
│   │   ├── hub.tsx
│   │   ├── console.tsx
│   │   ├── agents.tsx
│   │   ├── kanban.tsx
│   │   ├── memory.tsx
│   │   ├── vault.tsx
│   │   ├── settings.tsx
│   │   ├── skills.tsx
│   │   ├── automations.tsx
│   │   └── tray-panel.tsx
│   ├── components/              # Migrated from src/components/
│   ├── hooks/
│   │   ├── useTauri.ts          # invoke() + listen() wrappers
│   │   ├── useAgents.ts
│   │   ├── useTerminal.ts
│   │   ├── useLayout.ts         # react-mosaic state
│   │   └── useNotifications.ts
│   └── lib/                     # Types, constants, utilities
├── vite.config.ts
├── tailwind.config.ts
├── package.json
├── mcp-*/                       # MCP servers (bundled in sidecar)
├── skills/                      # Bundled skills (unchanged)
└── hooks/                       # Git hooks (unchanged)
```

---

## Migration Phases

Each phase produces a testable result on both macOS and Fedora Linux.

### Phase 1: Scaffold Tauri + Vite + React

- Initialize Tauri v2 project (`src-tauri/`)
- Setup Vite + React + Tailwind + React Router
- Migrate React components from Next.js (mechanical: update imports, routing)
- Verify: app launches in Tauri on macOS and Linux, frontend renders, no backend

### Phase 2: Rust Core — PTY & State

- Implement `state.rs` (AppState, agent CRUD, disk persistence)
- Implement `pty.rs` (portable-pty, spawn, I/O threads, output routing)
- Implement agent and PTY Tauri commands
- Adapt frontend hooks (useTauri, useAgents, useTerminal)
- Verify: create agent, run claude, see terminal output in hub on both platforms

### Phase 3: Multi-Window (the key feature)

- Implement `windows.rs` (WindowRegistry, pop-out/dock lifecycle)
- Implement window Tauri commands
- Build `/console/:agentId` route (minimal pop-out UI)
- Integrate react-mosaic in hub
- Verify: pop-out a console as OS window, drag-resize in mosaic, re-dock, works on both platforms

### Phase 4: Notifications

- Implement `notifications.rs`
- Add `tauri-plugin-notification` (Notification Center on macOS, libnotify on Linux)
- In-app badges, toasts, peonping integration
- Navigation: click notification → focus correct window
- Verify: agent completes → notification → click → lands on correct console, on both platforms

### Phase 5: Node.js Sidecar

- Extract services from `electron/` into sidecar bundle: Telegram, Slack, MCP orchestrator, API HTTP server, JIRA, GWS, SocialData, X API, hooks-manager, kanban-automation, obsidian-service, tasmania-client, scheduler/cron
- Implement `sidecar.rs` (lifecycle, JSON-RPC bridge)
- Wire sidecar events to Tauri events (e.g., Telegram message → agent trigger)
- Verify: Telegram bot works, API server on port 1280 responds, MCP orchestrator spawns, on both platforms

### Phase 6: SQLite Rust + Platform Polish

- Migrate vault from better-sqlite3 to rusqlite (`db.rs`)
- macOS tray integration (conditional, skipped on Linux)
- Tauri auto-updater
- Build & packaging: `.dmg` for macOS, `.AppImage`/`.deb` for Linux
- Verify: full feature parity with current Dorothy Electron, on both platforms

---

## Key Dependencies (Rust)

| Crate | Purpose |
|---|---|
| `tauri` v2 | App framework |
| `portable-pty` | PTY management (cross-platform) |
| `rusqlite` | SQLite for vault |
| `serde` / `serde_json` | Serialization |
| `tokio` | Async runtime (Tauri v2 uses tokio) |
| `tauri-plugin-notification` | OS notifications |
| `tauri-plugin-dialog` | File/folder dialogs |
| `tauri-plugin-shell` | Sidecar management |

## Key Dependencies (Frontend, changed)

| Old | New |
|---|---|
| `next` | `vite` + `@vitejs/plugin-react` |
| `next/navigation` | `react-router` v7 |
| Electron IPC (`window.electronAPI`) | `@tauri-apps/api` (`invoke`, `listen`) |
| `react-grid-layout` | `react-mosaic-component` |

## Key Dependencies (Frontend, unchanged)

`react`, `xterm`, `xterm-addon-fit`, `three`, `@react-three/fiber`, `@react-three/drei`, `framer-motion`, `@dnd-kit/*`, `tailwindcss`, `lucide-react`, `prism-react-renderer`

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `portable-pty` behavior differences macOS vs Linux | Test PTY spawn/resize/signal on both platforms in Phase 2 |
| react-mosaic integration complexity | Prototype mosaic layout early in Phase 3 before wiring to real agents |
| Sidecar Node.js packaging on Linux | Test sidecar bundling on Fedora early, Tauri's sidecar system handles binary embedding |
| xterm.js performance in Tauri webview | Tauri uses system webview (WebKit on macOS, WebKitGTK on Linux) — benchmark in Phase 2 |
| JSON-RPC latency for sidecar calls | Only non-critical-path services use sidecar; PTY path is pure Rust |
| WebKitGTK version on Fedora | Fedora ships recent WebKitGTK; document minimum version requirement |
| WebKitGTK keyboard/clipboard quirks on Linux | WebKitGTK has minor differences in keyboard event handling and clipboard access vs WebKit/macOS — test xterm.js input handling explicitly in Phase 2 |
