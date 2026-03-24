# Dorothy shadcn/ui Violet Reskin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin Dorothy's entire frontend with shadcn/ui components and a violet (#7A33E0) theme, removing the 3D Game and Pokemon Game views.

**Architecture:** Replace the custom warm-retro theme and hand-built components with shadcn/ui's component library configured with a violet color palette, sharp corners (0rem radius), and Source Code Pro as the primary font. All business logic, state management, and Tauri backend remain untouched.

**Tech Stack:** React 19, Tailwind CSS v4, shadcn/ui (Radix primitives), Vite 6, Tauri v2

**Spec:** `docs/superpowers/specs/2026-03-24-dorothy-shadcn-reskin-design.md`

---

## Task 1: Install shadcn/ui and configure project

**Files:**
- Create: `components.json`
- Create: `src/lib/utils.ts`
- Modify: `package.json`

- [ ] **Step 1: Install shadcn/ui dependencies**

```bash
npm install class-variance-authority clsx tailwind-merge
```

- [ ] **Step 2: Create the cn() utility**

Create `src/lib/utils.ts`:

```ts
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 3: Create components.json**

Create `components.json` at project root:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

- [ ] **Step 4: Generate all required shadcn components**

```bash
npx shadcn@latest add button card dialog input tabs sidebar badge tooltip dropdown-menu scroll-area separator sheet select popover toggle skeleton label switch textarea table avatar alert
```

Accept all defaults. This creates files in `src/components/ui/`.

- [ ] **Step 5: Verify build still compiles**

```bash
npm run build
```

Expected: SUCCESS (new components exist but aren't imported yet)

- [ ] **Step 6: Commit**

```bash
git add components.json src/lib/utils.ts src/components/ui/ package.json package-lock.json
git commit -m "feat: install shadcn/ui with all required components"
```

---

## Task 2: Rewrite globals.css with violet theme

**Files:**
- Modify: `src/globals.css` (complete rewrite)

- [ ] **Step 1: Read current globals.css to understand all retained sections**

Read `src/globals.css` fully. Identify:
- Scrollbar styles (retain, adapt colors)
- xterm overrides (retain, adapt colors)
- react-grid-layout placeholder styles (retain, adapt colors)
- Window drag region styles (retain as-is)
- mosaic-theme CSS if inlined (retain, adapt colors)

- [ ] **Step 2: Rewrite globals.css**

Replace the entire file with the new violet theme. Structure:

```css
@import "tailwindcss";

