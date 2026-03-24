# Dorothy — shadcn/ui Violet Reskin

**Date:** 2026-03-24
**Branch:** feat/tauri-rewrite
**Scope:** Visual reskin only — no logic, state, or behavior changes

## Goal

Migrate Dorothy's frontend from custom-styled components to shadcn/ui with a violet theme based on #7A33E0. Remove the 3D Game (AgentWorld) and Pokemon Game (PalletTown) views. Make the app look professional with sharp corners (radius: 0rem) and a dev-tool aesthetic.

## Theme

### Primary Color

Base violet: `#7A33E0` → `hsl(265, 75%, 54%)`

### Fonts

- `--font-sans`: `'Source Code Pro'` (dev-tool monospace look as the main font)
- `--font-mono`: `'Source Code Pro'`
- `--font-serif`: `'Source Serif 4'`

Replaces the current Geist Sans / Geist Mono / DM Serif Display stack. Remove all DM Serif Display imports and heading font rules from globals.css.

Font values are assigned in `:root` alongside the other variables:

```css
:root {
  --font-sans: 'Source Code Pro', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --font-serif: 'Source Serif 4', ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif;
  --font-mono: 'Source Code Pro', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
```

### Radius

`--radius: 0rem` — all components render with sharp corners.

### Light Mode Variables

```css
:root {
  --background: hsl(260 20% 98%);
  --foreground: hsl(260 30% 8%);
  --card: hsl(0 0% 100%);
  --card-foreground: hsl(260 30% 8%);
  --popover: hsl(0 0% 100%);
  --popover-foreground: hsl(260 30% 8%);
  --primary: hsl(265 75% 54%);
  --primary-foreground: hsl(0 0% 100%);
  --secondary: hsl(260 15% 93%);
  --secondary-foreground: hsl(260 30% 8%);
  --muted: hsl(260 10% 92%);
  --muted-foreground: hsl(260 10% 40%);
  --accent: hsl(260 15% 93%);
  --accent-foreground: hsl(260 30% 8%);
  --destructive: hsl(0 84% 60%);
  --destructive-foreground: hsl(0 0% 100%);
  --border: hsl(260 10% 85%);
  --input: hsl(260 10% 85%);
  --ring: hsl(265 75% 54%);
  --radius: 0rem;
}
```

### Dark Mode Variables

```css
.dark {
  --background: hsl(260 30% 8%);
  --foreground: hsl(260 15% 88%);
  --card: hsl(260 25% 12%);
  --card-foreground: hsl(260 15% 88%);
  --popover: hsl(260 25% 12%);
  --popover-foreground: hsl(260 15% 88%);
  --primary: hsl(265 75% 54%);
  --primary-foreground: hsl(0 0% 100%);
  --secondary: hsl(260 23% 18%);
  --secondary-foreground: hsl(260 15% 88%);
  --muted: hsl(260 23% 18%);
  --muted-foreground: hsl(260 10% 55%);
  --accent: hsl(260 23% 18%);
  --accent-foreground: hsl(260 15% 88%);
  --destructive: hsl(0 84% 60%);
  --destructive-foreground: hsl(0 0% 100%);
  --border: hsl(260 15% 88% / 0.15);
  --input: hsl(260 15% 88% / 0.2);
  --ring: hsl(265 75% 54%);
}
```

### Shadows (consistent with theme)

