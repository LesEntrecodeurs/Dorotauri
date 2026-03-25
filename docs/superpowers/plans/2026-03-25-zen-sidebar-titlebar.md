# Zen-Style Sidebar & Auto-Hide Titlebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the native titlebar with a hover-revealed custom one, and redesign the sidebar header with two independent controls (hide/show + full/icons mode toggle).

**Architecture:** Two independent axes (visibility: visible/hidden, mode: full/icons) managed via localStorage in ClientLayout. A new HoverTitlebar component provides window controls on Linux/Windows. The existing shadcn Sidebar's `collapsible="icon"` mechanism is reused — `open` is controlled by `sidebarMode`.

**Tech Stack:** React, Tauri 2 (`@tauri-apps/api/window`), shadcn/ui Sidebar, Tailwind CSS, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-03-25-zen-sidebar-titlebar-design.md`

---

### Task 1: Tauri Config — Remove Native Decorations

**Files:**
- Modify: `src-tauri/tauri.conf.json:14-24`

- [ ] **Step 1: Update window config**

In `src-tauri/tauri.conf.json`, replace the windows config:

```json
"windows": [
  {
    "title": "Dorotoring",
    "width": 1200,
    "height": 800,
    "minWidth": 800,
    "minHeight": 600,
    "decorations": false,
    "titleBarStyle": "Visible",
    "backgroundColor": "#F8F5FC"
  }
]
```

Key change: `"decorations": false`. We keep `titleBarStyle: "Visible"` for now — macOS overlay support will be a follow-up if needed since the current user is on Linux.

- [ ] **Step 2: Verify the app launches without native titlebar**

Run: `npm run tauri dev`

Expected: The app window appears without OS window chrome (no title bar, no close/min/max buttons). The window should still be resizable by dragging edges (Tauri handles this automatically even with `decorations: false`).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat: remove native window decorations for Zen-style titlebar"
```

---

### Task 2: Create HoverTitlebar Component

**Files:**
- Create: `src/components/HoverTitlebar.tsx`

- [ ] **Step 1: Create the HoverTitlebar component**

Create `src/components/HoverTitlebar.tsx`:

```tsx
import { useState, useCallback, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X } from 'lucide-react';

const appWindow = getCurrentWindow();

export default function HoverTitlebar() {
  const [visible, setVisible] = useState(false);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    if (hideTimeout.current) {
      clearTimeout(hideTimeout.current);
      hideTimeout.current = null;
    }
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    hideTimeout.current = setTimeout(() => setVisible(false), 200);
  }, []);

  return (
    <>
      {/* Invisible trigger strip at top edge */}
      <div
        className="fixed top-0 left-0 right-0 h-1.5 z-[200]"
        onMouseEnter={show}
      />
      {/* Titlebar */}
      <div
        className={`fixed top-0 left-0 right-0 h-8 z-[200] flex items-center transition-transform duration-200 ease-out ${
          visible ? 'translate-y-0' : '-translate-y-full'
        }`}
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        {/* Drag region — fills entire bar */}
        <div
          className="absolute inset-0 window-drag-region"
          data-tauri-drag-region
        />
        {/* Window controls — right-aligned, above drag region */}
        <div className="ml-auto flex items-center relative z-10">
          <button
            onClick={() => appWindow.minimize()}
            className="h-8 w-11 flex items-center justify-center text-foreground/60 hover:bg-foreground/10 hover:text-foreground transition-colors"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => appWindow.toggleMaximize()}
            className="h-8 w-11 flex items-center justify-center text-foreground/60 hover:bg-foreground/10 hover:text-foreground transition-colors"
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            onClick={() => appWindow.close()}
            className="h-8 w-11 flex items-center justify-center text-foreground/60 hover:bg-red-500/80 hover:text-white transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep -i HoverTitlebar`

Expected: No errors related to HoverTitlebar.

- [ ] **Step 3: Commit**

```bash
git add src/components/HoverTitlebar.tsx
git commit -m "feat: add HoverTitlebar component with auto-hide window controls"
```

---

### Task 3: Integrate HoverTitlebar into ClientLayout

**Files:**
- Modify: `src/components/ClientLayout.tsx:1-10,149-189`

- [ ] **Step 1: Add HoverTitlebar to ClientLayout**