/* Fonts */
@import url('https://fonts.googleapis.com/css2?family=Source+Code+Pro:ital,wght@0,200..900;1,200..900&family=Source+Serif+4:ital,opsz,wght@0,8..60,200..900;1,8..60,200..900&display=swap');

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

  --sidebar: hsl(260 15% 95%);
  --sidebar-foreground: hsl(260 30% 8%);
  --sidebar-primary: hsl(265 75% 54%);
  --sidebar-primary-foreground: hsl(0 0% 100%);
  --sidebar-accent: hsl(260 15% 90%);
  --sidebar-accent-foreground: hsl(260 30% 8%);
  --sidebar-border: hsl(260 10% 85%);
  --sidebar-ring: hsl(265 75% 54%);

  --chart-1: hsl(265 75% 54%);
  --chart-2: hsl(290 60% 50%);
  --chart-3: hsl(200 80% 50%);
  --chart-4: hsl(160 60% 45%);
  --chart-5: hsl(330 70% 55%);

  --success: hsl(160 60% 45%);
  --warning: hsl(45 80% 50%);
  --danger: hsl(0 84% 60%);
  --info: hsl(265 75% 54%);

  --font-sans: 'Source Code Pro', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --font-serif: 'Source Serif 4', ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif;
  --font-mono: 'Source Code Pro', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

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

  --sidebar: hsl(260 25% 12%);
  --sidebar-foreground: hsl(260 15% 88%);
  --sidebar-primary: hsl(265 75% 54%);
  --sidebar-primary-foreground: hsl(0 0% 100%);
  --sidebar-accent: hsl(260 23% 18%);
  --sidebar-accent-foreground: hsl(260 15% 88%);
  --sidebar-border: hsl(260 15% 88% / 0.15);
  --sidebar-ring: hsl(265 75% 54%);

  --chart-1: hsl(265 75% 60%);
  --chart-2: hsl(290 60% 58%);
  --chart-3: hsl(200 80% 58%);
  --chart-4: hsl(160 60% 52%);
  --chart-5: hsl(330 70% 60%);

  --success: hsl(160 60% 52%);
  --warning: hsl(45 80% 58%);
  --danger: hsl(0 84% 60%);
  --info: hsl(265 75% 60%);

  --shadow-2xs: 0px 1px 2px 0px hsl(0 0% 0% / 0.01);
  --shadow-xs: 0px 1px 2px 0px hsl(0 0% 0% / 0.01);
  --shadow-sm: 0px 1px 2px 0px hsl(0 0% 0% / 0.01), 0px 1px 2px -1px hsl(0 0% 0% / 0.01);
  --shadow: 0px 1px 2px 0px hsl(0 0% 0% / 0.01), 0px 1px 2px -1px hsl(0 0% 0% / 0.01);
  --shadow-md: 0px 1px 2px 0px hsl(0 0% 0% / 0.01), 0px 2px 4px -1px hsl(0 0% 0% / 0.01);
  --shadow-lg: 0px 1px 2px 0px hsl(0 0% 0% / 0.01), 0px 4px 6px -1px hsl(0 0% 0% / 0.01);
  --shadow-xl: 0px 1px 2px 0px hsl(0 0% 0% / 0.01), 0px 8px 10px -1px hsl(0 0% 0% / 0.01);
  --shadow-2xl: 0px 1px 2px 0px hsl(0 0% 0% / 0.03);
}

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
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-danger: var(--danger);
  --color-info: var(--info);

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

/* Base styles */
@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}

/* Scrollbar styling */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: hsl(260 15% 75%);
}
::-webkit-scrollbar-thumb:hover {
  background: hsl(265 75% 54%);
}
.dark ::-webkit-scrollbar-thumb {
  background: hsl(260 15% 30%);
}
.dark ::-webkit-scrollbar-thumb:hover {
  background: hsl(265 75% 54%);
}

/* xterm terminal overrides */
.xterm {
  padding: 8px;
}
.xterm-viewport::-webkit-scrollbar {
  width: 6px;
}
.xterm-viewport::-webkit-scrollbar-thumb {
  background: hsl(260 15% 30%);
}

/* react-grid-layout placeholder */
.react-grid-placeholder {
  background: hsl(265 75% 54% / 0.15) !important;
  border: 1px dashed hsl(265 75% 54% / 0.4) !important;
  border-radius: 0 !important;
}

/* Window drag region for Tauri */
.window-drag-region {
  -webkit-app-region: drag;
}
.window-drag-region button,
.window-drag-region a,
.window-drag-region input,
.window-drag-region [role="button"] {
  -webkit-app-region: no-drag;
}

/* react-mosaic overrides */
.mosaic-window .mosaic-window-toolbar {
  background: var(--card);
  border-bottom: 1px solid var(--border);
}
.mosaic-window .mosaic-window-body {
  background: var(--background);
}
.mosaic-split {
  background: var(--border);
}
```

**Important:** Remove ALL of the following from the old file:
- Google Fonts imports for Geist/DM Serif Display
- All old CSS variables (--background-light, --foreground-light, --accent-primary, --accent-secondary, etc.)
- All custom utility classes (.card-hover, .card-accent, .card-success, .card-warning, .card-danger, .hover-lift, .hover-scale, .hover-border-accent, .shadow-elevated, .btn-primary, .text-success, .text-warning, .text-danger)
- Global border-radius overrides (14px forced rounded)
- Old @layer definitions for the retro theme
- Old @theme inline mappings (--color-bg-primary, --color-text-primary, --color-accent-cyan, etc.)
- animate-fade-in, animate-slide-up keyframes (framer-motion handles animations)

- [ ] **Step 3: Verify build compiles**

```bash
npm run build
```

Expected: Build will have many warnings/errors about missing legacy Tailwind classes. This is expected — they will be fixed in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add src/globals.css
git commit -m "feat: replace theme with violet shadcn/ui CSS variables"
```

