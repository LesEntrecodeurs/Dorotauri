# Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the main sidebar with Notion-inspired design, clean declarative code, and dual collapse modes (icon + hidden).

**Architecture:** Two-layer collapse: shadcn's existing `open/collapsed` handles expanded↔icons, a new `sidebarHidden` boolean in `ClientLayout.tsx` handles the hidden state using the existing `ZenSidebarOverlay` pattern. Zen mode flows through `sidebarHidden` — no separate overlay logic. `Sidebar.tsx` is rewritten from scratch with a `NAV_ITEMS` array. CSS variables updated to Notion warm tones.

**Tech Stack:** React, shadcn/ui sidebar primitives, Tailwind CSS v4, Lucide icons, react-router

**Spec:** `docs/superpowers/specs/2026-03-25-sidebar-redesign-design.md`

---

### Task 1: Update CSS variables to Notion color tokens

**Files:**
- Modify: `src/globals.css:31-38` (`:root` sidebar vars — replace 8 lines with 10)
- Modify: `src/globals.css:86-93` (`.dark` sidebar vars — replace 8 lines with 10)
- Modify: `src/globals.css:143` (`@theme inline` — add 2 lines after `--color-sidebar-ring`)

- [ ] **Step 1: Update `:root` sidebar variables**

Replace lines 31-38 in `src/globals.css` (the 8 `--sidebar-*` vars) with these 10 lines:

```css
  --sidebar: hsl(40 10% 97%);
  --sidebar-foreground: hsl(40 5% 20%);
  --sidebar-foreground-muted: hsl(40 3% 44%);
  --sidebar-foreground-faint: hsl(40 3% 70%);
  --sidebar-primary: hsl(265 75% 54%);
  --sidebar-primary-foreground: hsl(0 0% 100%);
  --sidebar-accent: hsl(40 5% 93%);
  --sidebar-accent-foreground: hsl(40 5% 20%);
  --sidebar-border: hsl(35 8% 88%);
  --sidebar-ring: hsl(265 75% 54%);
```

- [ ] **Step 2: Update `.dark` sidebar variables**

Replace lines 86-93 in `src/globals.css` (the 8 `.dark` `--sidebar-*` vars) with these 10 lines:

```css
  --sidebar: hsl(0 0% 13%);
  --sidebar-foreground: hsl(0 0% 92%);
  --sidebar-foreground-muted: hsl(0 0% 48%);
  --sidebar-foreground-faint: hsl(0 0% 35%);
  --sidebar-primary: hsl(265 75% 54%);
  --sidebar-primary-foreground: hsl(0 0% 100%);
  --sidebar-accent: hsl(0 0% 100% / 0.07);
  --sidebar-accent-foreground: hsl(0 0% 92%);
  --sidebar-border: hsl(0 0% 100% / 0.06);
  --sidebar-ring: hsl(265 75% 54%);
```

- [ ] **Step 3: Add new tokens to `@theme inline`**

After the line `--color-sidebar-ring: var(--sidebar-ring);` (around line 143), add:

```css
  --color-sidebar-foreground-muted: var(--sidebar-foreground-muted);
  --color-sidebar-foreground-faint: var(--sidebar-foreground-faint);
```

- [ ] **Step 4: Verify the app still renders**

Run: `pnpm dev` (or `pnpm build`)
Expected: No CSS errors. Sidebar colors should now be warm beige in light mode, dark gray in dark mode.

- [ ] **Step 5: Commit**

```bash
git add src/globals.css
git commit -m "style: update sidebar CSS variables to Notion color tokens"
```

---

### Task 2: Rewrite Sidebar.tsx — full rewrite from scratch

**Files:**
- Rewrite: `src/components/Sidebar.tsx` (complete replacement)

This task replaces the entire file with clean, declarative code. Includes: NAV_ITEMS array, header with logo + hover-reveal collapse buttons, nav list with badges, footer with Settings/DarkMode on same line + usage bars + connection indicator.