```css
:root {
  --shadow-2xs: 0px 1px 2px 0px hsl(265 50% 30% / 0.03);
  --shadow-xs: 0px 1px 2px 0px hsl(265 50% 30% / 0.03);
  --shadow-sm: 0px 1px 2px 0px hsl(265 50% 30% / 0.06), 0px 1px 2px -1px hsl(265 50% 30% / 0.06);
  --shadow: 0px 1px 2px 0px hsl(265 50% 30% / 0.06), 0px 1px 2px -1px hsl(265 50% 30% / 0.06);
  --shadow-md: 0px 1px 2px 0px hsl(265 50% 30% / 0.06), 0px 2px 4px -1px hsl(265 50% 30% / 0.06);
  --shadow-lg: 0px 1px 2px 0px hsl(265 50% 30% / 0.06), 0px 4px 6px -1px hsl(265 50% 30% / 0.06);
  --shadow-xl: 0px 1px 2px 0px hsl(265 50% 30% / 0.06), 0px 8px 10px -1px hsl(265 50% 30% / 0.06);
  --shadow-2xl: 0px 1px 2px 0px hsl(265 50% 30% / 0.15);
}

.dark {
  --shadow-2xs: 0px 1px 2px 0px hsl(0 0% 0% / 0.01);
  --shadow-xs: 0px 1px 2px 0px hsl(0 0% 0% / 0.01);
  --shadow-sm: 0px 1px 2px 0px hsl(0 0% 0% / 0.01), 0px 1px 2px -1px hsl(0 0% 0% / 0.01);
  --shadow: 0px 1px 2px 0px hsl(0 0% 0% / 0.01), 0px 1px 2px -1px hsl(0 0% 0% / 0.01);
  --shadow-md: 0px 1px 2px 0px hsl(0 0% 0% / 0.01), 0px 2px 4px -1px hsl(0 0% 0% / 0.01);
  --shadow-lg: 0px 1px 2px 0px hsl(0 0% 0% / 0.01), 0px 4px 6px -1px hsl(0 0% 0% / 0.01);
  --shadow-xl: 0px 1px 2px 0px hsl(0 0% 0% / 0.01), 0px 8px 10px -1px hsl(0 0% 0% / 0.01);
  --shadow-2xl: 0px 1px 2px 0px hsl(0 0% 0% / 0.03);
}
```

### @theme inline Block

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --font-sans: var(--font-sans);
  --font-mono: var(--font-mono);
  --font-serif: var(--font-serif);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --shadow-2xs: var(--shadow-2xs);
  --shadow-xs: var(--shadow-xs);
  --shadow-sm: var(--shadow-sm);
  --shadow: var(--shadow);
  --shadow-md: var(--shadow-md);
  --shadow-lg: var(--shadow-lg);
  --shadow-xl: var(--shadow-xl);
  --shadow-2xl: var(--shadow-2xl);
}
```

### Sidebar-Specific Variables

These must be declared in the same `:root` / `.dark` blocks as the main variables (before the `@theme inline` block), not in separate blocks.

```css
:root {
  --sidebar: hsl(260 15% 95%);
  --sidebar-foreground: hsl(260 30% 8%);
  --sidebar-primary: hsl(265 75% 54%);
  --sidebar-primary-foreground: hsl(0 0% 100%);
  --sidebar-accent: hsl(260 15% 90%);
  --sidebar-accent-foreground: hsl(260 30% 8%);
  --sidebar-border: hsl(260 10% 85%);
  --sidebar-ring: hsl(265 75% 54%);
}

.dark {
  --sidebar: hsl(260 25% 12%);
  --sidebar-foreground: hsl(260 15% 88%);
  --sidebar-primary: hsl(265 75% 54%);
  --sidebar-primary-foreground: hsl(0 0% 100%);
  --sidebar-accent: hsl(260 23% 18%);
  --sidebar-accent-foreground: hsl(260 15% 88%);
  --sidebar-border: hsl(260 15% 88% / 0.15);
  --sidebar-ring: hsl(265 75% 54%);
}
```

### Chart Colors

```css
:root {
  --chart-1: hsl(265 75% 54%);
  --chart-2: hsl(290 60% 50%);
  --chart-3: hsl(200 80% 50%);
  --chart-4: hsl(160 60% 45%);
  --chart-5: hsl(330 70% 55%);
}

