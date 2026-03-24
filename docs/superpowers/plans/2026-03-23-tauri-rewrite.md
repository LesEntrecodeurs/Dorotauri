# Dorothy Tauri Rewrite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Dorothy from Electron to Tauri v2 with multi-window console management, flexible mosaic layout, and Rust-native PTY handling.

**Architecture:** Rust core holds authoritative state (agents, PTYs, windows). Frontend is Vite + React with react-mosaic. Non-critical services run in a Node.js sidecar communicating via JSON-RPC over stdin/stdout.

**Tech Stack:** Tauri v2, Rust (portable-pty, rusqlite, tokio), Vite, React 19, React Router v7, react-mosaic-component, xterm.js, Tailwind CSS v4, Zustand

**Spec:** `docs/superpowers/specs/2026-03-23-tauri-rewrite-design.md`

---

## File Structure

### New Files (Rust Core)

| File | Responsibility |
|------|----------------|
| `src-tauri/Cargo.toml` | Rust dependencies |
| `src-tauri/tauri.conf.json` | Tauri app configuration |
| `src-tauri/build.rs` | Tauri build script |
| `src-tauri/src/main.rs` | Entry point, plugin registration |
| `src-tauri/src/lib.rs` | Library root, module declarations |
| `src-tauri/src/state.rs` | AppState, AgentStatus, persistence |
| `src-tauri/src/pty.rs` | portable-pty lifecycle, output routing |
| `src-tauri/src/windows.rs` | WindowRegistry, pop-out/dock |
| `src-tauri/src/notifications.rs` | OS + in-app notification dispatch |
| `src-tauri/src/sidecar.rs` | Node.js sidecar lifecycle, JSON-RPC |
| `src-tauri/src/db.rs` | rusqlite vault operations |
| `src-tauri/src/commands/mod.rs` | Command module root |
| `src-tauri/src/commands/agent.rs` | agent_* Tauri commands |
| `src-tauri/src/commands/pty.rs` | pty_* Tauri commands |
| `src-tauri/src/commands/window.rs` | window_* Tauri commands |
| `src-tauri/src/commands/settings.rs` | settings Tauri commands |
| `src-tauri/src/commands/vault.rs` | vault_* Tauri commands |
| `src-tauri/src/commands/memory.rs` | memory_* Tauri commands |
| `src-tauri/src/commands/shell.rs` | shell/dialog Tauri commands |
| `src-tauri/src/commands/sidecar.rs` | sidecar_call command |

### New Files (Frontend)

| File | Responsibility |
|------|----------------|
| `vite.config.ts` | Vite + React + Tauri config |
| `index.html` | Vite entry HTML |
| `src/main.tsx` | React entry, router setup |
| `src/routes/hub.tsx` | Hub window (sidebar + mosaic) |
| `src/routes/console.tsx` | Pop-out console route |
| `src/routes/agents.tsx` | Agent dashboard page |
| `src/routes/kanban.tsx` | Kanban board page |
| `src/routes/memory.tsx` | Memory viewer page |
| `src/routes/vault.tsx` | Knowledge vault page |
| `src/routes/settings.tsx` | Settings page |
| `src/routes/skills.tsx` | Skills marketplace page |
| `src/routes/automations.tsx` | Automations page |
| `src/routes/plugins.tsx` | Plugins page |
| `src/routes/projects.tsx` | Projects page |
| `src/routes/recurring-tasks.tsx` | Recurring tasks page |
| `src/routes/usage.tsx` | Usage page |
| `src/routes/whats-new.tsx` | Changelog page |
| `src/routes/pallet-town.tsx` | Pallet Town game page |
| `src/routes/tray-panel.tsx` | Tray panel page |
| `src/hooks/useTauri.ts` | invoke() + listen() wrappers |
| `src/hooks/useLayout.ts` | react-mosaic state + persistence |
| `src/hooks/useNotifications.ts` | In-app notification state |

### Modified Files (Frontend migration)

| File | Change |
|------|--------|
| `src/hooks/useElectron.ts` | Rewrite: `window.electronAPI.*` → `invoke()` |
| `src/hooks/useSettings.ts` | Replace `window.electronAPI.settings.*` → `invoke()` |
| `src/hooks/useAgents.ts` | Replace API fetch → `invoke()` |
| `src/hooks/useMemory.ts` | Replace `window.electronAPI.memory.*` → `invoke()` |
| `src/hooks/useObsidian.ts` | Replace `window.electronAPI.obsidian.*` → `invoke()` |
| `src/hooks/useElectronKanban.ts` | Replace `window.electronAPI.kanban.*` → `invoke()` |
| `src/hooks/useClaude.ts` | Replace API fetch → `invoke()` |
| `src/components/ClientLayout.tsx` | Replace `usePathname` from next → react-router, remove `'use client'` |
| `src/components/Sidebar.tsx` | Replace next/link → react-router Link |
| `src/components/TerminalsView/` | Replace TerminalGrid with react-mosaic, adapt hooks |
| `src/store/index.ts` | Keep as-is (Zustand, no Next.js deps) |
| `package.json` | Remove next/electron deps, add vite/tauri/react-router |
| `tsconfig.json` | Update paths for Vite |

### Files to Remove

| File/Directory | Reason |
|------|--------|
| `src/app/` | Next.js app router (replaced by src/routes/) |
| `electron/` | Electron main process (replaced by src-tauri/) |
| `next.config.ts` | Next.js config |
| `postcss.config.mjs` | Replaced by Vite PostCSS config |
| `src/types/electron.d.ts` | Electron API type declarations (replaced by Tauri types) |

### Sidecar (Phase 5)

| File | Responsibility |
|------|----------------|
| `src-tauri/sidecars/dorothy-node/index.ts` | Sidecar entry, JSON-RPC server |
| `src-tauri/sidecars/dorothy-node/services/` | Extracted from `electron/services/` |
| `src-tauri/sidecars/dorothy-node/providers/` | Extracted from `electron/providers/` |
| `src-tauri/sidecars/dorothy-node/package.json` | Sidecar dependencies |

---

## Phase 1: Scaffold Tauri + Vite + React

### Task 1: Initialize Tauri v2 project

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`

- [ ] **Step 1: Install Tauri CLI**

```bash
cargo install tauri-cli --version "^2"
```

- [ ] **Step 2: Create src-tauri directory**

```bash
mkdir -p src-tauri/src
```

- [ ] **Step 3: Write Cargo.toml**

```toml
[package]
name = "dorothy"
version = "1.2.5"
edition = "2021"

[lib]
name = "dorothy_lib"
crate-type = ["lib", "cdylib", "staticlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["macos-private-api"] }
tauri-plugin-shell = "2"
tauri-plugin-dialog = "2"
tauri-plugin-notification = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
uuid = { version = "1", features = ["v4"] }
dirs = "5"
```

- [ ] **Step 4: Write build.rs**

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 5: Write lib.rs (minimal)**

```rust
mod state;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 6: Write main.rs**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    dorothy_lib::run();
}
```

- [ ] **Step 7: Write tauri.conf.json**

Use the current Dorothy window settings (1600x1000, min 1200x800, hidden title bar). Set `devUrl` to Vite dev server, `frontendDist` to `../dist`. App identifier `io.dorothy.app`.

Refer to: current `electron/main.ts` lines creating the BrowserWindow for exact dimensions and behavior.

- [ ] **Step 8: Verify Rust compiles**

```bash
cd src-tauri && cargo check
```

Expected: compiles with no errors.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/
git commit -m "feat: initialize Tauri v2 project scaffold"
```

---

### Task 2: Setup Vite + React

**Files:**
- Create: `vite.config.ts`
- Create: `index.html`
- Modify: `package.json`
- Modify: `tsconfig.json`

- [ ] **Step 1: Update package.json**

Remove Next.js, Electron, and related deps. Add Vite, React Router, Tauri API, react-mosaic:

Remove from dependencies: `next`
Remove from devDependencies: `electron`, `electron-builder`, `@electron/notarize`, `@electron/rebuild`, `concurrently`, `wait-on`, `eslint-config-next`

Add to dependencies:
```json
"react-router": "^7",
"react-mosaic-component": "^6",
"@tauri-apps/api": "^2",
"@tauri-apps/plugin-shell": "^2",
"@tauri-apps/plugin-dialog": "^2",
"@tauri-apps/plugin-notification": "^2"
```

Add to devDependencies:
```json
"vite": "^6",
"@vitejs/plugin-react": "^4",
"@tauri-apps/cli": "^2"
```

Update scripts:
```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "tauri": "tauri",
  "tauri:dev": "tauri dev",
  "tauri:build": "tauri build",
  "test": "vitest"
}
```