---

## Task 3: Delete AgentWorld, PokemonGame, and remove dependencies

**Files:**
- Delete: `src/components/AgentWorld/` (entire directory, 18 files)
- Delete: `src/components/PokemonGame/` (entire directory)
- Delete: `src/routes/pallet-town.tsx`
- Delete: `public/pokemon/` (entire directory)
- Modify: `src/main.tsx` (remove pallet-town route)
- Modify: `src/components/Dashboard/index.tsx` (remove 'world' view mode)
- Modify: `src/components/Sidebar.tsx` (remove ClaudeMon entry — will be fully rewritten in Task 4, but remove entry now)
- Modify: `package.json` (remove Three.js deps)

- [ ] **Step 1: Delete directories and files**

```bash
rm -rf src/components/AgentWorld/
rm -rf src/components/PokemonGame/
rm -f src/routes/pallet-town.tsx
rm -rf public/pokemon/
```

- [ ] **Step 2: Remove Three.js dependencies**

```bash
npm uninstall three @react-three/fiber @react-three/drei
```

Also remove `@types/three` from devDependencies if present:
```bash
npm uninstall @types/three 2>/dev/null || true
```

- [ ] **Step 3: Update src/main.tsx**

Remove the lazy import for PalletTown and its route entry. Read the file first to find the exact import and route. Remove:
- The lazy import: `const PalletTownPage = lazy(() => ...)`
- The route: `{ path: 'pallet-town', element: ... }`

- [ ] **Step 4: Update src/components/Dashboard/index.tsx**

Remove only the AgentWorld/3D view mode:
- Remove the lazy import for AgentWorld
- Remove the `'world'` case from the view mode state/tabs
- Remove the 3D View tab button
- Keep `'terminals'`, `'canvas'`, `'stats'` modes intact

- [ ] **Step 5: Remove ClaudeMon from Sidebar**

In `src/components/Sidebar.tsx`, remove:
- The `PalletTownIcon` SVG component (lines ~24-43)
- The `{ label: 'ClaudeMon', ... }` entry from the navigation array

- [ ] **Step 6: Verify build**

```bash
npm run build
```

Expected: SUCCESS (may still have legacy class warnings from other files)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: remove AgentWorld, PokemonGame, and Three.js dependencies"
```

---

## Task 4: Rewrite Sidebar with shadcn Sidebar component

**Files:**
- Rewrite: `src/components/Sidebar.tsx`
- Modify: `src/components/ClientLayout.tsx`

- [ ] **Step 1: Read current Sidebar.tsx and ClientLayout.tsx**

Understand the current navigation items array, badges, responsive behavior, dark mode toggle, and framer-motion animations.

- [ ] **Step 2: Rewrite Sidebar.tsx using shadcn Sidebar**

Replace the entire component with shadcn's Sidebar component suite. Key elements:
- Use `Sidebar`, `SidebarContent`, `SidebarGroup`, `SidebarGroupLabel`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton` from `@/components/ui/sidebar`
- Keep the same navigation items (minus ClaudeMon)
- Keep Lucide icons for each item
- Keep badge counts (vault, notifications) using shadcn `Badge`
- Keep dark mode toggle using shadcn `Button` (ghost variant) at the bottom
- Use `SidebarTrigger` for collapse/expand
- Keep the existing `useLocation()` for active state