In `src/components/ClientLayout.tsx`, add the import at the top (after the other imports):

```typescript
import HoverTitlebar from './HoverTitlebar';
```

Then add a platform check constant after the imports:

```typescript
const isMacOS = document.documentElement.classList.contains('macos-titlebar');
```

Then render HoverTitlebar above the SidebarProvider in the return JSX. Replace the entire return block (from `return (` to the closing `);`):

```tsx
  return (
    <>
      {!isMacOS && <HoverTitlebar />}
      <SidebarProvider
        key={showOverlay ? 'overlay' : 'normal'}
        defaultOpen={!showOverlay}
      >
        <SidebarKeyboardCycler sidebarHidden={sidebarHidden} setSidebarHidden={setSidebarHidden} />
        {showOverlay ? (
          <SidebarOverlay>
            <AppSidebar sidebarHidden={sidebarHidden} />
          </SidebarOverlay>
        ) : (
          <AppSidebar sidebarHidden={sidebarHidden} />
        )}
        <SidebarInset className="h-svh overflow-hidden relative">
          {/* Floating sidebar toggle — always accessible */}
          <SidebarTrigger className="absolute top-2 left-2 z-40 opacity-30 hover:opacity-100 transition-opacity" />
          <main className="flex-1 overflow-auto h-full">
            {/* Persistent terminal layer — always mounted, hidden when not on dashboard */}
            <div
              style={{ display: isOnDashboard ? 'flex' : 'none' }}
              className="h-svh flex-col"
            >
              <Suspense fallback={null}>
                <MosaicTerminalView agents={agents} zenMode={sidebarHidden} createAgent={createAgent} updateAgent={updateAgent} />
              </Suspense>
            </div>

            {/* Route content — shown when NOT on dashboard */}
            {!isOnDashboard && (
              <div className="p-4 lg:p-6 pb-6" style={{ paddingTop: 'calc(var(--titlebar-inset) + 1rem)' }}>
                <Outlet />
              </div>
            )}
          </main>
        </SidebarInset>
        <NotificationToast />
      </SidebarProvider>
    </>
  );
```

- [ ] **Step 2: Verify the titlebar appears on hover**

Run: `npm run tauri dev`

Expected: Moving the mouse to the very top of the screen reveals a bar with minimize/maximize/close buttons. The bar hides when the mouse leaves. The buttons work (minimize minimizes, maximize toggles, close closes). Dragging the bar moves the window.

- [ ] **Step 3: Commit**

```bash
git add src/components/ClientLayout.tsx
git commit -m "feat: integrate HoverTitlebar into ClientLayout for Linux/Windows"
```

---

### Task 4: Add sidebarMode State to ClientLayout

**Files:**
- Modify: `src/components/ClientLayout.tsx`

This task adds the `sidebarMode` state (the second axis) and rewires `SidebarProvider` to be controlled by it. It also simplifies the keyboard handler and removes old components.

- [ ] **Step 1: Simplify SidebarOverlay — remove setOpen call**

The `SidebarOverlay` currently calls `setOpen(show)` to expand/collapse the sidebar on hover. With controlled `open` from `sidebarMode`, this would conflict. The overlay only needs to control CSS visibility (translate-x). The sidebar content (full vs icons) is determined by `sidebarMode`.

In `src/components/ClientLayout.tsx`, replace the `SidebarOverlay` component:

```tsx
/** Overlay sidebar — slides in from left edge on hover, dismisses on mouse leave or nav click */
function SidebarOverlay({ children }: { children: React.ReactNode }) {
  const [show, setShow] = useState(false);

  return (
    <>
      {/* Invisible trigger strip on left edge */}
      <div
        className="fixed left-0 top-0 h-full w-1.5 z-50"
        onMouseEnter={() => setShow(true)}
      />
      {/* Overlay sidebar */}
      <div
        className={`fixed left-0 top-0 h-svh z-50 shadow-2xl transition-transform duration-200 ease-out ${
          show ? 'translate-x-0' : '-translate-x-full pointer-events-none'
        }`}
        onMouseLeave={() => setShow(false)}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a')) {
            setTimeout(() => setShow(false), 150);
          }
        }}
      >
        {children}
      </div>
    </>
  );
}
```