- [ ] **Step 2: Create vite.config.ts**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  css: {
    postcss: {
      plugins: [
        (await import('@tailwindcss/postcss')).default,
      ],
    },
  },
})
```

- [ ] **Step 3: Create index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Dorothy | Agent Control Center</title>
    <link rel="icon" href="/favicon.ico" />
  </head>
  <body class="antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Update tsconfig.json**

Update for Vite compatibility. Key changes:
- Remove Next.js plugin references
- Keep `@/*` path alias pointing to `./src/*`
- Set `"moduleResolution": "bundler"`
- Set `"jsx": "react-jsx"`

- [ ] **Step 5: Install dependencies**

```bash
npm install
```

- [ ] **Step 6: Verify Vite starts**

```bash
npx vite --config vite.config.ts
```

Expected: Vite dev server starts on port 1420 (will show blank page since no main.tsx yet).

- [ ] **Step 7: Commit**

```bash
git add vite.config.ts index.html package.json tsconfig.json package-lock.json
git commit -m "feat: setup Vite + React build system"
```

---

### Task 3: React entry point and router

**Files:**
- Create: `src/main.tsx`
- Create: `src/routes/hub.tsx` (stub)
- Create: `src/routes/console.tsx` (stub)
- Modify: `src/app/globals.css` → move to `src/globals.css`

- [ ] **Step 1: Move globals.css**

```bash
cp src/app/globals.css src/globals.css
```

Remove `'use client'` or any Next.js-specific directives. Keep the Tailwind `@import "tailwindcss"` and all CSS variables.

- [ ] **Step 2: Create src/main.tsx**

```typescript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router'
import './globals.css'
import Hub from './routes/hub'
import Console from './routes/console'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Hub />} />
        <Route path="/console/:agentId" element={<Console />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
)
```

- [ ] **Step 3: Create stub hub route**

```typescript
// src/routes/hub.tsx
export default function Hub() {
  return <div className="p-8 text-text-primary">Dorothy Hub — Tauri</div>
}
```

- [ ] **Step 4: Create stub console route**

```typescript
// src/routes/console.tsx
import { useParams } from 'react-router'

export default function Console() {
  const { agentId } = useParams()
  return <div className="p-4">Console: {agentId}</div>
}
```

- [ ] **Step 5: Verify app renders in browser**

```bash
npx vite
```

Open http://localhost:1420 — should show "Dorothy Hub — Tauri".

- [ ] **Step 6: Verify app renders in Tauri**

```bash
cargo tauri dev
```

Expected: Tauri window opens showing the hub stub. Test on macOS and Linux.

- [ ] **Step 7: Commit**

```bash
git add src/main.tsx src/globals.css src/routes/
git commit -m "feat: React entry point with router and Tauri window"
```

---

### Task 4: Create all route stubs

**Files:**
- Create: `src/routes/agents.tsx`
- Create: `src/routes/kanban.tsx`
- Create: `src/routes/memory.tsx`
- Create: `src/routes/vault.tsx`
- Create: `src/routes/settings.tsx`
- Create: `src/routes/skills.tsx`
- Create: `src/routes/automations.tsx`
- Create: `src/routes/plugins.tsx`
- Create: `src/routes/projects.tsx`
- Create: `src/routes/recurring-tasks.tsx`
- Create: `src/routes/usage.tsx`
- Create: `src/routes/whats-new.tsx`
- Create: `src/routes/pallet-town.tsx`
- Create: `src/routes/tray-panel.tsx`
- Modify: `src/main.tsx` (add all routes)

- [ ] **Step 1: Create route stubs**

Each route stub follows the same pattern — a placeholder that imports and renders the existing component from `src/components/` or `src/app/`:

```typescript
// src/routes/agents.tsx
export default function AgentsPage() {
  return <div className="p-8">Agents — coming soon</div>
}
```

Create one for each: agents, kanban, memory, vault, settings, skills, automations, plugins, projects, recurring-tasks, usage, whats-new, pallet-town, tray-panel.

- [ ] **Step 2: Wire all routes into main.tsx**

Add every route to the `<Routes>` block in `src/main.tsx`. The hub route wraps non-console routes in a shared layout component (ClientLayout with sidebar).

```typescript
import ClientLayout from './components/ClientLayout'

// In Routes:
<Route element={<ClientLayout />}>
  <Route path="/" element={<Hub />} />
  <Route path="/agents" element={<AgentsPage />} />
  <Route path="/kanban" element={<KanbanPage />} />
  // ... all hub routes
</Route>
<Route path="/console/:agentId" element={<Console />} />
<Route path="/tray-panel" element={<TrayPanel />} />
```

Note: ClientLayout will need to be adapted to use `<Outlet />` from react-router instead of `{children}`. This is done in Task 5.

- [ ] **Step 3: Verify navigation works**

```bash
cargo tauri dev
```

Navigate to each route by editing the URL bar. Each should show its stub.

- [ ] **Step 4: Commit**

```bash
git add src/routes/ src/main.tsx
git commit -m "feat: add all route stubs with React Router"
```

---

### Task 5: Adapt ClientLayout for React Router

**Files:**
- Modify: `src/components/ClientLayout.tsx`
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Adapt ClientLayout**

Key changes:
- Remove `'use client'` directive
- Replace `import { usePathname } from 'next/navigation'` → `import { useLocation, Outlet } from 'react-router'`
- Replace `usePathname()` → `useLocation().pathname`
- Replace `{children}` → `<Outlet />` (ClientLayout becomes a layout route)
- Remove `window.electronAPI` update checks (will be re-added in Phase 6)
- Keep the Zustand store, dark mode, mobile menu logic unchanged

- [ ] **Step 2: Adapt Sidebar**

Key changes:
- Remove `'use client'` directive
- Replace `import Link from 'next/link'` → `import { Link, useLocation } from 'react-router'`
- Replace `usePathname()` → `useLocation().pathname`
- Keep all navigation items, icons, and styling identical

- [ ] **Step 3: Verify layout renders with sidebar**

```bash
cargo tauri dev
```

Expected: Hub shows with sidebar. Navigate between routes — sidebar highlights correct item. Mobile menu works.

- [ ] **Step 4: Commit**

```bash
git add src/components/ClientLayout.tsx src/components/Sidebar.tsx
git commit -m "refactor: adapt ClientLayout and Sidebar for React Router"
```

---

### Task 6: Create Tauri hook stubs

**Files:**
- Create: `src/hooks/useTauri.ts`
- Create: `src/hooks/useLayout.ts`
- Create: `src/hooks/useNotifications.ts`

- [ ] **Step 1: Create useTauri.ts**

Core bridge hook that wraps Tauri's `invoke()` and `listen()`:

```typescript
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useEffect, useCallback } from 'react'

// Typed invoke wrapper
export function useTauriCommand<T>(command: string) {
  return useCallback(
    (args?: Record<string, unknown>) => invoke<T>(command, args),
    [command]
  )
}

// Event listener hook
export function useTauriEvent<T>(event: string, handler: (payload: T) => void) {
  useEffect(() => {
    let unlisten: UnlistenFn | undefined

    listen<T>(event, (e) => handler(e.payload)).then((fn) => {
      unlisten = fn
    })

    return () => {
      unlisten?.()
    }
  }, [event, handler])
}

// Check if running in Tauri
export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
```

- [ ] **Step 2: Create useLayout.ts (stub)**

```typescript
import { useState, useCallback } from 'react'
import type { MosaicNode } from 'react-mosaic-component'

export function useLayout() {
  const [layout, setLayout] = useState<MosaicNode<string> | null>(null)

  const addTile = useCallback((agentId: string) => {
    // TODO: Phase 3 — add agent tile to mosaic
  }, [])

  const removeTile = useCallback((agentId: string) => {
    // TODO: Phase 3 — remove agent tile from mosaic
  }, [])

  return { layout, setLayout, addTile, removeTile }
}
```

- [ ] **Step 3: Create useNotifications.ts (stub)**

```typescript
import { useState } from 'react'

interface AgentNotification {
  agentId: string
  type: 'complete' | 'error' | 'waiting'
  timestamp: number
  dismissed: boolean
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<AgentNotification[]>([])

  const dismiss = (agentId: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.agentId === agentId ? { ...n, dismissed: true } : n))
    )
  }

  return { notifications, dismiss }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useTauri.ts src/hooks/useLayout.ts src/hooks/useNotifications.ts
git commit -m "feat: add Tauri bridge hooks (useTauri, useLayout, useNotifications)"
```

---

### Task 7: Adapt useElectron hooks for Tauri

**Files:**
- Modify: `src/hooks/useElectron.ts`
- Modify: `src/hooks/useSettings.ts`
- Modify: `src/hooks/useMemory.ts`
- Modify: `src/hooks/useObsidian.ts`
- Modify: `src/hooks/useElectronKanban.ts`
- Modify: `src/hooks/useClaude.ts`

- [ ] **Step 1: Rewrite useElectron.ts**

Replace all `window.electronAPI.*` calls with `invoke()` from `@tauri-apps/api/core`. Replace `ipcRenderer.on()` listeners with `listen()` from `@tauri-apps/api/event`.

Key pattern change:

```typescript
// Before (Electron)
const list = await window.electronAPI!.agent.list()

// After (Tauri)
const list = await invoke<AgentStatus[]>('agent_list')
```

```typescript
// Before (Electron event listener)
window.electronAPI!.agent.onOutput((event) => { ... })

// After (Tauri event listener)
listen<AgentOutputEvent>('agent:output', (event) => { ... })
```

Replace `isElectron()` with `isTauri()` from `useTauri.ts`.

Keep the same hook interface (`useElectronAgents`, `useElectronSkills`, `useElectronFS`, `useElectronShell`) so consuming components don't need changes. Rename internally later.

For now, all `invoke()` calls will fail gracefully since the Rust commands don't exist yet (Phase 2). The hooks should catch errors and return empty defaults.

- [ ] **Step 2: Adapt useSettings.ts**

Same pattern: replace `window.electronAPI.settings.*` and `window.electronAPI.appSettings.*` with `invoke()` calls.

- [ ] **Step 3: Adapt remaining hooks**

Apply the same `window.electronAPI.*` → `invoke()` pattern to:
- `useMemory.ts`
- `useObsidian.ts`
- `useElectronKanban.ts`
- `useClaude.ts`

Each hook keeps its current interface. Internal calls change to `invoke()`.

- [ ] **Step 4: Verify app compiles and renders**

```bash
cargo tauri dev
```

Expected: App renders, hooks gracefully handle missing Rust commands (empty agent list, default settings).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/
git commit -m "refactor: adapt all Electron hooks to use Tauri invoke/listen"
```

---

### Task 8: Migrate page components to routes

**Files:**
- Modify: all `src/routes/*.tsx` stubs
- Move: referenced components from `src/app/` subdirectories

- [ ] **Step 1: Migrate simple pages**

For each page route, replace the stub with the actual component import. Each page in `src/app/*/page.tsx` is a thin wrapper that renders a component from `src/components/`. Port these:

```typescript
// src/routes/agents.tsx
import AgentList from '@/components/AgentList'
export default function AgentsPage() {
  return <AgentList />
}
```

Apply this pattern to: agents, kanban, memory, vault, settings, skills, automations, plugins, projects, usage, whats-new, pallet-town.

Check each `src/app/*/page.tsx` to see what component it renders and copy that import.

- [ ] **Step 2: Migrate recurring-tasks (has sub-components)**

The recurring-tasks page has its own components and hooks inside `src/app/recurring-tasks/`. Move these to `src/components/RecurringTasks/` or keep them co-located in the route:

```bash
mkdir -p src/components/RecurringTasks
cp -r src/app/recurring-tasks/components/* src/components/RecurringTasks/
cp -r src/app/recurring-tasks/hooks/* src/components/RecurringTasks/
cp src/app/recurring-tasks/types.ts src/components/RecurringTasks/
cp src/app/recurring-tasks/utils.ts src/components/RecurringTasks/
```

Update imports in the copied files. Create `src/routes/recurring-tasks.tsx` that imports and renders the page component.

- [ ] **Step 3: Remove 'use client' directives**

Grep all files in `src/components/` and `src/hooks/` for `'use client'` and remove them. This is a Next.js-only directive not needed in Vite:

```bash
grep -rl "'use client'" src/components/ src/hooks/ src/store/ | head -50
```

Remove the directive from every file found.

- [ ] **Step 4: Fix Next.js imports across components**

Search for and replace Next.js-specific imports in all components:

| Find | Replace |
|------|---------|
| `from 'next/navigation'` | `from 'react-router'` |
| `from 'next/link'` | `from 'react-router'` |
| `from 'next/image'` | Use `<img>` tag directly |
| `useRouter()` | `useNavigate()` |
| `usePathname()` | `useLocation().pathname` |
| `useSearchParams()` | `useSearchParams()` from react-router |
| `<Link href=` | `<Link to=` |
| `router.push(` | `navigate(` |

```bash
grep -rl "from 'next/" src/components/ src/hooks/ src/routes/ | head -50
```

Fix each file found.

- [ ] **Step 5: Verify all routes render**

```bash
cargo tauri dev
```

Navigate to each route. All should render their content (with empty data since Rust backend isn't wired yet).

- [ ] **Step 6: Commit**

```bash
git add src/routes/ src/components/
git commit -m "feat: migrate all page components from Next.js to Vite routes"
```

---

### Task 9: Move static assets and clean up Next.js

**Files:**
- Move: `public/` assets (if any)
- Remove: `src/app/` directory
- Remove: `next.config.ts`
- Remove: `postcss.config.mjs` (PostCSS config is now in vite.config.ts)
- Modify: `.gitignore`

- [ ] **Step 1: Move static assets**

Vite serves from `public/` same as Next.js. Check what's in `public/` and ensure it's accessible:

```bash
ls public/
```

Images, favicon, manifest.json should work as-is.

- [ ] **Step 2: Add .superpowers to .gitignore**

```
# Superpowers brainstorm sessions
.superpowers/
```

- [ ] **Step 3: Remove Next.js files**

**IMPORTANT:** Task 8 Step 2 must be completed first — it copies `src/app/recurring-tasks/` sub-components to a new location. Verify the copy was done before deleting.

```bash
rm -rf src/app/
rm -f next.config.ts
rm -f postcss.config.mjs
```

- [ ] **Step 4: Verify clean build**

```bash
npx vite build
cargo tauri dev
```

Expected: Builds clean, app runs.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove Next.js app directory and config"
```

---

### Task 10: Platform verification

- [ ] **Step 1: Test on macOS**

```bash
cargo tauri dev
```

Verify: app opens, sidebar works, route navigation works, window titlebar renders correctly, window drag works.

- [ ] **Step 2: Test on Fedora Linux**

Ensure WebKitGTK is installed:
```bash
sudo dnf install webkit2gtk4.1-devel
```

```bash
cargo tauri dev
```

Verify: same checks as macOS. Note any WebKitGTK rendering differences.

- [ ] **Step 3: Commit any platform fixes**

```bash
git add -A
git commit -m "fix: platform compatibility adjustments for macOS and Linux"
```

---

## Phase 2: Rust Core — PTY & State

### Task 11: State types and persistence

**Files:**
- Create: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write state.rs**

Define `AppState`, `AgentStatus`, `AppSettings`, and persistence. Mirror the TypeScript types from `electron/types/index.ts`:

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::path::PathBuf;
use std::fs;

pub type AgentId = String;
pub type PtyId = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub id: AgentId,
    pub status: AgentState,
    pub project_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secondary_project_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_name: Option<String>,
    pub skills: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_task: Option<String>,
    #[serde(default)]
    pub output: Vec<String>,
    pub last_activity: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pty_id: Option<PtyId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub character: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default)]
    pub skip_permissions: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_line: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AgentState {
    Idle,
    Running,
    Completed,
    Error,
    Waiting,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub notifications_enabled: bool,
    pub notify_on_waiting: bool,
    pub notify_on_complete: bool,
    pub notify_on_error: bool,
    pub telegram_enabled: bool,
    pub slack_enabled: bool,
    pub terminal_font_size: Option<u8>,
    pub terminal_theme: Option<String>,
    pub default_provider: Option<String>,
    pub cli_paths: CliPaths,
    // Remaining fields (reference electron/types/index.ts for full list — 30+ fields total):
    // telegramBotToken, telegramChatId, telegramAuthToken, telegramAuthorizedChatIds,
    // telegramRequireMention, slackBotToken, slackAppToken, slackSigningSecret, slackChannelId,
    // jiraEnabled, jiraDomain, jiraEmail, jiraApiToken,
    // socialDataEnabled, socialDataApiKey,
    // xPostingEnabled, xApiKey, xApiSecret, xAccessToken, xAccessTokenSecret,
    // tasmaniaEnabled, tasmaniaServerPath, gwsEnabled, gwsSkillsInstalled,
    // verboseModeEnabled, autoCheckUpdates, opencodeEnabled, opencodeDefaultModel,
    // obsidianVaultPaths, notificationSounds, statusLineEnabled,
    // favoriteProjects, hiddenProjects, defaultProjectPath
    // Use #[serde(default)] on all Optional fields for backwards compatibility.
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliPaths {
    pub claude: String,
    pub codex: String,
    pub gemini: String,
    pub opencode: String,
    pub pi: String,
    pub node: String,
    #[serde(default)]
    pub additional_paths: Vec<String>,
}

pub struct AppState {
    pub agents: Mutex<HashMap<AgentId, AgentStatus>>,
    pub settings: Mutex<AppSettings>,
}

impl AppState {
    pub fn load() -> Self {
        let dorothy_dir = dirs::home_dir()
            .expect("no home dir")
            .join(".dorothy");
        fs::create_dir_all(&dorothy_dir).ok();

        let agents = Self::load_agents(&dorothy_dir);
        let settings = Self::load_settings(&dorothy_dir);

        Self {
            agents: Mutex::new(agents),
            settings: Mutex::new(settings),
        }
    }

    fn load_agents(dir: &PathBuf) -> HashMap<AgentId, AgentStatus> {
        let path = dir.join("agents.json");
        fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn load_settings(dir: &PathBuf) -> AppSettings {
        let path = dir.join("app-settings.json");
        fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save_agents(&self) {
        let dir = dirs::home_dir().unwrap().join(".dorothy");
        let agents = self.agents.lock().unwrap();
        let json = serde_json::to_string_pretty(&*agents).unwrap();
        fs::write(dir.join("agents.json"), json).ok();
    }

    pub fn save_settings(&self) {
        let dir = dirs::home_dir().unwrap().join(".dorothy");
        let settings = self.settings.lock().unwrap();
        let json = serde_json::to_string_pretty(&*settings).unwrap();
        fs::write(dir.join("app-settings.json"), json).ok();
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            notifications_enabled: true,
            notify_on_waiting: true,
            notify_on_complete: true,
            notify_on_error: true,
            telegram_enabled: false,
            slack_enabled: false,
            terminal_font_size: Some(13),
            terminal_theme: Some("dark".to_string()),
            default_provider: Some("claude".to_string()),
            cli_paths: CliPaths::default(),
        }
    }
}

impl Default for CliPaths {
    fn default() -> Self {
        Self {
            claude: "claude".to_string(),
            codex: "codex".to_string(),
            gemini: "gemini".to_string(),
            opencode: "opencode".to_string(),
            pi: "pi".to_string(),
            node: "node".to_string(),
            additional_paths: vec![],
        }
    }
}
```

- [ ] **Step 2: Register state in lib.rs**

```rust
mod state;

use state::AppState;

pub fn run() {
    let app_state = AppState::load();

    tauri::Builder::default()
        .manage(app_state)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Verify compiles**

```bash
cd src-tauri && cargo check
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/lib.rs
git commit -m "feat: implement AppState with agent/settings persistence"
```

---

### Task 12: PTY manager

**Files:**
- Create: `src-tauri/src/pty.rs`
- Modify: `src-tauri/Cargo.toml` (add portable-pty)

- [ ] **Step 1: Add portable-pty dependency**

In `Cargo.toml`:
```toml
portable-pty = "0.8"
```

- [ ] **Step 2: Write pty.rs**

Implement PTY spawn, I/O thread, and output routing:

```rust
use portable_pty::{native_pty_system, CommandBuilder, PtySize, PtyPair, MasterPty, Child};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

use crate::state::{PtyId, AgentId};

pub struct PtyHandle {
    pub master: Box<dyn MasterPty + Send>,
    pub child: Box<dyn Child + Send + Sync>,
    pub agent_id: AgentId,
    pub target_windows: HashSet<String>, // window labels to emit to
}

pub struct PtyManager {
    pub handles: Mutex<HashMap<PtyId, Arc<Mutex<PtyHandle>>>>,
}

#[derive(Clone, serde::Serialize)]
pub struct PtyOutputEvent {
    pub agent_id: String,
    pub pty_id: String,
    pub data: Vec<u8>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            handles: Mutex::new(HashMap::new()),
        }
    }

    pub fn spawn(
        &self,
        pty_id: &str,
        agent_id: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
        app_handle: AppHandle,
    ) -> Result<(), String> {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| e.to_string())?;

        let mut cmd = CommandBuilder::new_default_prog();
        cmd.cwd(cwd);

        let child = pair.slave.spawn_command(cmd)
            .map_err(|e| e.to_string())?;

        // Start reader thread
        let mut reader = pair.master.try_clone_reader()
            .map_err(|e| e.to_string())?;
        let pty_id_clone = pty_id.to_string();
        let agent_id_clone = agent_id.to_string();

        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let event = PtyOutputEvent {
                            agent_id: agent_id_clone.clone(),
                            pty_id: pty_id_clone.clone(),
                            data: buf[..n].to_vec(),
                        };
                        // Emit to all windows
                        let _ = app_handle.emit("agent:output", &event);
                    }
                    Err(_) => break,
                }
            }
        });

        let handle = PtyHandle {
            master: pair.master,
            child,
            agent_id: agent_id.to_string(),
            target_windows: HashSet::new(),
        };

        self.handles.lock().unwrap()
            .insert(pty_id.to_string(), Arc::new(Mutex::new(handle)));

        Ok(())
    }

    pub fn write(&self, pty_id: &str, data: &[u8]) -> Result<(), String> {
        let handles = self.handles.lock().unwrap();
        let handle = handles.get(pty_id)
            .ok_or("PTY not found")?;
        let mut h = handle.lock().unwrap();
        use std::io::Write;
        h.master.write_all(data).map_err(|e| e.to_string())
    }

    pub fn resize(&self, pty_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let handles = self.handles.lock().unwrap();
        let handle = handles.get(pty_id)
            .ok_or("PTY not found")?;
        let h = handle.lock().unwrap();
        h.master.resize(PtySize {
            rows, cols,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| e.to_string())
    }

    pub fn kill(&self, pty_id: &str) -> Result<(), String> {
        let mut handles = self.handles.lock().unwrap();
        if let Some(handle) = handles.remove(pty_id) {
            let mut h = handle.lock().unwrap();
            h.child.kill().map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}
```

- [ ] **Step 3: Register PtyManager in lib.rs**

```rust
mod pty;
// ...
let pty_manager = pty::PtyManager::new();

tauri::Builder::default()
    .manage(app_state)
    .manage(pty_manager)
    // ...
```

- [ ] **Step 4: Verify compiles on both platforms**

```bash
cd src-tauri && cargo check
```

Test on macOS and Linux — portable-pty should compile on both.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/
git commit -m "feat: implement PtyManager with portable-pty"
```

---

### Task 13: Agent Tauri commands

**Files:**
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/agent.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create commands/mod.rs**

```rust
pub mod agent;
pub mod pty;
pub mod settings;
pub mod memory;
pub mod shell;
```

- [ ] **Step 2: Write commands/agent.rs**

Implement the agent CRUD commands that the frontend hooks call:

```rust
use tauri::State;
use uuid::Uuid;
use chrono::Utc; // add chrono to Cargo.toml

use crate::state::{AppState, AgentStatus, AgentState};
use crate::pty::PtyManager;

#[tauri::command]
pub fn agent_list(state: State<'_, AppState>) -> Vec<AgentStatus> {
    let agents = state.agents.lock().unwrap();
    agents.values().cloned().collect()
}

#[tauri::command]
pub fn agent_get(state: State<'_, AppState>, id: String) -> Option<AgentStatus> {
    let agents = state.agents.lock().unwrap();
    agents.get(&id).cloned()
}

#[tauri::command]
pub fn agent_create(
    state: State<'_, AppState>,
    config: serde_json::Value,
) -> Result<AgentStatus, String> {
    let id = Uuid::new_v4().to_string();
    let project_path = config["projectPath"].as_str()
        .ok_or("projectPath required")?
        .to_string();

    let agent = AgentStatus {
        id: id.clone(),
        status: AgentState::Idle,
        project_path,
        secondary_project_path: config["secondaryProjectPath"].as_str().map(String::from),
        worktree_path: None,
        branch_name: config["worktree"]["branchName"].as_str().map(String::from),
        skills: config["skills"].as_array()
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default(),
        current_task: None,
        output: vec![],
        last_activity: Utc::now().to_rfc3339(),
        error: None,
        pty_id: None,
        character: config["character"].as_str().map(String::from),
        name: config["name"].as_str().map(String::from),
        skip_permissions: config["skipPermissions"].as_bool().unwrap_or(false),
        provider: config["provider"].as_str().map(String::from),
        status_line: None,
    };

    let mut agents = state.agents.lock().unwrap();
    agents.insert(id, agent.clone());
    drop(agents);
    state.save_agents();

    Ok(agent)
}

#[tauri::command]
pub fn agent_start(
    state: State<'_, AppState>,
    pty_manager: State<'_, PtyManager>,
    app_handle: tauri::AppHandle,
    id: String,
    prompt: String,
) -> Result<(), String> {
    let mut agents = state.agents.lock().unwrap();
    let agent = agents.get_mut(&id).ok_or("Agent not found")?;

    let pty_id = Uuid::new_v4().to_string();
    agent.pty_id = Some(pty_id.clone());
    agent.status = AgentState::Running;
    agent.current_task = Some(prompt.chars().take(100).collect());
    agent.last_activity = Utc::now().to_rfc3339();

    let cwd = agent.project_path.clone();
    let provider = agent.provider.clone().unwrap_or_else(|| "claude".to_string());
    let skip = agent.skip_permissions;
    drop(agents);

    // Spawn PTY
    pty_manager.spawn(&pty_id, &id, &cwd, 120, 30, app_handle)?;

    // Build and send command to PTY
    let cli = match provider.as_str() {
        "claude" | _ => "claude",
    };
    let mut cmd = format!("{cli}");
    if skip {
        cmd.push_str(" --dangerously-skip-permissions");
    }
    cmd.push_str(&format!(" '{}'", prompt.replace('\'', "'\\''")));
    cmd.push('\n');

    pty_manager.write(&pty_id, cmd.as_bytes())?;

    state.save_agents();

    // Broadcast status change
    let _ = app_handle.emit("agent:status", serde_json::json!({
        "agentId": id,
        "status": "running",
    }));

    Ok(())
}

#[tauri::command]
pub fn agent_stop(
    state: State<'_, AppState>,
    pty_manager: State<'_, PtyManager>,
    app_handle: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let mut agents = state.agents.lock().unwrap();
    let agent = agents.get_mut(&id).ok_or("Agent not found")?;

    if let Some(pty_id) = agent.pty_id.take() {
        pty_manager.kill(&pty_id)?;
    }
    agent.status = AgentState::Idle;
    agent.last_activity = Utc::now().to_rfc3339();
    drop(agents);
    state.save_agents();

    let _ = app_handle.emit("agent:status", serde_json::json!({
        "agentId": id,
        "status": "idle",
    }));

    Ok(())
}

#[tauri::command]
pub fn agent_remove(state: State<'_, AppState>, pty_manager: State<'_, PtyManager>, id: String) -> Result<(), String> {
    let mut agents = state.agents.lock().unwrap();
    if let Some(agent) = agents.remove(&id) {
        if let Some(pty_id) = &agent.pty_id {
            pty_manager.kill(pty_id).ok();
        }
    }
    drop(agents);
    state.save_agents();
    Ok(())
}

#[tauri::command]
pub fn agent_update(
    state: State<'_, AppState>,
    id: String,
    updates: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut agents = state.agents.lock().unwrap();
    let agent = agents.get_mut(&id).ok_or("Agent not found")?;

    if let Some(name) = updates["name"].as_str() {
        agent.name = Some(name.to_string());
    }
    if let Some(character) = updates["character"].as_str() {
        agent.character = Some(character.to_string());
    }
    if let Some(skills) = updates["skills"].as_array() {
        agent.skills = skills.iter().filter_map(|v| v.as_str().map(String::from)).collect();
    }

    let result = serde_json::json!({ "success": true, "agent": agent.clone() });
    drop(agents);
    state.save_agents();
    Ok(result)
}

#[tauri::command]
pub fn agent_send_input(
    pty_manager: State<'_, PtyManager>,
    state: State<'_, AppState>,
    id: String,
    input: String,
) -> Result<(), String> {
    let agents = state.agents.lock().unwrap();
    let agent = agents.get(&id).ok_or("Agent not found")?;
    let pty_id = agent.pty_id.clone().ok_or("No PTY")?;
    drop(agents);
    pty_manager.write(&pty_id, input.as_bytes())
}
```

- [ ] **Step 3: Add chrono dependency**

In `Cargo.toml`:
```toml
chrono = { version = "0.4", features = ["serde"] }
```

- [ ] **Step 4: Register commands in lib.rs**

```rust
mod commands;

// In Builder:
.invoke_handler(tauri::generate_handler![
    commands::agent::agent_list,
    commands::agent::agent_get,
    commands::agent::agent_create,
    commands::agent::agent_start,
    commands::agent::agent_stop,
    commands::agent::agent_remove,
    commands::agent::agent_update,
    commands::agent::agent_send_input,
])
```

- [ ] **Step 5: Verify compiles**

```bash
cd src-tauri && cargo check
```

- [ ] **Step 6: Commit**

```bash
git add src-tauri/
git commit -m "feat: implement agent CRUD Tauri commands"
```

---

### Task 14: PTY Tauri commands

**Files:**
- Create: `src-tauri/src/commands/pty.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write commands/pty.rs**

```rust
use tauri::State;
use crate::pty::PtyManager;

#[tauri::command]
pub fn pty_write(pty_manager: State<'_, PtyManager>, pty_id: String, data: String) -> Result<(), String> {
    pty_manager.write(&pty_id, data.as_bytes())
}

#[tauri::command]
pub fn pty_resize(pty_manager: State<'_, PtyManager>, pty_id: String, cols: u16, rows: u16) -> Result<(), String> {
    pty_manager.resize(&pty_id, cols, rows)
}

#[tauri::command]
pub fn pty_kill(pty_manager: State<'_, PtyManager>, pty_id: String) -> Result<(), String> {
    pty_manager.kill(&pty_id)
}
```

- [ ] **Step 2: Register in lib.rs**

Add to the `invoke_handler`:
```rust
commands::pty::pty_write,
commands::pty::pty_resize,
commands::pty::pty_kill,
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/
git commit -m "feat: implement PTY write/resize/kill Tauri commands"
```

---

### Task 15: Settings and memory commands

**Files:**
- Create: `src-tauri/src/commands/settings.rs`
- Create: `src-tauri/src/commands/memory.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write commands/settings.rs**

```rust
use tauri::State;
use crate::state::{AppState, AppSettings};

#[tauri::command]
pub fn app_settings_get(state: State<'_, AppState>) -> AppSettings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
pub fn app_settings_save(state: State<'_, AppState>, settings: AppSettings) -> serde_json::Value {
    *state.settings.lock().unwrap() = settings;
    state.save_settings();
    serde_json::json!({ "success": true })
}
```

- [ ] **Step 2: Write commands/memory.rs**

Port the memory service logic — scan `~/.claude/projects/*/memory/` directories:

```rust
use std::fs;
use std::path::PathBuf;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMemory {
    pub project_name: String,
    pub memory_dir: String,
    pub files: Vec<MemoryFile>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFile {
    pub name: String,
    pub path: String,
    pub is_entrypoint: bool,
}

#[tauri::command]
pub fn memory_list_projects() -> Vec<ProjectMemory> {
    let home = dirs::home_dir().unwrap();
    let claude_projects = home.join(".claude").join("projects");

    let mut result = vec![];

    if let Ok(entries) = fs::read_dir(&claude_projects) {
        for entry in entries.flatten() {
            let memory_dir = entry.path().join("memory");
            if memory_dir.is_dir() {
                let files = list_memory_files(&memory_dir);
                if !files.is_empty() {
                    result.push(ProjectMemory {
                        project_name: entry.file_name().to_string_lossy().to_string(),
                        memory_dir: memory_dir.to_string_lossy().to_string(),
                        files,
                    });
                }
            }
        }
    }

    result
}

fn list_memory_files(dir: &PathBuf) -> Vec<MemoryFile> {
    let mut files = vec![];
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "md").unwrap_or(false) {
                let name = path.file_name().unwrap().to_string_lossy().to_string();
                files.push(MemoryFile {
                    is_entrypoint: name == "MEMORY.md",
                    name,
                    path: path.to_string_lossy().to_string(),
                });
            }
        }
    }
    files
}

