# Zen-Style Sidebar & Auto-Hide Titlebar

**Date:** 2026-03-25
**Status:** Approved

## Overview

Redesign Dorothy's sidebar and titlebar to match Zen/Arc browser UX: the native titlebar is removed and replaced by a custom hover-revealed bar, and the sidebar header is reorganized with action icons above the logo. The sidebar supports two independent axes — **mode** (full/icons) and **visibility** (visible/hidden) — controlled by dedicated buttons and keyboard shortcuts.

## 1. HoverTitlebar

### Behavior

- A new component `HoverTitlebar` renders a fixed invisible trigger strip (6px) at the top of the screen.
- On `mouseEnter`, a 32px bar slides down with a CSS transition (~200ms).
- On `mouseLeave`, the bar slides back up (with ~200ms delay to prevent flickering).
- Z-index: `z-[200]` — above everything including sidebar overlay.

### Content

- Full-width drag region (`data-tauri-drag-region`).
- Three window control buttons aligned right: minimize, maximize/restore, close.
- Buttons call Tauri window APIs: `getCurrentWindow().minimize()`, `.toggleMaximize()`, `.close()`.

### Platform handling

- **Linux/Windows:** `decorations: false` in `tauri.conf.json`. HoverTitlebar is rendered.
- **macOS:** `titleBarStyle: "overlay"`, `hiddenTitle: true`. HoverTitlebar is NOT rendered (native traffic lights handle window controls). The existing `macos-titlebar` class on `<html>` is used for detection.

### Placement

Rendered in `ClientLayout`, outside and above `SidebarProvider`. Always present regardless of sidebar state.

## 2. Sidebar Header Redesign

### Layout

```
┌─────────────────────────────┐
│ [Hide ◫]          [Mode ⊞] │  ← action icons row
│ 🐾 Dorothy                 │  ← logo below
├─────────────────────────────┤
│ Navigation items...         │
```

### Hide button (left)

- Icon: `PanelLeftClose` when sidebar is visible, `PanelLeft` when in overlay (hidden) mode.
- Visible mode: click sets `sidebarHidden = true` → sidebar disappears.
- Overlay mode: acts as "Pin" — click sets `sidebarHidden = false` → sidebar becomes persistent again.

### Mode toggle button (right)

- Toggles between `full` (text + icons) and `icons` (icons only).
- Icon changes based on current mode: `Columns2` when full (suggests "go to icons"), `Columns3` or `LayoutGrid` when icons (suggests "go to full").
- Preference persisted in `localStorage` key `sidebar_mode` (`"full"` | `"icons"`).

### Logo

- Positioned below the action icons row.
- Full logo (`dorotoring-large.svg`) in full mode, small icon (`dorotoing.svg`) in icons mode.

## 3. State Model

### Two independent axes

| Axis | Values | Persistence | Key |
|------|--------|-------------|-----|
| **Mode** | `full` / `icons` | localStorage | `sidebar_mode` |
| **Visibility** | `visible` / `hidden` | localStorage | `sidebar_hidden` |

### Transitions

```
         Mode toggle button
    full ◄──────────────────► icons
     │                          │
     │   Hide button / F11      │
     ▼                          ▼
   hidden                    hidden
     │                          │
     │   Hover left edge        │
     ▼                          ▼
  overlay(full)           overlay(icons)
     │                          │
     │   Pin button / F11       │
     ▼                          ▼
    full                      icons
```

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+B` | Toggle visibility (visible ↔ hidden). Does not change mode. |
| `F11` | Toggle visibility (identical to Cmd/Ctrl+B). |

Mode toggle has no keyboard shortcut — button only.

## 4. Overlay Sidebar

When `sidebarHidden = true`:

- An invisible trigger strip (6px) on the left edge reveals the sidebar overlay on hover.
- The overlay renders in the **saved mode** (full or icons).
- The overlay dismisses on mouse leave or after clicking a nav link.
- The Hide button becomes a Pin button (`PanelLeft`) — clicking it sets `sidebarHidden = false`.

## 5. Technical Changes

### New files

| File | Purpose |
|------|---------|
| `src/components/HoverTitlebar.tsx` | Custom auto-hide titlebar with window controls |

### Modified files

| File | Change |
|------|--------|
| `src-tauri/tauri.conf.json` | `decorations: false` (Linux/Windows), macOS overlay config |
| `src/components/ClientLayout.tsx` | Add HoverTitlebar, manage `sidebarMode` state, remove `SidebarKeyboardCycler`, remove `SidebarTrigger`, simplify Cmd+B to toggle hidden only |
| `src/components/Sidebar.tsx` | New header layout (hide + mode toggle + logo below), accept `sidebarMode` and `onToggleMode` props |
| `src/components/ui/sidebar.tsx` | Remove unused `SIDEBAR_KEYBOARD_SHORTCUT` constant |
| `src/globals.css` | Set `--titlebar-inset: 0px` for Linux (no native titlebar), keep macOS value |
| `src/main.tsx` | Platform detection for HoverTitlebar rendering |

### Removed

- `SidebarKeyboardCycler` component (replaced by simple toggle in ClientLayout).
- `SidebarTrigger` floating button (redundant with overlay hover).
- Three-state Cmd+B cycle (replaced by simple visible/hidden toggle).
- `Cmd+Shift+B` shortcut (redundant — Cmd+B now does the same thing).

### State in ClientLayout

```typescript
const [sidebarHidden, setSidebarHidden] = useState(() =>
  localStorage.getItem('sidebar_hidden') === 'true'
);
const [sidebarMode, setSidebarMode] = useState<'full' | 'icons'>(() =>
  (localStorage.getItem('sidebar_mode') as 'full' | 'icons') || 'full'
);
```

### SidebarProvider integration

The existing shadcn `Sidebar` component with `collapsible="icon"` is reused:
- Mode `full`: SidebarProvider `open={true}` (expanded).
- Mode `icons`: SidebarProvider `open={false}` (collapsed).
- The `open` prop is controlled by `sidebarMode`, not by internal toggle.

### Tauri window API

```typescript
import { getCurrentWindow } from '@tauri-apps/api/window';

const win = getCurrentWindow();
await win.minimize();
await win.toggleMaximize();
await win.close();
```
