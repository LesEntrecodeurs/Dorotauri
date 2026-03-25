# Sidebar Redesign — Notion-Inspired Clean Rewrite

**Date:** 2026-03-25
**Status:** Approved

## Summary

Rewrite the main application sidebar (`src/components/Sidebar.tsx`) from scratch with clean, declarative code and a Notion-inspired visual design. Keep all existing links, logos, features, and shadcn/ui primitives. Add dual collapse modes (icon mode + fully hidden).

## Goals

- Clean, maintainable code with a declarative nav items array
- Notion Classic visual style adapted to Dorothy (warm beige light / dark native)
- Source Code Pro monospace font (keep the geeky feel)
- Two collapse modes: icon mode and fully hidden, with well-placed toggle buttons
- Full light/dark mode support via CSS variables

## Scope

### In scope
- `src/components/Sidebar.tsx` — full rewrite
- `src/app/globals.css` — update sidebar CSS variables to Notion color tokens
- `src/components/ui/sidebar.tsx` — minor extension: support `hidden` state layered on top of existing two-state model
- `src/components/ClientLayout.tsx` — minor update: integrate hidden mode with existing ZenSidebarOverlay pattern

### Out of scope
- Other sidebars (TerminalsView, AgentDialog, Settings)

## Architecture

### Component Structure

```
Sidebar.tsx
├── NAV_ITEMS[] — declarative config array
├── SidebarHeader — logo + collapse buttons (hover-reveal)
├── SidebarContent > SidebarMenu — loop over NAV_ITEMS
└── SidebarFooter
    ├── ConnectionIndicator
    ├── Settings + DarkModeToggle (same line when expanded, stacked in icon mode)
    └── UsageBars (session + week)
```

### NavItem Type

```typescript
interface NavItem {
  label: string
  href: string
  icon: LucideIcon
}
```