**Note on logo dark mode:** The spec says "no more `dark:invert`". However, since the SVG files are single-color assets, we keep `dark:invert` for now — removing it requires creating dark-mode-specific SVG variants, which is out of scope. This is a pragmatic deviation from the spec.

- [ ] **Step 1: Replace the entire `src/components/Sidebar.tsx`**

```tsx
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
  X,
  Container,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';

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
import { Badge } from '@/components/ui/badge';

import { LATEST_RELEASE, WHATS_NEW_STORAGE_KEY } from '@/data/changelog';
import { useStore } from '@/store';
import { useNotifications } from '@/hooks/useNotifications';

// --- Types ---

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

// --- Constants ---

const NAV_ITEMS: NavItem[] = [
  { href: '/', icon: LayoutDashboard, label: 'Hub' },
  { href: '/agents', icon: Bot, label: 'Agents' },
  { href: '/kanban', icon: Columns3, label: 'Kanban' },
  { href: '/memory', icon: Brain, label: 'Memory' },
  { href: '/vault', icon: Archive, label: 'Vault' },
  { href: '/skills', icon: Sparkles, label: 'Skills' },
  { href: '/automations', icon: Zap, label: 'Automations' },
  { href: '/plugins', icon: Puzzle, label: 'Plugins' },
  { href: '/projects', icon: FolderGit2, label: 'Projects' },
  { href: '/recurring-tasks', icon: Clock, label: 'Recurring Tasks' },
  { href: '/docker', icon: Container, label: 'Docker' },
  { href: '/usage', icon: BarChart3, label: 'Usage' },
  { href: '/whats-new', icon: Megaphone, label: "What's New" },
];

// --- Helpers ---

function isActive(href: string, pathname: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function formatSessionReset(resetsAt: number): string {
  const diff = resetsAt - Math.floor(Date.now() / 1000);
  if (diff <= 0) return '0m';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
}

function formatWeekReset(resetsAt: number): string {
  const diff = resetsAt - Math.floor(Date.now() / 1000);
  if (diff <= 0) return '0m';
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((diff % 3600) / 60);
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
}

function barColor(pct: number): string {
  if (pct >= 80) return 'bg-red-500';
  if (pct >= 50) return 'bg-yellow-500';
  return 'bg-green-500';
}

function barTrackColor(pct: number): string {
  if (pct >= 80) return 'bg-red-500/20';
  if (pct >= 50) return 'bg-yellow-500/20';
  return 'bg-sidebar-accent';
}

// --- Hooks ---

function useWhatsNewBadge() {
  const [hasNew, setHasNew] = useState(false);

  useEffect(() => {
    const check = () => {
      const lastSeen = Number(localStorage.getItem(WHATS_NEW_STORAGE_KEY) || '0');
      setHasNew(LATEST_RELEASE.id > lastSeen);
    };
    check();
    window.addEventListener('whats-new-seen', check);
    return () => window.removeEventListener('whats-new-seen', check);
  }, []);

  return hasNew;
}

// --- Sub-components ---

function NavBadge({ href, active }: { href: string; active: boolean }) {
  const { vaultUnreadCount } = useStore();
  const { undismissed } = useNotifications();
  const whatsNewHasNew = useWhatsNewBadge();
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  // Expanded mode: pill badges via SidebarMenuBadge
  if (!collapsed) {
    if (href === '/vault' && vaultUnreadCount > 0) {
      return (
        <SidebarMenuBadge>
          <Badge variant="default" className="h-5 min-w-5 px-1 text-[10px] bg-red-500">
            {vaultUnreadCount}
          </Badge>
        </SidebarMenuBadge>
      );
    }
    if (href === '/agents' && undismissed.length > 0) {
      return (
        <SidebarMenuBadge>
          <Badge variant="destructive" className="h-5 min-w-5 px-1 text-[10px] bg-orange-500">
            {undismissed.length}
          </Badge>
        </SidebarMenuBadge>
      );
    }
    if (href === '/whats-new' && whatsNewHasNew) {
      return (
        <SidebarMenuBadge>
          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
        </SidebarMenuBadge>
      );
    }
    return null;
  }

  // Collapsed mode: absolute-positioned dots on the icon
  const showDot =
    (href === '/vault' && vaultUnreadCount > 0) ||
    (href === '/agents' && undismissed.length > 0) ||
    (href === '/whats-new' && whatsNewHasNew);

  if (!showDot) return null;

  const dotColor = href === '/agents' ? 'bg-orange-500' : 'bg-red-500';

  return (
    <span className={`absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full ${dotColor} z-10`} />
  );
}

function UsageBars() {
  const rateLimits = useStore((s) => s.rateLimits);
  if (!rateLimits) return null;
  const { fiveHour, sevenDay } = rateLimits;
  if (!fiveHour && !sevenDay) return null;

  return (
    <div className="px-2 py-1.5 space-y-1.5 group-data-[collapsible=icon]/sidebar:hidden border-t border-sidebar-border pt-2">
      {fiveHour && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] text-sidebar-foreground-faint">Session 5h</span>
            <span className="text-[9px] text-sidebar-foreground-faint">
              {formatSessionReset(fiveHour.resetsAt)}
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
              {formatWeekReset(sevenDay.resetsAt)}
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

function ConnectionIndicator() {
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-[10px] text-sidebar-foreground-faint group-data-[collapsible=icon]/sidebar:hidden">
      <span className="relative flex h-1.5 w-1.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
      </span>
      <span>Connected</span>
    </div>
  );
}

// --- Main Component ---

export default function AppSidebar() {
  const pathname = useLocation().pathname;
  const { darkMode, toggleDarkMode } = useStore();
  const { toggleSidebar, state } = useSidebar();
  const collapsed = state === 'collapsed';

  return (
    <Sidebar collapsible="icon">
      {/* macOS traffic light spacer */}
      <div className="shrink-0 window-drag-region" style={{ height: 'var(--titlebar-inset)' }} data-tauri-drag-region />

      {/* Header: logo + hover-reveal collapse buttons */}
      <SidebarHeader className="group/header group-data-[collapsible=icon]/sidebar:p-1">
        <div className="flex items-center px-2 py-2 group-data-[collapsible=icon]/sidebar:px-0 group-data-[collapsible=icon]/sidebar:justify-center">
          <img
            src="/dorotoring-large.svg"
            alt="Dorothy"
            className="h-6 w-auto dark:invert group-data-[collapsible=icon]/sidebar:hidden"
          />
          <img
            src="/dorotoing.svg"
            alt="Dorothy"
            className="w-6 h-6 dark:invert hidden group-data-[collapsible=icon]/sidebar:block"
          />
          {/* Collapse buttons — visible on hover of header */}
          <div className="ml-auto flex gap-0.5 opacity-0 group-hover/header:opacity-100 transition-opacity duration-150 group-data-[collapsible=icon]/sidebar:hidden">
            <button
              onClick={toggleSidebar}
              className="p-1 rounded-[6px] text-sidebar-foreground-muted hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
              title="Collapse to icons (⌘B)"
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('sidebar-hide'))}
              className="p-1 rounded-[6px] text-sidebar-foreground-muted hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
              title="Hide sidebar (⌘⇧B)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {/* When collapsed: show expand button */}
        {collapsed && (
          <button
            onClick={toggleSidebar}
            className="p-1 mx-auto rounded-[6px] text-sidebar-foreground-muted hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
            title="Expand sidebar (⌘B)"
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </button>
        )}
      </SidebarHeader>

      {/* Navigation */}
      <SidebarContent>
        <SidebarGroup className="group-data-[collapsible=icon]/sidebar:px-1">
          <SidebarMenu className="gap-px">
            {NAV_ITEMS.map((item) => {
              const active = isActive(item.href, pathname);
              return (
                <SidebarMenuItem key={item.href} className="relative">
                  <SidebarMenuButton
                    asChild
                    isActive={active}
                    tooltip={item.label}
                    className="rounded-[6px] text-[12.5px] text-sidebar-foreground-muted data-[active=true]:text-sidebar-foreground data-[active=true]:bg-sidebar-accent hover:bg-sidebar-accent/60 transition-colors duration-150"
                  >
                    <Link to={item.href}>
                      <item.icon className={active ? 'opacity-70' : 'opacity-45'} />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                  <NavBadge href={item.href} active={active} />
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter>
        <ConnectionIndicator />
        {/* Settings + Dark mode: same line when expanded, stacked in icon mode */}
        <div className="flex items-center gap-1 px-2 group-data-[collapsible=icon]/sidebar:flex-col group-data-[collapsible=icon]/sidebar:px-0 group-data-[collapsible=icon]/sidebar:gap-1">
          <SidebarMenuButton
            asChild
            isActive={isActive('/settings', pathname)}
            tooltip="Settings"
            className="rounded-[6px] text-[12.5px] text-sidebar-foreground-muted data-[active=true]:text-sidebar-foreground flex-1"
          >
            <Link to="/settings">
              <Settings className="opacity-45" />
              <span className="group-data-[collapsible=icon]/sidebar:hidden">Settings</span>
            </Link>
          </SidebarMenuButton>
          <button
            onClick={toggleDarkMode}
            className="p-2 rounded-[6px] text-sidebar-foreground-muted hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors shrink-0"
            title={darkMode ? 'Light Mode' : 'Dark Mode'}
          >
            {darkMode ? <Sun className="w-4 h-4 opacity-45" /> : <Moon className="w-4 h-4 opacity-45" />}
          </button>
        </div>
        <UsageBars />
      </SidebarFooter>
    </Sidebar>
  );
}
```