Navigation items to include (same order as current):
1. Hub (LayoutDashboard icon, path: /)
2. Agents (Bot icon, path: /agents)
3. Kanban (Columns icon, path: /kanban)
4. Memory (Brain icon, path: /memory)
5. Vault (Archive icon, path: /vault)
6. Skills (Sparkles icon, path: /skills)
7. Automations (Zap icon, path: /automations)
8. Plugins (Puzzle icon, path: /plugins)
9. Projects (FolderGit2 icon, path: /projects)
10. Recurring Tasks (Clock icon, path: /recurring-tasks)
11. Usage (BarChart3 icon, path: /usage)
12. What's New (Megaphone icon, path: /whats-new)
13. Settings (Settings icon, path: /settings) — at bottom

- [ ] **Step 3: Update ClientLayout.tsx**

Wrap the layout with `SidebarProvider` from shadcn:

```tsx
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"

// In the return:
<SidebarProvider>
  <AppSidebar />
  <SidebarInset>
    {/* existing Outlet + content */}
  </SidebarInset>
</SidebarProvider>
```

Keep:
- Dark mode state + localStorage persistence
- Mobile responsive detection
- MosaicTerminalView rendering for dashboard

Remove:
- framer-motion margin animation (shadcn sidebar handles this)
- Manual sidebar width calculations

- [ ] **Step 4: Verify build and test navigation**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx src/components/ClientLayout.tsx
git commit -m "feat: rewrite sidebar and layout with shadcn components"
```

---

## Task 5: Migrate Dashboard components

**Files:**
- Modify: `src/components/Dashboard/index.tsx`
- Modify: `src/components/Dashboard/LiveActivityFeed.tsx`
- Modify: `src/components/Dashboard/LiveTaskFeed.tsx`
- Modify: `src/components/Dashboard/StatsCard.tsx`
- Modify: `src/components/Dashboard/AgentActivity.tsx`
- Modify: `src/components/Dashboard/ProjectsOverview.tsx`
- Modify: `src/components/Dashboard/UsageChart.tsx`
- Modify: `src/components/Dashboard/TerminalLog.tsx`

- [ ] **Step 1: Read all Dashboard component files**

- [ ] **Step 2: Migrate legacy Tailwind classes in all files**

Apply the class migration mapping across all Dashboard files:

| Legacy class | Replacement |
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
| `text-accent-green` | `text-success` |
| `text-accent-amber` | `text-warning` |
| `text-accent-red` | `text-destructive` |
| `text-accent-purple` | `text-primary` |
| `text-accent-blue` | `text-blue-500` |
| `bg-accent-*-dim` | Use opacity modifier (e.g., `bg-primary/10`) |
| `rounded-xl`, `rounded-2xl`, `rounded-lg` | Remove (radius is 0) |
| Any hardcoded colors matching old theme | Replace with CSS variable equivalents |

- [ ] **Step 3: Replace custom card markup with shadcn Card**

In each Dashboard component, replace custom card divs:

```tsx
// Before:
<div className="bg-bg-elevated border border-border-primary rounded-xl p-4">

// After:
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
<Card>
  <CardContent className="p-4">
```

- [ ] **Step 4: Update Dashboard/index.tsx tabs**

Replace custom tab buttons with shadcn `Tabs`:

```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
```

Keep the `'terminals'`, `'canvas'`, `'stats'` view modes. Remove any remnant of `'world'` mode.

- [ ] **Step 5: Verify build**

```bash
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/components/Dashboard/
git commit -m "feat: migrate Dashboard components to shadcn/ui"
```

---

## Task 6: Migrate MosaicTerminalView and Terminal

**Files:**
- Modify: `src/components/MosaicTerminalView/index.tsx`
- Modify: `src/components/MosaicTerminalView/TerminalTile.tsx`
- Modify: `src/components/MosaicTerminalView/mosaic-theme.css`
- Modify: `src/components/Terminal.tsx`

- [ ] **Step 1: Read all MosaicTerminalView files and Terminal.tsx**

- [ ] **Step 2: Migrate legacy classes and wrap tiles in shadcn Card**

In `TerminalTile.tsx`:
- Replace legacy Tailwind classes with shadcn equivalents
- Wrap tile content in `Card` component
- Use shadcn `Button` for toolbar actions (ghost variant for icon buttons)

In `Terminal.tsx`:
- Update terminal theme colors to match violet palette
- Replace any legacy classes

- [ ] **Step 3: Update mosaic-theme.css**

Replace custom mosaic colors with CSS variable references:

```css
.mosaic-window .mosaic-window-toolbar {
  background: var(--card);
  border-bottom: 1px solid var(--border);
}
```

Remove any rounded corners. Update all colors to use theme variables.

- [ ] **Step 4: Verify build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/components/MosaicTerminalView/ src/components/Terminal.tsx
git commit -m "feat: migrate MosaicTerminalView and Terminal to shadcn theme"
```