Navigation items are defined in a static `NAV_ITEMS` array. Dynamic badges (Vault unread count, Agent notifications, What's New dot) are resolved at render time via existing hooks, not stored in the array.

### Collapse Modes

**Two-layer approach:** The shadcn `SidebarProvider` keeps its existing two-state model (`open: boolean` → `expanded | collapsed` with `collapsible="icon"`). The `hidden` state is layered on top as a separate boolean, managed in `ClientLayout.tsx`, reusing the existing `ZenSidebarOverlay` pattern (8px left-edge trigger strip, translate transition, mouse-leave dismiss).

| State | Implementation | Width | Behavior |
|-------|---------------|-------|----------|
| `expanded` | `open=true` | 13rem (208px) | Full sidebar with labels, badges, usage bars |
| `icons` | `open=false` | 2rem (32px) | Icons only, tooltips on hover. Badges: absolute-positioned dots on icons (not SidebarMenuBadge) |
| `hidden` | separate `sidebarHidden` state | 0px | Fully hidden, reappears as overlay on left-edge hover |

**Persistence:** The existing `sidebar_state` cookie keeps its boolean format for `expanded`/`icons`. A separate `sidebar_hidden` cookie (or localStorage key) stores whether the sidebar is in hidden mode.

**Toggle buttons in header:**
- `PanelLeft` icon → toggle between expanded/icons (replaces shadcn's built-in Cmd+B handler)
- `X` icon → enter hidden mode
- Both buttons appear on **hover of SidebarHeader** (group-hover), Notion-style
- Keyboard shortcuts: `Cmd+B` (toggle expanded/icons — same as current), `Cmd+Shift+B` (toggle hidden mode — new)

**Reopen from hidden:** Hovering the left edge (~8px) shows the sidebar as a floating overlay with subtle `box-shadow`. Uses the existing `ZenSidebarOverlay` component pattern from `ClientLayout.tsx`. Clicking a nav link in overlay mode navigates and then dismisses the overlay. Mouse-leave dismisses.

**Mobile:** unchanged — sheet overlay via existing SidebarProvider.

**Transitions:** 200ms ease-linear (matches shadcn primitive's existing `duration-200 ease-linear`).

**SidebarRail:** Removed — the dual toggle buttons replace the drag-to-resize rail.

**Navigation group label:** Removed — Notion style uses no section headers for the main nav list.

**Zen mode interaction:** When zen mode is active on dashboard, it sets `sidebarHidden=true` via the same mechanism. No duplication of overlay logic.

## Visual Design

### Color Tokens

All values in HSL to match existing `globals.css` format. New tokens `--sidebar-foreground-muted` and `--sidebar-foreground-faint` must be added to the `@theme inline` block as `--color-sidebar-foreground-muted` and `--color-sidebar-foreground-faint`.

| Token | Light | Dark |
|-------|-------|------|
| `--sidebar` | `hsl(40 10% 97%)` | `hsl(0 0% 13%)` |
| `--sidebar-foreground` | `hsl(40 5% 20%)` | `hsl(0 0% 92%)` |
| `--sidebar-foreground-muted` | `hsl(40 3% 44%)` | `hsl(0 0% 48%)` |
| `--sidebar-foreground-faint` | `hsl(40 3% 70%)` | `hsl(0 0% 35%)` |
| `--sidebar-accent` | `hsl(40 5% 93%)` | `hsl(0 0% 100% / 0.07)` |
| `--sidebar-accent-foreground` | `hsl(40 5% 20%)` | `hsl(0 0% 92%)` |
| `--sidebar-border` | `hsl(35 8% 88%)` | `hsl(0 0% 100% / 0.06)` |
| `--sidebar-primary` | `hsl(265 75% 54%)` | `hsl(265 75% 54%)` |
| `--sidebar-primary-foreground` | `hsl(0 0% 100%)` | `hsl(0 0% 100%)` |

Note: `--sidebar-primary` stays at `hsl(265 75% 54%)` — the existing Dorothy purple. No brand color change.

### Typography

- **Font:** Source Code Pro (monospace) — existing project font
- **Nav item size:** ~12.5px
- **Active item:** font-weight 500, foreground color
- **Inactive item:** foreground-muted color, icon opacity 45%
- **Footer text:** foreground-faint color, 9-10px

### Item Styling

- `border-radius: 6px` on all nav items (override shadcn's `--radius: 0rem`)
- `gap-px` (1px) between items (Notion-style tight spacing, override shadcn's `gap-1`)
- Hover: slightly darker background than rest, 150ms transition
- Active: `--sidebar-accent` background, full foreground color, weight 500

### Badges

**Expanded mode:**
- **Vault unread:** red pill (#eb5757), white text, shows count — uses `SidebarMenuBadge`
- **Agent notifications:** orange pill (#f09436), white text, shows count — uses `SidebarMenuBadge`
- **What's New:** red dot (6px), no text

**Icon mode:**
- All three badges render as absolute-positioned 6px dots on the top-right of the icon (not `SidebarMenuBadge`, which is hidden by shadcn in collapsed mode). Colors match expanded mode.

### Header

- Logo: large SVG (`dorotoring-large.svg`) when expanded, icon SVG (`dorotoing.svg`) when collapsed (existing assets)
- Logo uses explicit dark mode colors (no more `dark:invert`)
- Collapse buttons: appear on hover (group-hover), subtle muted color

### Footer

- **Connection indicator:** green pulsing dot + "Connected" text, faint color
- **Settings + Dark mode toggle:** same line when expanded (Settings link left, sun/moon icon right). In icon mode: stacked vertically as individual icon buttons.
- **Usage bars:** 3px height, green (<50%) / yellow (50-80%) / red (>80%), with time remaining labels
- Usage bars and connection indicator text hidden in icon mode

## Existing Functionality Preserved

All 13 navigation links with their routes and icons:
1. `/` — Hub (LayoutDashboard)
2. `/agents` — Agents (Bot)
3. `/kanban` — Kanban (Columns3)
4. `/memory` — Memory (Brain)
5. `/vault` — Vault (Archive)
6. `/skills` — Skills (Sparkles)
7. `/automations` — Automations (Zap)
8. `/plugins` — Plugins (Puzzle)
9. `/projects` — Projects (FolderGit2)
10. `/recurring-tasks` — Recurring Tasks (Clock)
11. `/docker` — Docker (Container)
12. `/usage` — Usage (BarChart3)
13. `/whats-new` — What's New (Megaphone)

Footer: Settings link, dark mode toggle, usage bars (session + week rate limits), connection indicator.