Key change: removed `useSidebar()` hook and `setOpen(show)` effect. The overlay now only controls CSS visibility.

- [ ] **Step 2: Delete SidebarKeyboardCycler and add sidebarMode**

Delete the entire `SidebarKeyboardCycler` component (lines 12-38).

Then, inside the `ClientLayout` function, after the `sidebarHidden` state and its effects, add `sidebarMode` state:

```typescript
  // --- Sidebar mode (persisted) ---
  const [sidebarMode, setSidebarMode] = useState<'full' | 'icons'>(() => {
    return (localStorage.getItem('sidebar_mode') as 'full' | 'icons') || 'full';
  });

  // Persist mode
  useEffect(() => {
    localStorage.setItem('sidebar_mode', sidebarMode);
  }, [sidebarMode]);

  const toggleMode = useCallback(() => {
    setSidebarMode(prev => prev === 'full' ? 'icons' : 'full');
  }, []);
```

- [ ] **Step 3: Simplify keyboard handlers**

Replace the F11 handler and add a unified Cmd/Ctrl+B handler. Remove the `sidebar-toggle-hidden` event listener (will be replaced with direct props). Replace the three effects (sidebar-toggle-hidden listener, F11 handler) with:

```typescript
  // Cmd/Ctrl+B and F11: toggle sidebar visibility
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'F11') {
        e.preventDefault();
        e.stopPropagation();
        setSidebarHidden(prev => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.code === 'KeyB') {
        e.preventDefault();
        e.stopPropagation();
        setSidebarHidden(prev => !prev);
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);
```

Remove the `toggleHidden` callback (no longer needed).

- [ ] **Step 4: Rewire SidebarProvider and remove SidebarTrigger**

Update the return JSX. The `SidebarProvider` now uses controlled `open` prop based on `sidebarMode`. Remove `SidebarKeyboardCycler` and `SidebarTrigger`. Pass new props to `AppSidebar`:

```tsx
  const sidebarOpen = sidebarMode === 'full';

  return (
    <>
      {!isMacOS && <HoverTitlebar />}
      <SidebarProvider
        key={showOverlay ? 'overlay' : 'normal'}
        open={sidebarOpen}
        onOpenChange={(open) => setSidebarMode(open ? 'full' : 'icons')}
      >
        {showOverlay ? (
          <SidebarOverlay>
            <AppSidebar
              sidebarHidden={sidebarHidden}
              onToggleHidden={() => setSidebarHidden(prev => !prev)}
              sidebarMode={sidebarMode}
              onToggleMode={toggleMode}
            />
          </SidebarOverlay>
        ) : (
          <AppSidebar
            sidebarHidden={sidebarHidden}
            onToggleHidden={() => setSidebarHidden(prev => !prev)}
            sidebarMode={sidebarMode}
            onToggleMode={toggleMode}
          />
        )}
        <SidebarInset className="h-svh overflow-hidden relative">
          <main className="flex-1 overflow-auto h-full">
            <div
              style={{ display: isOnDashboard ? 'flex' : 'none' }}
              className="h-svh flex-col"
            >
              <Suspense fallback={null}>
                <MosaicTerminalView agents={agents} zenMode={sidebarHidden} createAgent={createAgent} updateAgent={updateAgent} />
              </Suspense>
            </div>
            {!isOnDashboard && (
              <div className="p-4 lg:p-6 pb-6" style={{ paddingTop: 'calc(var(--titlebar-inset) + 1rem)' }}>
                <Outlet />
              </div>
            )}
          </main>
        </SidebarInset>
        <NotificationToast />
      </SidebarProvider>
    </>
  );
```

- [ ] **Step 5: Clean up imports**