#[tauri::command]
pub fn memory_read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn memory_write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Register commands in lib.rs**

Add all new commands to `invoke_handler`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/
git commit -m "feat: implement settings and memory Tauri commands"
```

---

### Task 16: Shell commands and filesystem

**Files:**
- Create: `src-tauri/src/commands/shell.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write commands/shell.rs**

```rust
use std::fs;
use std::path::PathBuf;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub path: String,
    pub name: String,
    pub last_modified: String,
}

#[tauri::command]
pub fn projects_list() -> Vec<ProjectInfo> {
    let home = dirs::home_dir().unwrap();
    // Scan common project directories
    let candidates = vec![
        home.join("projects"),
        home.join("code"),
        home.join("dev"),
        home.join("src"),
    ];

    let mut projects = vec![];
    for dir in candidates {
        if dir.is_dir() {
            if let Ok(entries) = fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() && path.join(".git").exists() {
                        let metadata = fs::metadata(&path).ok();
                        projects.push(ProjectInfo {
                            name: path.file_name().unwrap().to_string_lossy().to_string(),
                            path: path.to_string_lossy().to_string(),
                            last_modified: metadata
                                .and_then(|m| m.modified().ok())
                                .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
                                .unwrap_or_default(),
                        });
                    }
                }
            }
        }
    }

    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    projects
}
```