.dark {
  --chart-1: hsl(265 75% 60%);
  --chart-2: hsl(290 60% 58%);
  --chart-3: hsl(200 80% 58%);
  --chart-4: hsl(160 60% 52%);
  --chart-5: hsl(330 70% 60%);
}
```

## Deletions

### Components Removed

- `src/components/AgentWorld/` — entire directory (all files including 3D scene, agent characters, panels, dialogs, hooks, constants)
- `src/components/PokemonGame/` — entire directory (all files including game canvas, engine, hooks, renderer, overlays, interiors)

### Routes Removed

- `/pallet-town` — route removed from `src/main.tsx`
- `src/routes/pallet-town.tsx` — route file deleted (imports deleted PokemonGame component)

### Hub Page (Dashboard) Changes

- `src/components/Dashboard/index.tsx` — remove only the AgentWorld lazy import, the `'world'` view mode, and the 3D View tab/toggle. Other view modes (`'terminals'`, `'canvas'`, `'stats'`) are kept as-is. Only the 3D/AgentWorld view is removed.

### Sidebar Entries Removed

- "ClaudeMon" navigation item (labeled `'ClaudeMon'` in code, with custom `PalletTownIcon` component) — both the nav entry and the icon component are removed

### Assets Removed

- `/public/pokemon/` — entire directory (sprites and assets)

### Dependencies Removed from package.json

- `@react-three/fiber`
- `@react-three/drei`
- `three`
- `@types/three` (if present in devDependencies)

## Additions

### Dependencies Added

- `class-variance-authority` — shadcn component variants
- `clsx` — conditional class utility
- `tailwind-merge` — Tailwind class deduplication
- `@radix-ui/*` — installed automatically per component by shadcn CLI

### Files Added

- `components.json` — shadcn/ui configuration (style: "default", tailwindCSS v4, aliases for components/lib/utils)
- `src/lib/utils.ts` — `cn()` helper (clsx + tailwind-merge)
- `src/components/ui/` — shadcn generated components:
  - `button.tsx`
  - `card.tsx`
  - `dialog.tsx`
  - `input.tsx`
  - `tabs.tsx`
  - `sidebar.tsx`
  - `badge.tsx`
  - `tooltip.tsx`
  - `dropdown-menu.tsx`
  - `scroll-area.tsx`
  - `separator.tsx`
  - `sheet.tsx`
  - `select.tsx`
  - `popover.tsx`
  - `toggle.tsx`
  - `skeleton.tsx`
  - (additional components as needed during migration)

## Migration — Component Mapping

| Current Custom Element | shadcn/ui Replacement |
|---|---|
| Custom card classes (.card-hover, .card-accent, etc.) | `Card`, `CardHeader`, `CardContent`, `CardFooter` |
| Custom buttons | `Button` (variants: default, secondary, destructive, outline, ghost) |
| Custom inputs/selects | `Input`, `Select` |
| Custom dialogs/modals | `Dialog`, `DialogContent`, `DialogHeader`, `DialogFooter` |
| Custom tabs | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` |
| Custom tooltips | `Tooltip`, `TooltipTrigger`, `TooltipContent` |
| Custom dropdowns | `DropdownMenu` and sub-components |
| Custom badges/tags | `Badge` |
| Custom scroll containers | `ScrollArea` |
| Dividers/lines | `Separator` |
| Custom sidebar | shadcn `Sidebar` component suite |

## Migration — Specialized Components

These keep their core implementation but get restyled to match the theme:

- **xterm terminal** — container wrapped in a `Card` with sharp corners, toolbar uses shadcn `Button`. Terminal colors updated to match violet palette.
- **react-mosaic-component** — CSS variables updated to use theme colors. Tile borders, backgrounds, and toolbar use theme variables.
- **react-grid-layout** — placeholder/drag styling updated to use theme colors.
- **@dnd-kit (Kanban)** — columns use shadcn `Card`, drag handles use theme accents. Core dnd-kit logic unchanged.
- **prism-react-renderer** — code highlighting theme adjusted to complement violet palette.

## Migration — Legacy Tailwind Color Classes

The current `@theme inline` block defines legacy color mappings (`--color-bg-primary`, `--color-bg-secondary`, `--color-bg-tertiary`, `--color-bg-elevated`, `--color-text-primary`, `--color-text-secondary`, `--color-text-muted`, `--color-border-primary`, `--color-border-accent`, `--color-accent-cyan`, `--color-accent-green`, `--color-accent-amber`, `--color-accent-red`, `--color-accent-purple`, `--color-accent-blue`, and `-dim` variants). These power Tailwind classes like `bg-bg-primary`, `text-text-muted`, `text-accent-cyan`, `border-border-accent` used across 100+ component files (~300+ occurrences).

**Strategy:** During the big-bang reskin of each page/component, replace every legacy Tailwind class with its shadcn semantic equivalent:

| Legacy class | shadcn replacement |
|---|---|
| `bg-bg-primary` | `bg-background` |
| `bg-bg-secondary` | `bg-secondary` |
| `bg-bg-tertiary` | `bg-muted` |
| `bg-bg-elevated` | `bg-card` |
| `text-text-primary` | `text-foreground` |
| `text-text-secondary` | `text-muted-foreground` |
| `text-text-muted` | `text-muted-foreground` |
| `border-border-primary` | `border-border` |
| `border-border-accent` | `border-primary` |
| `text-accent-cyan` | `text-primary` |
| `text-accent-green` | `text-green-500` (Tailwind native) |
| `text-accent-amber` | `text-amber-500` (Tailwind native) |
| `text-accent-red` | `text-destructive` |
| `text-accent-purple` | `text-primary` |
| `text-accent-blue` | `text-blue-500` (Tailwind native) |
| `-dim` variants | Use opacity modifiers (e.g., `text-primary/60`) |

No legacy mappings are retained in the new `@theme inline` block. Every usage is migrated inline during the page reskin.

## Migration — Status Color Variables

The current theme defines `--success`, `--warning`, `--danger`, and `--info` CSS variables. These are used in `src/components/TrayPanel/TrayAgentItem.tsx` (inline styles: `var(--success)`, `var(--warning)`, `var(--danger)`).

**Strategy:** Add these status variables to both `:root` and `.dark` blocks, mapped to the new violet theme:

```css
:root {
  --success: hsl(160 60% 45%);
  --warning: hsl(45 80% 50%);
  --danger: hsl(0 84% 60%);
  --info: hsl(265 75% 54%);
}

.dark {
  --success: hsl(160 60% 52%);
  --warning: hsl(45 80% 58%);
  --danger: hsl(0 84% 60%);
  --info: hsl(265 75% 60%);
}
```

These are kept as standalone variables (not in `@theme inline`) since they're consumed via `var()` in inline styles, not Tailwind classes.

## Migration — CSS Changes

### globals.css

The entire custom variable system is replaced. Specifically removed:

- All custom color variables (--background-light, --foreground-light, --accent-primary, etc.)
- Custom utility classes: `.card-hover`, `.card-accent`, `.card-success`, `.card-warning`, `.card-danger`
- Custom hover utilities: `.shadow-elevated`, `.hover-lift`, `.hover-scale`, `.hover-border-accent`
- Custom text utilities: `.text-success`, `.text-warning`, `.text-danger`
- Global border-radius overrides (forced 14px)
- Custom `@layer` definitions for the old theme

Replaced with the shadcn CSS variable system defined in the Theme section above.

Retained:
- Tailwind import (`@import "tailwindcss"`)
- Scrollbar styling (adapted to violet theme)
- xterm overrides (adapted to violet theme)
- react-grid-layout placeholder styling (adapted to violet theme)
- Window drag region styling for Tauri
- `@theme inline` block with shadcn mappings

### tauri.conf.json

Window background color updated from cream to match new light theme background.

## Dependencies Retained

- `framer-motion` — used by 50+ source files across the app. Only the Sidebar is fully rewritten to shadcn (which uses Radix, not framer-motion). All other components that use framer-motion for animations keep it as-is.

## CSS File Ordering in globals.css

The final globals.css should be structured in this order:

1. `@import "tailwindcss"`
2. Font imports (Source Code Pro, Source Serif 4)
3. `:root` block — all variables (main + sidebar + fonts + shadows + charts + radius)
4. `.dark` block — all dark mode overrides (main + sidebar + shadows + charts)
5. `@theme inline` block — Tailwind mappings
6. Retained utility styles (scrollbar, xterm, react-grid-layout, window drag region)

## Files Modified

- `src/globals.css` — complete theme replacement
- `src/main.tsx` — remove PalletTown/AgentWorld routes and imports
- `src/components/Dashboard/index.tsx` — remove 3D view mode and AgentWorld references
- `src/components/Sidebar.tsx` — rewrite with shadcn Sidebar component
- `src/components/ClientLayout.tsx` — adapt for SidebarProvider
- `src/routes/*.tsx` — each page reskinned with shadcn components
- `package.json` — add shadcn deps, remove Three.js deps
- `src-tauri/tauri.conf.json` — update window background color

## Files Unchanged

- `src/store/` — Zustand store, no changes
- `src/hooks/` — all business logic hooks, no changes
- `src/lib/` (existing) — business logic, no changes
- `src-tauri/src/` — Rust backend, no changes

## Out of Scope

- No new features
- No layout changes (same page structure)
- No logic changes
- No state management changes
- No Tauri backend changes
- No new pages or routes (beyond removals)