---

## Task 7: Migrate AgentList components

**Files:**
- Modify: `src/components/AgentList/AgentListHeader.tsx`
- Modify: `src/components/AgentList/AgentCard.tsx`
- Modify: `src/components/AgentList/AgentDetailPanel.tsx`
- Modify: `src/components/AgentList/AgentManagementCard.tsx`
- Modify: `src/components/AgentList/EmptyAgentState.tsx`
- Modify: `src/components/AgentList/DesktopRequiredMessage.tsx`
- Modify: `src/components/AgentList/ProjectFilterTabs.tsx`
- Modify: `src/components/AgentList/StartPromptModal.tsx`

- [ ] **Step 1: Read all AgentList component files**

- [ ] **Step 2: Migrate all components**

For each file:
- Replace legacy Tailwind classes (same mapping as Task 5)
- Replace custom card divs with shadcn `Card`
- Replace custom buttons with shadcn `Button`
- Replace custom inputs with shadcn `Input`
- Remove `rounded-*` classes
- Replace custom badges with shadcn `Badge`

Specific components:
- `AgentCard.tsx`: Use `Card` + `Badge` for status indicators
- `AgentDetailPanel.tsx`: Use `Card` + `ScrollArea` for detail view
- `ProjectFilterTabs.tsx`: Use shadcn `Tabs` for project filtering
- `StartPromptModal.tsx`: Use shadcn `Dialog` (keep framer-motion for AnimatePresence entrance/exit)

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/AgentList/
git commit -m "feat: migrate AgentList components to shadcn/ui"
```

---

## Task 8: Migrate Settings components

**Files:**
- Modify: All 25+ files in `src/components/Settings/`

- [ ] **Step 1: Read Settings/index.ts, SettingsSidebar.tsx, and 3-4 representative section files**

Understand the pattern: each section is a form with inputs, toggles, and buttons.

- [ ] **Step 2: Migrate SettingsSidebar.tsx**

Replace with shadcn components:
- Use shadcn `Button` (ghost variant) for section navigation items
- Replace legacy classes

- [ ] **Step 3: Migrate Settings/Toggle.tsx**

Replace the custom toggle with shadcn `Switch`:

```tsx
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
```

- [ ] **Step 4: Migrate all section files**

For each `*Section.tsx` file:
- Replace custom inputs with shadcn `Input`
- Replace custom selects with shadcn `Select`
- Replace custom buttons with shadcn `Button`
- Replace custom toggle with shadcn `Switch` (via the updated Toggle.tsx)
- Replace legacy Tailwind classes
- Remove rounded corners
- Use `Card` for section containers where appropriate
- Use `Label` for form labels
- Use `Separator` between sections

- [ ] **Step 5: Migrate InstallTerminalModal.tsx**

Use shadcn `Dialog` for the modal wrapper. Keep framer-motion for content animations.

- [ ] **Step 6: Verify build**

```bash
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/components/Settings/
git commit -m "feat: migrate Settings components to shadcn/ui"
```

---

## Task 9: Migrate KanbanBoard, VaultView, ObsidianVaultView, and Memory

**Files:**
- Modify: `src/components/KanbanBoard/index.tsx`
- Modify: `src/components/VaultView/index.tsx`
- Modify: `src/components/ObsidianVaultView/index.tsx`
- Modify: `src/components/Memory/AgentKnowledgeGraph.tsx`

- [ ] **Step 1: Read all files**

- [ ] **Step 2: Migrate KanbanBoard**

- Replace column containers with shadcn `Card`
- Replace card items with shadcn `Card` (nested)
- Replace buttons with shadcn `Button`
- Replace legacy Tailwind classes
- Keep @dnd-kit drag-drop logic unchanged

- [ ] **Step 3: Migrate VaultView and ObsidianVaultView**

- Replace legacy classes
- Use shadcn `Card` for document cards
- Use shadcn `Button` for actions
- Use shadcn `Input` for search
- Use shadcn `ScrollArea` for file lists

- [ ] **Step 4: Migrate Memory/AgentKnowledgeGraph.tsx**

- Replace legacy classes
- Use shadcn components for any UI elements

- [ ] **Step 5: Verify build**

```bash
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/components/KanbanBoard/ src/components/VaultView/ src/components/ObsidianVaultView/ src/components/Memory/
git commit -m "feat: migrate Kanban, Vault, and Memory components to shadcn/ui"
```

---

## Task 10: Migrate NewChatModal and shared components

**Files:**
- Modify: `src/components/NewChatModal/index.tsx`
- Modify: `src/components/NewChatModal/StepProject.tsx`
- Modify: `src/components/NewChatModal/StepTask.tsx`
- Modify: `src/components/NewChatModal/StepTools.tsx`
- Modify: `src/components/NewChatModal/StepModel.tsx`
- Modify: `src/components/NewChatModal/AgentPersonaEditor.tsx`
- Modify: `src/components/NewChatModal/OrchestratorModeToggle.tsx`
- Modify: `src/components/NewChatModal/SkillInstallTerminal.tsx`
- Modify: `src/components/NotificationToast.tsx`
- Modify: `src/components/TerminalDialog.tsx`
- Modify: `src/components/PluginInstallDialog.tsx`
- Modify: `src/components/ProviderBadge.tsx`
- Modify: `src/components/SchedulerCalendar.tsx`

- [ ] **Step 1: Read all files**

- [ ] **Step 2: Migrate NewChatModal**

- Use shadcn `Dialog` for the modal wrapper
- Use shadcn `Button` for step navigation and actions
- Use shadcn `Input`, `Textarea`, `Select` for form fields
- Use shadcn `Tabs` if there are step indicators
- Replace legacy classes
- Keep framer-motion animations for step transitions

- [ ] **Step 3: Migrate shared components**

- `NotificationToast.tsx`: Replace custom toast styling. Use shadcn `Card` for toast container, keep framer-motion for AnimatePresence.
- `TerminalDialog.tsx`: Use shadcn `Dialog`. Keep framer-motion for entrance animation.
- `PluginInstallDialog.tsx`: Use shadcn `Dialog`, `Button`, `ScrollArea`.
- `ProviderBadge.tsx`: Use shadcn `Badge`.
- `SchedulerCalendar.tsx`: Replace legacy classes, use `Card` for calendar container.

- [ ] **Step 4: Verify build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/components/NewChatModal/ src/components/NotificationToast.tsx src/components/TerminalDialog.tsx src/components/PluginInstallDialog.tsx src/components/ProviderBadge.tsx src/components/SchedulerCalendar.tsx
git commit -m "feat: migrate NewChatModal and shared components to shadcn/ui"
```