- [ ] **Step 2: Register and commit**

```bash
git add src-tauri/
git commit -m "feat: implement shell and filesystem Tauri commands"
```

---

### Task 17: Connect xterm.js to Rust PTY

**Files:**
- Modify: `src/hooks/useXtermTerminal.ts` (or `useAgentTerminal.ts`)
- Modify: `src/components/TerminalsView/hooks/useMultiTerminal.ts`
- Modify: `src/components/Terminal.tsx`

- [ ] **Step 1: Adapt terminal hooks to use Tauri events**

The key change: replace `window.electronAPI.agent.onOutput()` with `listen('agent:output', ...)`.

In `useMultiTerminal.ts`, the output handler currently receives data from Electron IPC. Replace with:

```typescript
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'

// In the effect that subscribes to output:
const unlisten = await listen<{ agent_id: string; data: number[] }>('agent:output', (event) => {
  const { agent_id, data } = event.payload
  const term = terminals.get(agent_id)
  if (term) {
    // Convert byte array to Uint8Array for xterm.js
    term.write(new Uint8Array(data))
  }
})

// For input, replace window.electronAPI.agent.sendInput:
const sendInput = (agentId: string, input: string) => {
  invoke('agent_send_input', { id: agentId, input })
}

// For resize:
const resizeTerminal = (agentId: string, cols: number, rows: number) => {
  // Look up the pty_id for this agent first
  invoke('pty_resize', { ptyId, cols, rows })
}
```