In `ClientLayout.tsx`, update the imports:
- Remove `SidebarTrigger` and `useSidebar` from the ui/sidebar import (keep `SidebarProvider`, `SidebarInset`).
- Keep `useCallback` (still used for `toggleMode`).

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep -v vault-handlers | head -5`

Expected: No new errors (AppSidebar props don't match yet — that's fixed in the next task).

- [ ] **Step 7: Commit**

```bash
git add src/components/ClientLayout.tsx
git commit -m "feat: add sidebarMode state, simplify keyboard handlers, remove SidebarTrigger"
```

---

### Task 5: Redesign Sidebar Header

**Files:**
- Modify: `src/components/Sidebar.tsx:1-21,238-294`

- [ ] **Step 1: Update imports**

Replace the imports at the top of `src/components/Sidebar.tsx`:

```typescript
import {
  LayoutDashboard,
  Bot,
  Columns3,
  Brain,
  Archive,
  Sparkles,
  Zap,
  Puzzle,
  FolderGit2,
  Clock,
  BarChart3,
  Megaphone,
  Settings,
  Moon,
  Sun,
  PanelLeft,
  PanelLeftClose,
  Columns2,
  Container,
  type LucideIcon,
} from 'lucide-react';
```

Changes: removed unused icons, added `Columns2` for mode toggle.

- [ ] **Step 2: Update component signature and header**

Replace the `AppSidebar` component definition and its header section (from `export default function AppSidebar` through `</SidebarHeader>`):

```tsx
interface AppSidebarProps {
  sidebarHidden?: boolean;
  onToggleHidden?: () => void;
  sidebarMode?: 'full' | 'icons';
  onToggleMode?: () => void;
}