---

## Task 11: Migrate CanvasView, TerminalsView, RecurringTasks, and TrayPanel

**Files:**
- Modify: `src/components/CanvasView/index.tsx` (and sub-components like AgentNodeCard, ProjectNodeCard, etc.)
- Modify: `src/components/TerminalsView/index.tsx`
- Modify: `src/components/RecurringTasks/` (all files)
- Modify: `src/components/TrayPanel/TrayPanel.tsx`
- Modify: `src/components/TrayPanel/TrayAgentItem.tsx`

- [ ] **Step 1: Read all files**

- [ ] **Step 2: Migrate CanvasView components**

- Replace legacy classes (this is a 2D CSS transforms canvas, not Three.js)
- Use shadcn `Card` for AgentNodeCard and ProjectNodeCard
- Use shadcn `Button` for toolbar actions
- Keep framer-motion for pan/zoom animations

- [ ] **Step 3: Migrate TerminalsView**

- Replace legacy classes
- Use shadcn `Button`, `Badge`, `Tabs` as appropriate

- [ ] **Step 4: Migrate RecurringTasks**

- Replace legacy classes
- Use shadcn `Card` for task cards
- Use shadcn `Button`, `Badge` for actions and status

- [ ] **Step 5: Migrate TrayPanel**

- Replace legacy classes
- Use shadcn `Tabs` for panel tabs
- `TrayAgentItem.tsx`: Keep inline `var(--success)`, `var(--warning)`, `var(--danger)` styles — these resolve to the new theme values defined in globals.css
- Use shadcn `Button` for actions
- Use shadcn `Badge` for status indicators