- [ ] **Step 2: Test terminal output**

```bash
cargo tauri dev
```

Create an agent, start it. Verify terminal output appears in xterm.js. Test typing input.

- [ ] **Step 3: Test on both macOS and Linux**

Verify xterm.js renders correctly in both WebKit (macOS) and WebKitGTK (Linux). Check keyboard input handling, clipboard operations.

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "feat: connect xterm.js terminals to Rust PTY via Tauri events"
```

---

### Task 18: End-to-end agent lifecycle test

- [ ] **Step 1: Test full cycle on macOS**

1. Launch app: `cargo tauri dev`
2. Create an agent (via UI — NewChatModal should work)
3. Start the agent with a simple prompt
4. See terminal output stream in real-time
5. Send input to the agent
6. Stop the agent
7. Remove the agent

- [ ] **Step 2: Test full cycle on Fedora Linux**

Same steps as above.

- [ ] **Step 3: Fix any issues found and commit**

```bash
git add -A
git commit -m "fix: agent lifecycle adjustments for cross-platform PTY"
```

---

## Phase 3: Multi-Window

### Task 19: Window registry

**Files:**
- Create: `src-tauri/src/windows.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write windows.rs**

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub id: String,
    pub window_type: WindowType,
    pub displayed_agents: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WindowType {
    Hub,
    Console { agent_id: String },
}

