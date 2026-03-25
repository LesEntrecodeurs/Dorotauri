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
  PanelLeftClose,
  PanelLeft,
  Container,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuBadge,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { LATEST_RELEASE, WHATS_NEW_STORAGE_KEY } from '@/data/changelog';
import { useStore } from '@/store';
import { useNotifications } from '@/hooks/useNotifications';

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
  return 'bg-secondary';
}

function textColor(pct: number): string {
  if (pct >= 80) return 'text-red-400';
  if (pct >= 50) return 'text-yellow-400';
  return 'text-muted-foreground';
}

function UsageBars() {
  const rateLimits = useStore((s) => s.rateLimits);
  if (!rateLimits) return null;
  const { fiveHour, sevenDay } = rateLimits;
  if (!fiveHour && !sevenDay) return null;

  return (
    <div className="px-2 py-1.5 space-y-2 group-data-[collapsible=icon]:hidden border-t border-border pt-2">
      {fiveHour && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground">Session 5h</span>
            <div className="flex items-center gap-1.5">
              <span className={`text-[10px] font-medium ${textColor(fiveHour.usedPercentage)}`}>
                {Math.round(fiveHour.usedPercentage)}%
              </span>
              <span className="text-[9px] text-muted-foreground/60">
                {formatSessionReset(fiveHour.resetsAt)}
              </span>
            </div>
          </div>
          <div className={`h-1 w-full rounded-full overflow-hidden ${barTrackColor(fiveHour.usedPercentage)}`}>
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
            <span className="text-[10px] text-muted-foreground">Week</span>
            <div className="flex items-center gap-1.5">
              <span className={`text-[10px] font-medium ${textColor(sevenDay.usedPercentage)}`}>
                {Math.round(sevenDay.usedPercentage)}%
              </span>
              <span className="text-[9px] text-muted-foreground/60">
                {formatWeekReset(sevenDay.resetsAt)}
              </span>
            </div>
          </div>
          <div className={`h-1 w-full rounded-full overflow-hidden ${barTrackColor(sevenDay.usedPercentage)}`}>
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

const navItems = [
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

function isActive(href: string, pathname: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function CollapseToggle() {
  const { toggleSidebar, state } = useSidebar();
  const collapsed = state === 'collapsed';

  return (
    <SidebarMenuItem>
      <SidebarMenuButton onClick={toggleSidebar} tooltip={collapsed ? 'Expand' : 'Collapse'}>
        {collapsed ? <PanelLeft /> : <PanelLeftClose />}
        <span>Collapse</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export default function AppSidebar() {
  const pathname = useLocation().pathname;
  const { darkMode, toggleDarkMode, vaultUnreadCount } = useStore();
  const whatsNewHasNew = useWhatsNewBadge();
  const { undismissed: undismissedNotifications } = useNotifications();
  const notificationCount = undismissedNotifications.length;

  return (
    <Sidebar collapsible="icon">
      {/* macOS traffic light spacer */}
      <div className="shrink-0 window-drag-region" style={{ height: 'var(--titlebar-inset)' }} data-tauri-drag-region />
      <SidebarHeader className="group-data-[collapsible=icon]:p-0">
        <div className="flex items-center gap-2 px-2 py-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <img
            src="/dorotoing.svg"
            alt="Dorotoring"
            className="w-7 h-7 shrink-0 dark:invert"
          />
          <img
            src="/dorotoring-large.svg"
            alt="Dorotoring"
            className="h-5 w-auto object-contain flex-1 group-data-[collapsible=icon]:hidden dark:invert"
          />
        </div>
        <CollapseToggle />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarMenu>
            {navItems.map((item) => {
              const active = isActive(item.href, pathname);
              const showVaultBadge = item.href === '/vault' && vaultUnreadCount > 0;
              const showNotifBadge = item.href === '/agents' && notificationCount > 0;
              const showWhatsNewBadge = item.href === '/whats-new' && whatsNewHasNew;

              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                    <Link to={item.href}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                  {showVaultBadge && (
                    <SidebarMenuBadge>
                      <Badge variant="default" className="h-5 min-w-5 px-1 text-[10px]">
                        {vaultUnreadCount}
                      </Badge>
                    </SidebarMenuBadge>
                  )}
                  {showNotifBadge && (
                    <SidebarMenuBadge>
                      <Badge
                        variant="destructive"
                        className="h-5 min-w-5 px-1 text-[10px] bg-orange-500"
                      >
                        {notificationCount}
                      </Badge>
                    </SidebarMenuBadge>
                  )}
                  {showWhatsNewBadge && (
                    <SidebarMenuBadge>
                      <Badge variant="destructive" className="h-5 min-w-5 px-1 text-[10px]">
                        1
                      </Badge>
                    </SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={isActive('/settings', pathname)}
              tooltip="Settings"
            >
              <Link to="/settings">
                <Settings />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={darkMode ? 'Light Mode' : 'Dark Mode'}>
              <Button variant="ghost" className="w-full justify-start" onClick={toggleDarkMode}>
                {darkMode ? <Sun /> : <Moon />}
                <span>{darkMode ? 'Light Mode' : 'Dark Mode'}</span>
              </Button>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <UsageBars />
        <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
          <span>Connected</span>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