- [ ] **Step 6: Verify build**

```bash
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/components/CanvasView/ src/components/TerminalsView/ src/components/RecurringTasks/ src/components/TrayPanel/
git commit -m "feat: migrate CanvasView, TerminalsView, RecurringTasks, TrayPanel to shadcn/ui"
```

---

## Task 12: Migrate all route pages

**Files:**
- Modify: `src/routes/hub.tsx`
- Modify: `src/routes/agents.tsx`
- Modify: `src/routes/kanban.tsx`
- Modify: `src/routes/memory.tsx` (629 lines)
- Modify: `src/routes/vault.tsx`
- Modify: `src/routes/settings.tsx`
- Modify: `src/routes/skills.tsx` (508 lines)
- Modify: `src/routes/automations.tsx` (1189 lines — LARGEST)
- Modify: `src/routes/plugins.tsx` (939 lines)
- Modify: `src/routes/projects.tsx` (1132 lines)
- Modify: `src/routes/recurring-tasks.tsx` (131 lines)
- Modify: `src/routes/usage.tsx` (814 lines — HEAVIEST STYLING)
- Modify: `src/routes/whats-new.tsx` (65 lines)
- Modify: `src/routes/console.tsx` (168 lines)
- Modify: `src/routes/tray-panel.tsx` (19 lines)

- [ ] **Step 1: Read all route files (start with the smaller ones)**

Read in order: tray-panel, whats-new, hub, kanban, recurring-tasks, console, vault, agents, settings, skills, memory, usage, plugins, projects, automations.

- [ ] **Step 2: Migrate small routes first**

For `hub.tsx`, `kanban.tsx`, `tray-panel.tsx` — these are mostly wrappers, minimal changes needed. Replace any legacy classes.

For `whats-new.tsx` (65 lines) — replace legacy classes, use `Card` for release note entries.

For `recurring-tasks.tsx` (131 lines) — replace legacy classes, use shadcn `Card`, `Button`, `Badge`.

For `console.tsx` (168 lines) — replace legacy classes, update terminal container styling.

- [ ] **Step 3: Migrate medium routes**

For `vault.tsx` — replace custom tab buttons with shadcn `Tabs`, replace legacy classes.

For `agents.tsx` — replace legacy classes (most UI is in AgentList components, already migrated).

For `settings.tsx` — replace legacy classes (most UI is in Settings components, already migrated).

For `skills.tsx` (508 lines) — replace custom cards with shadcn `Card`, dialogs with shadcn `Dialog`, buttons with shadcn `Button`, legacy classes.

For `memory.tsx` (629 lines) — replace form elements with shadcn `Input`, `Textarea`, `Button`, `Card`. Replace legacy classes.

- [ ] **Step 4: Migrate large routes**

For `usage.tsx` (814 lines, heaviest styling):
- Replace all ~30+ legacy class occurrences
- Use shadcn `Card` for stats displays
- Use shadcn `Button` for filters
- Use shadcn `Tabs` for date range selection
- Replace custom stat cards with `Card` + `CardHeader` + `CardContent`