pub struct WindowRegistry {
    pub windows: Mutex<HashMap<String, WindowInfo>>,
    pub focused_window: Mutex<Option<String>>,
}

impl WindowRegistry {
    pub fn new() -> Self {
        Self {
            windows: Mutex::new(HashMap::new()),
            focused_window: Mutex::new(None),
        }
    }

    pub fn register(&self, id: &str, info: WindowInfo) {
        self.windows.lock().unwrap().insert(id.to_string(), info);
    }

    pub fn unregister(&self, id: &str) {
        self.windows.lock().unwrap().remove(id);
    }

    pub fn find_window_for_agent(&self, agent_id: &str) -> Option<String> {
        let windows = self.windows.lock().unwrap();
        // Prefer pop-out console windows
        for (id, info) in windows.iter() {
            if let WindowType::Console { agent_id: ref aid } = info.window_type {
                if aid == agent_id {
                    return Some(id.clone());
                }
            }
        }
        // Fall back to hub
        for (id, info) in windows.iter() {
            if matches!(info.window_type, WindowType::Hub) {
                if info.displayed_agents.contains(&agent_id.to_string()) {
                    return Some(id.clone());
                }
            }
        }
        None
    }

    pub fn has_focus(&self) -> bool {
        self.focused_window.lock().unwrap().is_some()
    }
}
```

- [ ] **Step 2: Register in lib.rs and wire focus events**

```rust
mod windows;

let window_registry = windows::WindowRegistry::new();

// In Builder:
.manage(window_registry)
.on_window_event(|window, event| {
    match event {
        tauri::WindowEvent::Focused(focused) => {
            let registry = window.state::<windows::WindowRegistry>();
            let mut fw = registry.focused_window.lock().unwrap();
            if *focused {
                *fw = Some(window.label().to_string());
            } else if fw.as_deref() == Some(window.label()) {
                *fw = None;
            }
        }
        tauri::WindowEvent::Destroyed => {
            let registry = window.state::<windows::WindowRegistry>();
            registry.unregister(window.label());
        }
        _ => {}
    }
})
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/
git commit -m "feat: implement WindowRegistry with focus tracking"
```

---

### Task 20: Window Tauri commands (pop-out/dock)

**Files:**
- Create: `src-tauri/src/commands/window.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write commands/window.rs**

```rust
use tauri::{State, Manager, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;
use crate::windows::{WindowRegistry, WindowInfo, WindowType};

#[tauri::command]
pub fn window_popout(
    app_handle: tauri::AppHandle,
    registry: State<'_, WindowRegistry>,
    agent_id: String,
) -> Result<String, String> {
    let window_id = format!("console-{}", Uuid::new_v4().to_string().split('-').next().unwrap());
    let url = format!("/console/{}", agent_id);

    WebviewWindowBuilder::new(
        &app_handle,
        &window_id,
        WebviewUrl::App(url.into()),
    )
    .title(format!("Dorothy — Agent {}", &agent_id[..8]))
    .inner_size(900.0, 600.0)
    .min_inner_size(400.0, 300.0)
    .build()
    .map_err(|e| e.to_string())?;

    registry.register(&window_id, WindowInfo {
        id: window_id.clone(),
        window_type: WindowType::Console { agent_id },
        displayed_agents: vec![],
    });

    Ok(window_id)
}

#[tauri::command]
pub fn window_dock(
    app_handle: tauri::AppHandle,
    registry: State<'_, WindowRegistry>,
    window_id: String,
) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window(&window_id) {
        window.close().map_err(|e| e.to_string())?;
    }
    registry.unregister(&window_id);
    Ok(())
}

#[tauri::command]
pub fn window_focus(
    app_handle: tauri::AppHandle,
    window_id: String,
) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window(&window_id) {
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn window_list(registry: State<'_, WindowRegistry>) -> Vec<WindowInfo> {
    registry.windows.lock().unwrap().values().cloned().collect()
}
```

- [ ] **Step 2: Register commands**

Add to `invoke_handler`.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/
git commit -m "feat: implement window pop-out/dock/focus Tauri commands"
```

---

### Task 21: Pop-out console route

**Files:**
- Modify: `src/routes/console.tsx`

- [ ] **Step 1: Build the console route**

Replace the stub with a real component that:
- Reads `agentId` from URL params
- Creates an xterm.js terminal instance
- Subscribes to `agent:output` events (filtered by agentId)
- Sends input via `invoke('agent_send_input', ...)`
- Shows a title bar with agent name, status badge, and "re-dock" button
- Re-dock button calls `invoke('window_dock', { windowId: currentWindowLabel })`

Use the existing `useXtermTerminal` or `useAgentTerminal` hook adapted for Tauri.

Get the current window label from `@tauri-apps/api/window`:
```typescript
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
const currentWindow = getCurrentWebviewWindow()
```

- [ ] **Step 2: Test pop-out**

From the hub, trigger a pop-out (will wire UI button next). For now, test by calling `invoke('window_popout', { agentId: '...' })` from the browser console.

Verify: new OS window opens, shows terminal, streams agent output.

- [ ] **Step 3: Commit**

```bash
git add src/routes/console.tsx
git commit -m "feat: implement pop-out console route with xterm.js"
```

---

### Task 22: react-mosaic hub layout

**Files:**
- Modify: `src/routes/hub.tsx`
- Modify: `src/hooks/useLayout.ts`
- Modify: `src/components/TerminalsView/` (major refactor)

- [ ] **Step 1: Replace TerminalGrid with react-mosaic**

The current `TerminalGrid` uses `react-grid-layout` with preset grids. Replace with `react-mosaic-component`:

```typescript
import { Mosaic, MosaicWindow } from 'react-mosaic-component'
import 'react-mosaic-component/react-mosaic-component.css'