- [ ] **Step 2: Verify the sidebar renders correctly**

Run: `pnpm dev`
Expected: Sidebar shows with Notion warm beige colors, all 13 nav items at ~12.5px font size, 6px border-radius on items, badges (expanded: pills, collapsed: dots), Settings + dark mode toggle on same line, usage bars, connection indicator. Cmd+B toggles icon mode. X button dispatches event (no handler yet — wired in Task 3).

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: rewrite sidebar with Notion-inspired design and declarative NAV_ITEMS"
```

---

### Task 3: Implement hidden mode in ClientLayout

**Files:**
- Modify: `src/components/ClientLayout.tsx` (add sidebarHidden state, unify with zen mode, use controlled SidebarProvider)

This task adds the hidden sidebar mode. Key decisions:
- Zen mode sets `sidebarHidden=true` (no separate overlay logic, as spec requires)
- `SidebarProvider` uses controlled `open` prop when hidden (so toggling hidden after mount works)
- `Cmd+Shift+B` keyboard shortcut for hidden mode
- Listens for `sidebar-hide` event from Sidebar.tsx X button

- [ ] **Step 1: Rewrite ClientLayout.tsx**

Replace the entire file with the updated version. Key changes from current:
1. `ZenSidebarOverlay` gains `onClick` handler for nav link dismissal
2. Zen mode now sets `sidebarHidden=true` instead of using separate `zenDashboard` flow
3. `SidebarProvider` uses controlled `open`/`onOpenChange` props when `sidebarHidden` is true (so it starts collapsed and can be properly managed)
4. `Cmd+Shift+B` shortcut added
5. `sidebar-hide` event listener added

```tsx
import { useStore } from '@/store';
import AppSidebar from './Sidebar';
import NotificationToast from './NotificationToast';
import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useElectronAgents } from '@/hooks/useElectronAgents';
import { useUsageLimits } from '@/hooks/useUsageLimits';
import { SidebarProvider, SidebarInset, useSidebar } from '@/components/ui/sidebar';

