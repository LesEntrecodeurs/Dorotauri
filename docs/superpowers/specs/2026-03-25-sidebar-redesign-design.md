# Sidebar Redesign — Notion-Inspired Clean Rewrite

**Date:** 2026-03-25
**Status:** Draft

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

### Out of scope
- `src/components/ui/sidebar.tsx` — shadcn primitives stay untouched
- `src/components/ClientLayout.tsx` — SidebarProvider stays as-is
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
    ├── Settings + DarkModeToggle (same line)
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

Three sidebar states persisted in cookie `sidebar_state`:

| State | Width | Behavior |
|-------|-------|----------|
| `expanded` | ~220px | Full sidebar with labels, badges, usage bars |
| `icons` | ~48px | Icons only, tooltips on hover, dot badges visible |
| `hidden` | 0px | Fully hidden, reappears as overlay on left-edge hover (~8px zone) |

**Toggle buttons in header:**
- `PanelLeft` icon → collapse to icon mode
- `X` icon → hide completely
- Both buttons appear on **hover of SidebarHeader** (group-hover), Notion-style
- Keyboard shortcuts: `Cmd+B` (icon mode), `Cmd+Shift+B` (hidden mode)

**Reopen from hidden:** hovering the left edge (~8px) shows the sidebar as a floating overlay with a subtle box-shadow.

**Mobile:** unchanged — sheet overlay via existing SidebarProvider.

**Transitions:** 200ms ease-out on width.

## Visual Design

### Color Tokens

| Token | Light | Dark |
|-------|-------|------|
| `--sidebar` | `#f7f7f5` | `#202020` |
| `--sidebar-foreground` | `#37352f` | `#ebebeb` |
| `--sidebar-foreground-muted` | `#73726e` | `#7a7a7a` |
| `--sidebar-foreground-faint` | `#b4b4b0` | `#5a5a5a` |
| `--sidebar-accent` | `#ededeb` | `rgba(255,255,255,0.07)` |
| `--sidebar-border` | `#e8e5e0` | `rgba(255,255,255,0.06)` |
| `--sidebar-primary` | `#7c5cbf` | `#7c5cbf` |

### Typography

- **Font:** Source Code Pro (monospace) — existing project font
- **Nav item size:** ~12.5px
- **Active item:** font-weight 500, foreground color
- **Inactive item:** foreground-muted color, icon opacity 45%
- **Footer text:** foreground-faint color, 9-10px

### Item Styling

- `border-radius: 6px` on all nav items
- `gap: 1px` between items (tight Notion-style spacing)
- Hover: slightly darker background than rest, 150ms transition
- Active: `--sidebar-accent` background, full foreground color, weight 500

### Badges

- **Vault unread:** red pill (#eb5757), white text, shows count
- **Agent notifications:** orange pill (#f09436), white text, shows count
- **What's New:** red dot (6px), no text

### Header

- Logo: large SVG when expanded, icon SVG when collapsed (existing assets)
- Logo uses explicit dark mode colors (no more `dark:invert`)
- Collapse buttons: appear on hover (group-hover), subtle muted color

### Footer

- **Connection indicator:** green pulsing dot + "Connected" text, faint color
- **Settings + Dark mode toggle:** same line — Settings link left, sun/moon icon right
- **Usage bars:** 3px height, green (<50%) / yellow (50-80%) / red (>80%), with time remaining labels
- Usage bars and connection indicator hidden in icon mode

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

Zen mode (F11) interaction: when zen mode is active on dashboard, sidebar defaults to hidden mode.