// In hub.tsx:
<Mosaic<string>
  renderTile={(id, path) => (
    <MosaicWindow<string> path={path} title={`Agent ${id}`}
      toolbarControls={[
        <button key="popout" onClick={() => handlePopout(id)}>Pop Out</button>
      ]}
    >
      <TerminalPanel agentId={id} />
    </MosaicWindow>
  )}
  value={layout}
  onChange={setLayout}
/>
```

Each tile renders a `TerminalPanel` component (existing component from TerminalsView, adapted).

- [ ] **Step 2: Implement useLayout.ts**

Complete the stub from Task 6:
- Load saved layout from `~/.dorothy/layouts.json` via `invoke('app_settings_get')`
- Save layout on change (debounced 1s)
- Handle pop-out: remove leaf from mosaic tree
- Handle re-dock: insert leaf back into mosaic tree

- [ ] **Step 3: Add pop-out button to mosaic window toolbar**

Each `MosaicWindow` toolbar gets a "pop-out" icon button that calls:
```typescript
const handlePopout = async (agentId: string) => {
  await invoke('window_popout', { agentId })
  removeTile(agentId)  // remove from mosaic
}
```

- [ ] **Step 4: Test mosaic layout**

Verify: tiles can be dragged to reorder, separators can be resized, pop-out creates new window and removes tile from mosaic.

- [ ] **Step 5: Test on both platforms**

- [ ] **Step 6: Commit**

```bash
git add src/
git commit -m "feat: implement react-mosaic tiling layout in hub"
```

---

### Task 23: Layout persistence

**Files:**
- Modify: `src/hooks/useLayout.ts`
- Create: `src-tauri/src/commands/layout.rs` (optional, could use settings)

- [ ] **Step 1: Persist layout to disk**

Save the mosaic tree to `~/.dorothy/layouts.json` on every change (debounced). Load on app start.

```typescript
// In useLayout.ts
const saveLayout = useDebouncedCallback((layout: MosaicNode<string>) => {
  invoke('app_settings_save', {
    settings: { layout: JSON.stringify(layout) }
  })
}, 1000)
```

- [ ] **Step 2: Implement saved layouts (tab switching)**

Map the current "custom tabs" feature to named layouts. User can save current layout, switch between saved layouts.

- [ ] **Step 3: Commit**

```bash
git add src/ src-tauri/
git commit -m "feat: persist mosaic layout to disk with saved layouts"
```

---

### Task 24: Multi-window end-to-end test

- [ ] **Step 1: Test complete workflow**

1. Create 3 agents
2. See all 3 in mosaic layout
3. Pop out agent 1 → new window, mosaic adjusts
4. Pop out agent 2 → another window
5. Re-dock agent 1 (close pop-out or click re-dock) → back in mosaic
6. Save layout, restart app, layout restored

- [ ] **Step 2: Test on both macOS and Linux**

- [ ] **Step 3: Fix issues and commit**

```bash
git add -A
git commit -m "fix: multi-window workflow adjustments"
```

---

## Phase 4: Notifications

### Task 25: OS notifications

**Files:**
- Create: `src-tauri/src/notifications.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write notifications.rs**

```rust
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
use crate::windows::WindowRegistry;

pub fn notify_agent_event(
    app: &AppHandle,
    registry: &WindowRegistry,
    agent_id: &str,
    title: &str,
    body: &str,
) {
    if registry.has_focus() {
        // App is focused — emit in-app notification event
        let _ = app.emit("notification:in-app", serde_json::json!({
            "agentId": agent_id,
            "title": title,
            "body": body,
        }));
    } else {
        // App not focused — OS notification
        let _ = app.notification()
            .builder()
            .title(title)
            .body(body)
            .show();
    }
}
```

- [ ] **Step 2: Wire notifications to agent completion**

In the PTY reader thread (pty.rs), detect when the child process exits. On exit, call `notify_agent_event` with the completion status.

- [ ] **Step 3: Add notification plugin to Cargo.toml and lib.rs**

```toml
tauri-plugin-notification = "2"
```

```rust
.plugin(tauri_plugin_notification::init())
```

- [ ] **Step 4: Test on both platforms**

macOS: Notification Center toast. Linux: libnotify notification.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/
git commit -m "feat: implement OS notifications on agent completion"
```

---

### Task 26: In-app notifications

**Files:**
- Modify: `src/hooks/useNotifications.ts`
- Create: `src/components/NotificationToast.tsx`
- Modify: `src/components/Sidebar.tsx` (status badges)

- [ ] **Step 1: Complete useNotifications.ts**

Subscribe to `notification:in-app` Tauri events:

```typescript
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'