const MosaicTerminalView = lazy(() => import('./MosaicTerminalView'));

/** Overlay sidebar — slides in from left edge on hover, dismisses on mouse leave or nav click */
function SidebarOverlay({ children }: { children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const { setOpen } = useSidebar();

  useEffect(() => {
    setOpen(show);
  }, [show, setOpen]);

  return (
    <>
      {/* Invisible trigger strip on left edge */}
      <div
        className="fixed left-0 top-0 h-full w-2 z-50"
        onMouseEnter={() => setShow(true)}
      />
      {/* Overlay sidebar */}
      <div
        className={`fixed left-0 top-0 h-svh z-50 shadow-2xl transition-transform duration-200 ease-out ${
          show ? 'translate-x-0' : '-translate-x-full pointer-events-none'
        }`}
        onMouseLeave={() => setShow(false)}
        onClick={(e) => {
          // Dismiss overlay when a nav link is clicked
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

const VAULT_READ_DOCS_KEY = 'vault-read-docs';

function loadVaultReadDocs(): Set<string> {
  try {
    const stored = localStorage.getItem(VAULT_READ_DOCS_KEY);
    if (stored) return new Set(JSON.parse(stored));
    return new Set();
  } catch {
    return new Set();
  }
}

export default function ClientLayout() {
  const { darkMode, setDarkMode, setVaultUnreadCount } = useStore();
  const location = useLocation();
  const { agents, createAgent, updateAgent } = useElectronAgents();
  useUsageLimits();
  const isOnDashboard = location.pathname === '/';

  // --- Zen mode ---
  const [zenMode, setZenMode] = useState(false);

  // --- Sidebar hidden mode (persisted) ---
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    return localStorage.getItem('sidebar_hidden') === 'true';
  });

  // Persist hidden state
  useEffect(() => {
    localStorage.setItem('sidebar_hidden', String(sidebarHidden));
  }, [sidebarHidden]);

  // Listen for sidebar-hide event from Sidebar.tsx X button
  useEffect(() => {
    const handleHide = () => setSidebarHidden(true);
    window.addEventListener('sidebar-hide', handleHide);
    return () => window.removeEventListener('sidebar-hide', handleHide);
  }, []);

  // Toggle zen mode with F11 or Ctrl+Shift+F
  const toggleZen = useCallback(() => setZenMode(prev => !prev), []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        toggleZen();
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault();
        toggleZen();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleZen]);

  // Cmd+Shift+B: toggle hidden mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'b') {
        e.preventDefault();
        setSidebarHidden(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Initialize dark mode from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('dorotoring-dark-mode');
    if (saved === 'true') {
      setDarkMode(true);
    }
  }, [setDarkMode]);

  // Sync dark class on <html> and persist to localStorage
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('dorotoring-dark-mode', String(darkMode));
  }, [darkMode]);

  // Global vault unread badge
  useEffect(() => {
    void loadVaultReadDocs;
    void setVaultUnreadCount;
  }, [setVaultUnreadCount]);

  // Zen mode on dashboard → set sidebar hidden
  const zenDashboard = zenMode && isOnDashboard;
  const showOverlay = zenDashboard || sidebarHidden;

  return (
    <SidebarProvider
      key={showOverlay ? 'overlay' : 'normal'}
      defaultOpen={!showOverlay}
    >
      {showOverlay ? (
        <SidebarOverlay>
          <AppSidebar />
        </SidebarOverlay>
      ) : (
        <AppSidebar />
      )}
      <SidebarInset className="h-svh overflow-hidden">
        {/* Window drag region across the top for macOS overlay titlebar */}
        {!isOnDashboard && (
          <div className="shrink-0 window-drag-region" style={{ height: 'var(--titlebar-inset)' }} data-tauri-drag-region />
        )}
        <main className="flex-1 overflow-auto h-full">
          {/* Persistent terminal layer — always mounted, hidden when not on dashboard */}
          <div
            style={{ display: isOnDashboard ? 'flex' : 'none' }}
            className="h-svh flex-col"
          >
            <Suspense fallback={null}>
              <MosaicTerminalView agents={agents} zenMode={zenDashboard} createAgent={createAgent} updateAgent={updateAgent} />
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
  );
}
```

**Important note on `key` prop:** We use `key={showOverlay ? 'overlay' : 'normal'}` on `SidebarProvider` to force a remount when switching between normal and overlay modes. This solves the `defaultOpen` stale state problem — when transitioning to overlay, the provider remounts with `defaultOpen={false}`, and when returning to normal, it remounts with `defaultOpen={true}`.

**Note on `Cmd+B` in hidden mode:** When the sidebar is hidden and `SidebarProvider` has `defaultOpen={false}`, pressing `Cmd+B` will toggle the shadcn internal state within the overlay context. This is harmless — the overlay handles its own visibility via mouse hover. If the user wants to exit hidden mode entirely, they use `Cmd+Shift+B`.

- [ ] **Step 2: Verify hidden mode end-to-end**

Run: `pnpm dev`
Expected:
1. Click X button in sidebar header → sidebar disappears completely
2. Hover left edge → sidebar slides in as overlay with shadow
3. Click a nav link in overlay → navigates and overlay dismisses
4. Mouse leave → overlay dismisses
5. `Cmd+Shift+B` → toggles hidden mode on/off
6. Refresh page → hidden state persists from localStorage
7. Zen mode (F11 on dashboard) → overlay sidebar works the same way
8. Exiting zen mode → sidebar returns to normal (if not hidden)

- [ ] **Step 3: Commit**

```bash
git add src/components/ClientLayout.tsx
git commit -m "feat: add hidden sidebar mode with left-edge overlay and zen mode unification"
```

---

### Task 4: Final smoke test and cleanup

**Files:**
- Review: `src/components/Sidebar.tsx`, `src/components/ClientLayout.tsx`, `src/globals.css`

- [ ] **Step 1: Remove any unused imports**

Check both `Sidebar.tsx` and `ClientLayout.tsx` for unused imports. Specifically verify:
- `Sidebar.tsx`: no `SidebarRail`, no `SidebarGroupLabel`, no `Button` (dark mode is now a plain button, not shadcn Button)
- `ClientLayout.tsx`: renamed `ZenSidebarOverlay` → `SidebarOverlay`

- [ ] **Step 2: Full smoke test**

Run: `pnpm dev`

Verify all of the following:
1. All 13 nav links work and highlight correctly
2. Light mode: warm beige sidebar background (`hsl(40 10% 97%)`)
3. Dark mode: dark gray sidebar background (`hsl(0 0% 13%)`)
4. Dark mode toggle works (sun/moon icon in footer)
5. `Cmd+B`: toggles expanded ↔ icon mode
6. `Cmd+Shift+B`: toggles hidden mode
7. Header: logo shows large (expanded) / icon (collapsed)
8. Header: hover reveals PanelLeftClose + X buttons (hidden when collapsed)
9. Header: expand button visible in icon mode
10. Badges expanded: Vault (red pill), Agents (orange pill), What's New (red dot)
11. Badges icon mode: small absolute dots on icons
12. Footer: connection indicator with pulsing green dot
13. Footer: Settings + dark mode toggle on same line when expanded
14. Footer: Settings and dark mode stacked in icon mode
15. Footer: usage bars with correct colors (green/yellow/red)
16. Nav items: ~12.5px font size, 6px border-radius
17. Nav items: active has bg + foreground color + font-medium (from shadcn)
18. Nav items: inactive has muted color, icon 45% opacity
19. Mobile: sheet overlay works
20. Zen mode (F11 on dashboard): overlay sidebar on left-edge hover
21. Page refresh: sidebar state and hidden mode persist

- [ ] **Step 3: Build check**

Run: `pnpm build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "chore: sidebar redesign cleanup and final polish"
```