export default function AppSidebar({
  sidebarHidden = false,
  onToggleHidden,
  sidebarMode = 'full',
  onToggleMode,
}: AppSidebarProps) {
  const pathname = useLocation().pathname;
  const { darkMode, toggleDarkMode } = useStore();

  return (
    <Sidebar collapsible="icon">
      {/* Header: action icons row + logo below */}
      <SidebarHeader className="group-data-[collapsible=icon]/sidebar:p-1">
        {/* Action icons row */}
        <div className="flex items-center justify-between px-2 pt-1 group-data-[collapsible=icon]/sidebar:px-0 group-data-[collapsible=icon]/sidebar:justify-center">
          {/* Hide / Pin button */}
          <button
            onClick={onToggleHidden}
            className="p-1 rounded-[6px] text-sidebar-foreground-muted hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors opacity-60 hover:opacity-100"
            title={sidebarHidden ? 'Pin sidebar (⌘B)' : 'Hide sidebar (⌘B)'}
          >
            {sidebarHidden ? <PanelLeft className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
          </button>
          {/* Mode toggle — hidden in icon mode */}
          <button
            onClick={onToggleMode}
            className="p-1 rounded-[6px] text-sidebar-foreground-muted hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors opacity-60 hover:opacity-100 group-data-[collapsible=icon]/sidebar:hidden"
            title={sidebarMode === 'full' ? 'Icon mode' : 'Full menu'}
          >
            <Columns2 className="w-3.5 h-3.5" />
          </button>
        </div>
        {/* Logo below action icons */}
        <div className="flex items-center px-2 py-1 group-data-[collapsible=icon]/sidebar:px-0 group-data-[collapsible=icon]/sidebar:justify-center">
          <img
            src="/dorotoring-large.svg"
            alt="Dorothy"
            className="h-5 w-auto dark:invert group-data-[collapsible=icon]/sidebar:hidden"
          />
          <img
            src="/dorotoing.svg"
            alt="Dorothy"
            className="w-5 h-5 dark:invert hidden group-data-[collapsible=icon]/sidebar:block"
          />
        </div>
      </SidebarHeader>
```

Key changes:
- Action icons row at top with hide (left) and mode toggle (right).
- Logo moved below the action icons row.
- `handleCycleState` removed — replaced by direct `onToggleHidden` and `onToggleMode` callbacks.
- `useSidebar()` and `toggleSidebar` removed from this component (no longer needed).
- Mode toggle hidden in icon mode via `group-data-[collapsible=icon]/sidebar:hidden`.

- [ ] **Step 3: Verify it compiles and renders**

Run: `npx tsc --noEmit 2>&1 | grep -v vault-handlers | head -5`

Expected: No new errors.

Run: `npm run tauri dev`

Expected: Sidebar header shows two icons at the top row, logo below. Clicking the left icon hides the sidebar. Clicking the right icon switches between full and icon mode.

- [ ] **Step 4: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: redesign sidebar header with hide/mode buttons above logo"
```

---

### Task 6: Compact Usage Stats in Icon Mode

**Files:**
- Modify: `src/components/Sidebar.tsx` (UsageBars component)

Currently `UsageBars` is fully hidden in icon mode (`group-data-[collapsible=icon]/sidebar:hidden`). This task adds a compact percentage display visible in icon mode, with a tooltip showing full details on hover.

- [ ] **Step 1: Add tooltip import to Sidebar.tsx**

Add to the existing imports from `@/components/ui/sidebar`:

```typescript
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuBadge,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from '@/components/ui/sidebar';
```

Add a new import for the tooltip:

```typescript
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
```

Note: `TooltipProvider` is already provided by `SidebarProvider` in `ui/sidebar.tsx`, so no need to wrap again.

- [ ] **Step 2: Replace UsageBars with a dual-mode component**

Replace the entire `UsageBars` function with:

```tsx
function UsageBars() {
  const rateLimits = useStore((s) => s.rateLimits);
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  if (!rateLimits) return null;
  const { fiveHour, sevenDay } = rateLimits;
  if (!fiveHour && !sevenDay) return null;

  // --- Icon mode: compact stacked percentages with tooltip ---
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex flex-col items-center gap-0.5 py-1.5 cursor-default">
            {fiveHour && (
              <span className={`text-[9px] font-medium ${barTextColor(fiveHour.usedPercentage)}`}>
                {Math.round(fiveHour.usedPercentage)}%
              </span>
            )}
            {sevenDay && (
              <span className={`text-[9px] font-medium ${barTextColor(sevenDay.usedPercentage)}`}>
                {Math.round(sevenDay.usedPercentage)}%
              </span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="right" className="p-3 space-y-2 w-48">
          {fiveHour && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">Session 5h</span>
                <span className="text-xs font-medium">
                  {Math.round(fiveHour.usedPercentage)}% · {formatSessionReset(fiveHour.resetsAt)}
                </span>
              </div>
              <div className={`h-1.5 w-full rounded-full overflow-hidden ${barTrackColor(fiveHour.usedPercentage)}`}>
                <div
                  className={`h-full rounded-full ${barColor(fiveHour.usedPercentage)}`}
                  style={{ width: `${Math.min(100, fiveHour.usedPercentage)}%` }}
                />
              </div>
            </div>
          )}
          {sevenDay && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">Week</span>
                <span className="text-xs font-medium">
                  {Math.round(sevenDay.usedPercentage)}% · {formatWeekReset(sevenDay.resetsAt)}
                </span>
              </div>
              <div className={`h-1.5 w-full rounded-full overflow-hidden ${barTrackColor(sevenDay.usedPercentage)}`}>
                <div
                  className={`h-full rounded-full ${barColor(sevenDay.usedPercentage)}`}
                  style={{ width: `${Math.min(100, sevenDay.usedPercentage)}%` }}
                />
              </div>
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  // --- Full mode: inline bars (existing layout) ---
  return (
    <div className="px-2 py-1.5 space-y-1.5 border-t border-sidebar-border pt-2">
      {fiveHour && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] text-sidebar-foreground-faint">Session 5h</span>
            <span className="text-[9px] text-sidebar-foreground-faint">
              {Math.round(fiveHour.usedPercentage)}% · {formatSessionReset(fiveHour.resetsAt)}
            </span>
          </div>
          <div className={`h-[3px] w-full rounded-full overflow-hidden ${barTrackColor(fiveHour.usedPercentage)}`}>
            <div
              className={`h-full rounded-full transition-all ${barColor(fiveHour.usedPercentage)}`}
              style={{ width: `${Math.min(100, fiveHour.usedPercentage)}%` }}
            />
          </div>
        </div>
      )}
      {sevenDay && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] text-sidebar-foreground-faint">Week</span>
            <span className="text-[9px] text-sidebar-foreground-faint">
              {Math.round(sevenDay.usedPercentage)}% · {formatWeekReset(sevenDay.resetsAt)}
            </span>
          </div>
          <div className={`h-[3px] w-full rounded-full overflow-hidden ${barTrackColor(sevenDay.usedPercentage)}`}>
            <div
              className={`h-full rounded-full transition-all ${barColor(sevenDay.usedPercentage)}`}
              style={{ width: `${Math.min(100, sevenDay.usedPercentage)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add the barTextColor helper**

Add this helper function next to the existing `barColor` and `barTrackColor` functions:

```typescript
function barTextColor(pct: number): string {
  if (pct >= 80) return 'text-red-500';
  if (pct >= 50) return 'text-yellow-500';
  return 'text-sidebar-foreground-faint';
}
```

- [ ] **Step 4: Verify it compiles and renders**

Run: `npx tsc --noEmit 2>&1 | grep -v vault-handlers | head -5`

Expected: No new errors.

Run: `npm run tauri dev`

Expected: In full mode, usage bars look the same as before. In icon mode, two small colored percentages appear stacked at the bottom. Hovering them shows a tooltip with full bars, percentages, and reset times.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: show compact usage stats in icon mode with hover tooltip"
```

---

### Task 7: Clean up ui/sidebar.tsx and CSS

**Files:**
- Modify: `src/components/ui/sidebar.tsx:31`
- Modify: `src/globals.css:236-242`
- Modify: `src/components/MosaicTerminalView/index.tsx:725`

- [ ] **Step 1: Remove unused SIDEBAR_KEYBOARD_SHORTCUT**

In `src/components/ui/sidebar.tsx`, delete line 31:

```typescript
const SIDEBAR_KEYBOARD_SHORTCUT = "KeyB"
```

- [ ] **Step 2: Update CSS titlebar inset**

In `src/globals.css`, the current CSS is already correct — `--titlebar-inset: 0px` by default, `2rem` for macOS. No changes needed since `decorations: false` on Linux means no native titlebar, and `0px` is the right default.

- [ ] **Step 3: Remove the titlebar spacer from MosaicTerminalView**

In `src/components/MosaicTerminalView/index.tsx`, find and delete the titlebar spacer div (around line 725):

```tsx
      {/* macOS traffic light spacer + drag region */}
      <div className="shrink-0 bg-secondary/80 window-drag-region" style={{ height: 'var(--titlebar-inset)' }} data-tauri-drag-region />
```

This spacer was for the native titlebar. On Linux there's no titlebar now (HoverTitlebar is floating/fixed). On macOS `--titlebar-inset` is still 0px since we're not using overlay titlebar there yet.

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep -v vault-handlers | head -5`

Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/sidebar.tsx src/globals.css src/components/MosaicTerminalView/index.tsx
git commit -m "chore: remove unused sidebar keyboard constant and titlebar spacer"
```

---

### Task 8: Verify Full Integration

**Files:** None (manual testing only)

- [ ] **Step 1: Test sidebar mode toggle**

Run: `npm run tauri dev`

1. Click the right button (Columns2) in sidebar header → sidebar collapses to icon mode.
2. Click again → sidebar expands to full mode.
3. Reload the app → mode persists (check localStorage `sidebar_mode`).

- [ ] **Step 2: Test sidebar hide/show**

1. Click the left button (PanelLeftClose) → sidebar disappears completely.
2. Move mouse to left edge → sidebar overlay appears (in the saved mode).
3. In overlay, click the Pin button (PanelLeft) → sidebar becomes persistent again.
4. Press `Cmd/Ctrl+B` → sidebar hides.
5. Press `Cmd/Ctrl+B` again → sidebar shows.
6. Press `F11` → sidebar hides.
7. Press `F11` again → sidebar shows.
8. Reload → hidden state persists.

- [ ] **Step 3: Test hover titlebar**

1. Move mouse to top edge of screen → titlebar slides down with minimize/maximize/close buttons.
2. Click minimize → window minimizes.
3. Click maximize → window toggles maximized/restored.
4. Drag the titlebar → window moves.
5. Move mouse away → titlebar slides up and disappears.

- [ ] **Step 4: Test overlay respects mode**

1. Set mode to icons, then hide the sidebar.
2. Hover left edge → overlay appears in icon mode.
3. Pin the sidebar, set mode to full, hide again.
4. Hover left edge → overlay appears in full mode.

- [ ] **Step 5: Test edge cases**

1. Navigate to different pages (Hub, Agents, Settings) → sidebar hide/show works on all screens.
2. While sidebar is hidden on Hub, terminal panel `Ctrl+Shift+F` still works for terminal fullscreen.
3. Dark mode toggle in sidebar footer still works.
4. Window resize is still possible by dragging window edges.