// Listen for in-app notifications
listen<{ agentId: string; title: string; body: string }>('notification:in-app', (event) => {
  addNotification(event.payload)
})
```

- [ ] **Step 2: Create NotificationToast component**

Toast at the bottom of the screen showing agent name + status. Click → navigate to the agent's window.

- [ ] **Step 3: Add status badges to sidebar**

In the agent list in the sidebar, show colored dots: green=completed, red=error, orange=waiting.

- [ ] **Step 4: Implement notification_navigate command**

```rust
#[tauri::command]
pub fn notification_navigate(
    app_handle: tauri::AppHandle,
    registry: State<'_, WindowRegistry>,
    agent_id: String,
) -> Result<(), String> {
    if let Some(window_id) = registry.find_window_for_agent(&agent_id) {
        if let Some(window) = app_handle.get_webview_window(&window_id) {
            window.set_focus().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
```

- [ ] **Step 5: Commit**

```bash
git add src/ src-tauri/
git commit -m "feat: implement in-app notifications with toast and sidebar badges"
```

---

## Phase 5: Node.js Sidecar

### Task 27: Extract sidecar from electron/

**Files:**
- Create: `src-tauri/sidecars/dorothy-node/`
- Create: `src-tauri/sidecars/dorothy-node/index.ts`
- Create: `src-tauri/sidecars/dorothy-node/package.json`

- [ ] **Step 1: Create sidecar project**

```bash
mkdir -p src-tauri/sidecars/dorothy-node/services
mkdir -p src-tauri/sidecars/dorothy-node/providers
```

- [ ] **Step 2: Create package.json**

Include the non-Electron dependencies from the main package.json:
- `node-telegram-bot-api`
- `@slack/bolt`
- `@anthropic-ai/sdk`
- `better-sqlite3` (temporary, until Phase 6 rusqlite migration)
- `uuid`

- [ ] **Step 3: Create JSON-RPC entry point**

```typescript
// src-tauri/sidecars/dorothy-node/index.ts
import * as readline from 'readline'

const rl = readline.createInterface({ input: process.stdin })

rl.on('line', async (line) => {
  try {
    const request = JSON.parse(line)
    const result = await handleRequest(request.method, request.params)

    if (request.id !== undefined) {
      const response = JSON.stringify({ jsonrpc: '2.0', result, id: request.id })
      process.stdout.write(response + '\n')
    }
  } catch (error) {
    // Send error response
  }
})

async function handleRequest(method: string, params: any): Promise<any> {
  // Route to appropriate service
  const [service, action] = method.split('.')
  switch (service) {
    case 'telegram': return telegramService.handle(action, params)
    case 'slack': return slackService.handle(action, params)
    case 'mcp': return mcpService.handle(action, params)
    // ...
  }
}
```

- [ ] **Step 4: Extract services from electron/**

Copy and adapt (remove Electron deps) from:

**Services (`electron/services/` → `services/`):**
- `telegram-bot.ts` → `services/telegram.ts`
- `slack-bot.ts` → `services/slack.ts`
- `mcp-orchestrator.ts` → `services/mcp.ts`
- `api-server.ts` + `api-routes/` → `services/api-server.ts`
- `kanban-automation.ts` → `services/kanban-automation.ts`
- `hooks-manager.ts` → `services/hooks-manager.ts`
- `obsidian-service.ts` → `services/obsidian.ts`
- `tasmania-client.ts` → `services/tasmania.ts`
- `vault-db.ts` → `services/vault-db.ts`
- `claude-service.ts` → `services/claude.ts`
- `update-checker.ts` → `services/update-checker.ts`

**Handlers (`electron/handlers/` → `handlers/`):**
- `scheduler-handlers.ts` → `handlers/scheduler.ts` (cron/recurring tasks)
- `automation-handlers.ts` → `handlers/automations.ts` (GitHub/JIRA polling)
- `kanban-handlers.ts` → `handlers/kanban.ts`
- `gws-handlers.ts` → `handlers/gws.ts` (Google Workspace)
- `obsidian-handlers.ts` → `handlers/obsidian.ts`
- `world-handlers.ts` → `handlers/world.ts`
- `cli-paths-handlers.ts` → `handlers/cli-paths.ts`
- `mcp-config-handlers.ts` → `handlers/mcp-config.ts`
- Integration test endpoints from `ipc-handlers.ts` (JIRA test, SocialData test, X API test) → `handlers/integrations.ts`

**Providers (`electron/providers/` → `providers/`):**
- All provider files (claude, codex, gemini, opencode, pi, cli)

**Utils (`electron/utils/` → `utils/`):**
- All utility files (ansi, cron-parser, statusline, etc.)

Remove all `import { BrowserWindow, ipcMain } from 'electron'` and replace IPC callbacks with JSON-RPC notifications to stdout. Replace `broadcastToAllWindows()` calls with JSON-RPC notifications that Rust forwards as Tauri events.

- [ ] **Step 5: Build sidecar**

```bash
cd src-tauri/sidecars/dorothy-node && npm install && npx tsc
```

- [ ] **Step 6: Commit**

```bash
git add src-tauri/sidecars/
git commit -m "feat: extract Node.js sidecar from Electron services"
```

---

### Task 28: Rust sidecar bridge

**Files:**
- Create: `src-tauri/src/sidecar.rs`
- Create: `src-tauri/src/commands/sidecar.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write sidecar.rs**

Implement sidecar lifecycle and JSON-RPC communication using `tauri_plugin_shell::process::CommandChild`:

```rust
use std::io::{BufRead, BufReader, Write};
use std::sync::Mutex;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

pub struct SidecarBridge {
    child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
}

impl SidecarBridge {
    pub fn new() -> Self {
        Self { child: Mutex::new(None) }
    }

    pub fn start(&self, app: &AppHandle) -> Result<(), String> {
        let (mut rx, child) = app.shell()
            .sidecar("dorothy-node")
            .map_err(|e| e.to_string())?
            .spawn()
            .map_err(|e| e.to_string())?;

        *self.child.lock().unwrap() = Some(child);

        // Read stdout for JSON-RPC responses/notifications
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                        // Parse JSON-RPC and emit as Tauri event
                        if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&String::from_utf8_lossy(&line)) {
                            if let Some(method) = msg["method"].as_str() {
                                let _ = app_clone.emit("sidecar:event", &msg);
                            }
                        }
                    }
                    _ => {}
                }
            }
        });

        Ok(())
    }

    /// Send a JSON-RPC request and wait for the response (matched by id).
    /// The stdout reader thread stores responses in a pending_responses map.
    /// This method polls until the response arrives or times out.
    pub async fn call(&self, method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let child = self.child.lock().unwrap();
        if let Some(ref child) = *child {
            let request = serde_json::json!({
                "jsonrpc": "2.0",
                "method": method,
                "params": params,
                "id": id,
            });
            child.write((serde_json::to_string(&request).unwrap() + "\n").as_bytes())
                .map_err(|e| e.to_string())?;
        }
        drop(child);

        // Wait for response matching this id (the stdout reader thread
        // should insert responses into a pending_responses: Arc<Mutex<HashMap<String, Value>>>
        // keyed by request id). Poll with timeout.
        // Implementation detail: use a tokio::sync::oneshot channel per request
        // registered before sending, fulfilled by the reader thread.
        todo!("Implement response matching via oneshot channel pattern")
    }
}
```

- [ ] **Step 2: Write commands/sidecar.rs**

```rust
#[tauri::command]
pub async fn sidecar_call(
    bridge: State<'_, SidecarBridge>,
    method: String,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    bridge.call(&method, params).await
}
```

- [ ] **Step 3: Start sidecar on app launch**

In `lib.rs` setup:
```rust
.setup(|app| {
    let bridge = app.state::<SidecarBridge>();
    bridge.start(&app.handle())?;
    Ok(())
})
```

- [ ] **Step 4: Configure sidecar in tauri.conf.json**

Add sidecar configuration to bundle the Node.js binary.

- [ ] **Step 5: Test sidecar communication**

- [ ] **Step 6: Commit**

```bash
git add src-tauri/
git commit -m "feat: implement Rust sidecar bridge with JSON-RPC"
```

---

### Task 29: Wire sidecar services to frontend

**Files:**
- Modify frontend hooks that call sidecar-backed services

- [ ] **Step 1: Wire Telegram/Slack settings testing**

Settings page "Test" buttons for Telegram/Slack should call:
```typescript
await invoke('sidecar_call', { method: 'telegram.test', params: {} })
```

- [ ] **Step 2: Wire remaining integrations**

Map all `window.electronAPI` calls that hit sidecar services to `invoke('sidecar_call', ...)`.

- [ ] **Step 3: Test integrations**

Verify Telegram bot connects, Slack bot connects, API server on port 1280 responds.

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "feat: wire frontend to sidecar services via Tauri"
```

---

## Phase 6: SQLite Rust + Platform Polish

### Task 30: Migrate vault to rusqlite

**Files:**
- Create: `src-tauri/src/db.rs`
- Create: `src-tauri/src/commands/vault.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add rusqlite dependency**

```toml
rusqlite = { version = "0.31", features = ["bundled"] }
```

- [ ] **Step 2: Write db.rs**

Port the SQLite operations from `electron/services/vault-db.ts`:
- Create/open database at `~/.dorothy/vault.db`
- Table schema for documents and folders
- CRUD operations
- Full-text search

- [ ] **Step 3: Write commands/vault.rs**

```rust
#[tauri::command]
pub fn vault_list(db: State<'_, VaultDb>, params: serde_json::Value) -> Result<serde_json::Value, String> { ... }

#[tauri::command]
pub fn vault_create(db: State<'_, VaultDb>, params: serde_json::Value) -> Result<serde_json::Value, String> { ... }

#[tauri::command]
pub fn vault_search(db: State<'_, VaultDb>, query: String) -> Result<Vec<serde_json::Value>, String> { ... }
```

- [ ] **Step 4: Remove better-sqlite3 from sidecar**

- [ ] **Step 5: Commit**

```bash
git add src-tauri/
git commit -m "feat: migrate vault from better-sqlite3 to rusqlite"
```

---

### Task 31: macOS tray integration

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Add tray icon**

Copy tray icons from `electron/resources/` to `src-tauri/icons/`.

- [ ] **Step 2: Implement tray menu**

Use Tauri's `tray::TrayIconBuilder` to create a tray icon with a context menu showing agent status.

Conditionally compile for macOS only:
```rust
#[cfg(target_os = "macos")]
fn setup_tray(app: &AppHandle) { ... }
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/
git commit -m "feat: add macOS tray integration"
```

---

### Task 32: Auto-updater

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Add updater plugin**

```toml
tauri-plugin-updater = "2"
```

Configure endpoints in `tauri.conf.json` pointing to GitHub releases (same as current electron-updater setup).

- [ ] **Step 2: Implement update check**

```rust
.plugin(tauri_plugin_updater::Builder::new().build())
```

Frontend: use `@tauri-apps/plugin-updater` to check for updates and show the update dialog (re-enable the ClientLayout update UI from Task 5).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/ src/
git commit -m "feat: add Tauri auto-updater"
```

---

### Task 33: Build and packaging

- [ ] **Step 1: Configure build targets**

In `tauri.conf.json`, configure bundle targets:
- macOS: `.dmg`, `.app`
- Linux: `.AppImage`, `.deb`

- [ ] **Step 2: Build for macOS**

```bash
cargo tauri build
```

Verify the `.dmg` installs and runs correctly.

- [ ] **Step 3: Build for Linux**

```bash
cargo tauri build
```

On Fedora: verify the `.AppImage` runs. Test `.deb` on Ubuntu if available.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/
git commit -m "feat: configure Tauri build for macOS and Linux"
```

---

### Task 34: Final verification — feature parity

- [ ] **Step 1: Feature checklist**

Test each feature against current Dorothy Electron:

| Feature | Status |
|---------|--------|
| Agent create/start/stop/remove | |
| Terminal output streaming | |
| Multi-agent terminals | |
| Mosaic layout (drag, resize, split) | |
| Pop-out console windows | |
| Re-dock console windows | |
| Layout persistence | |
| OS notifications | |
| In-app notifications | |
| Notification → focus correct window | |
| Settings page | |
| Memory browser | |
| Kanban board | |
| Skills marketplace | |
| Vault (knowledge base) | |
| Automations | |
| Recurring tasks | |
| Telegram bot | |
| Slack bot | |
| API server (port 1280) | |
| MCP orchestrator | |
| 3D Agent World | |
| Pallet Town game | |
| Dark mode | |
| macOS tray | |
| Auto-updater | |
| Build macOS .dmg | |
| Build Linux .AppImage | |

- [ ] **Step 2: Fix any remaining issues**

- [ ] **Step 3: Clean up old Electron code**

```bash
rm -rf electron/
```

Update `package.json` to remove any remaining Electron references.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete Dorothy Tauri migration — remove Electron"
```