For `plugins.tsx` (939 lines):
- Use shadcn `Card` for plugin cards
- Use shadcn `Dialog` for install dialogs
- Use shadcn `Button`, `Badge`, `Input`
- Replace legacy classes

For `projects.tsx` (1132 lines):
- Use shadcn `Card` for project cards
- Use shadcn `Dialog` for create/edit modals
- Use shadcn `Tabs` for project tabs
- Use shadcn `Input`, `Textarea`, `Select` for forms
- Replace legacy classes

For `automations.tsx` (1189 lines):
- Use shadcn `Card` for automation cards
- Use shadcn `Dialog` for create/edit modals
- Use shadcn `Button`, `Badge`, `Input`, `Select`, `Switch`
- Replace legacy classes

- [ ] **Step 5: Verify build after each batch**

```bash
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/
git commit -m "feat: migrate all route pages to shadcn/ui"
```

---

## Task 13: Update Tauri config and final cleanup

**Files:**
- Modify: `src-tauri/tauri.conf.json` (window background color)
- Verify: All files compile clean

- [ ] **Step 1: Update tauri.conf.json**

Change the window background color from the old cream to the new violet-tinted light:

The new background is `hsl(260, 20%, 98%)` ≈ `#F8F5FC`. Update the `backgroundColor` field in `src-tauri/tauri.conf.json`.

- [ ] **Step 2: Full build verification**

```bash
npm run build
```

Expected: SUCCESS with zero errors.

- [ ] **Step 3: Search for any remaining legacy classes**

Run grep to find any remaining legacy Tailwind classes that were missed:

```bash
grep -rn "bg-bg-\|text-text-\|border-border-primary\|border-border-accent\|text-accent-\|bg-accent-.*-dim\|card-hover\|card-accent\|card-success\|card-warning\|card-danger\|hover-lift\|hover-scale\|hover-border-accent\|shadow-elevated\|btn-primary\|rounded-xl\|rounded-2xl" src/ --include="*.tsx" --include="*.ts" --include="*.css"
```

Expected: Zero matches (or only in generated shadcn components which don't use these).

If matches found: fix them using the migration mapping from the spec.

- [ ] **Step 4: Search for any remaining old color hardcodes**

```bash
grep -rn "#F0E8D5\|#2C2418\|#3D9B94\|#CD7F4A\|#E8DFC8" src/ --include="*.tsx" --include="*.ts" --include="*.css"
```

These are old theme hex values. Replace with CSS variable references if found.

- [ ] **Step 5: Verify no imports of deleted components**

```bash
grep -rn "AgentWorld\|PokemonGame\|PalletTown\|pallet-town\|ClaudeMon" src/ --include="*.tsx" --include="*.ts"
```

Expected: Zero matches.

- [ ] **Step 6: Commit final cleanup**

```bash
git add -A
git commit -m "feat: complete shadcn/ui violet reskin — final cleanup"
```

---

## Task Dependency Graph

```
Task 1 (setup shadcn) → Task 2 (theme CSS)
                              ↓
                        Task 3 (deletions)
                              ↓
                        Task 4 (sidebar + layout)
                              ↓
              ┌───────────────┼───────────────┐
              ↓               ↓               ↓
        Task 5          Task 6          Task 7
       (Dashboard)    (Mosaic+Term)   (AgentList)
              ↓               ↓               ↓
              └───────────────┼───────────────┘
                              ↓
              ┌───────────────┼───────────────┐
              ↓               ↓               ↓
        Task 8          Task 9         Task 10
       (Settings)    (Kanban+Vault)  (Modals+Shared)
              ↓               ↓               ↓
              └───────────────┼───────────────┘
                              ↓
                        Task 11
                   (Canvas+Tray+etc)
                              ↓
                        Task 12
                      (All routes)
                              ↓
                        Task 13
                    (Tauri + cleanup)
```

Tasks 5-7 can run in parallel. Tasks 8-10 can run in parallel. All other tasks are sequential.
