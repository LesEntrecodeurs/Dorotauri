import {
  LayoutDashboard,
  Bot,
  Columns2,
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
  Container,
  Server,
  FolderSync,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

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

// Active nav items — fully functional
const NAV_ITEMS: NavItem[] = [
  { href: '/', icon: LayoutDashboard, label: 'Hub' },
  { href: '/agents', icon: Bot, label: 'Agents' },
  { href: '/skills', icon: Sparkles, label: 'Skills' },
  { href: '/plugins', icon: Puzzle, label: 'Plugins' },
  { href: '/projects', icon: FolderGit2, label: 'Projects' },
  { href: '/docker', icon: Container, label: 'Docker' },
  { href: '/hosts', icon: Server, label: 'Hosts' },
  { href: '/sftp', icon: FolderSync, label: 'SFTP' },
];

// Disabled nav items — visible but marked as disabled
const DISABLED_NAV_ITEMS: NavItem[] = [
  { href: '/kanban', icon: Columns3, label: 'Kanban' },
  { href: '/memory', icon: Brain, label: 'Memory' },
  { href: '/vault', icon: Archive, label: 'Vault' },
  { href: '/automations', icon: Zap, label: 'Automations' },
  { href: '/recurring-tasks', icon: Clock, label: 'Recurring Tasks' },
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

function barTextColor(pct: number): string {
  if (pct >= 80) return 'text-red-500';
  if (pct >= 50) return 'text-yellow-500';
  return 'text-sidebar-foreground-faint';
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

function NavBadge({ href }: { href: string }) {
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
    if (href === '/projects') {
      return (
        <SidebarMenuBadge>
          <Badge variant="secondary" className="h-5 px-1.5 text-[9px] bg-green-500/15 text-green-500 border border-green-500/20">
            working
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
    (href === '/whats-new' && whatsNewHasNew);

  if (!showDot) return null;

  return (
    <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-red-500 z-10" />
  );
}

function UsageBars() {
  const rateLimits = useStore((s) => s.rateLimits);
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  if (!rateLimits) return null;
  const { fiveHour, sevenDay } = rateLimits;
  if (!fiveHour && !sevenDay) return null;

  // Collapsed / icon mode: compact stacked percentages with tooltip
  if (collapsed) {
    const tooltipContent = (
      <div className="space-y-2 min-w-[160px]">
        {fiveHour && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-muted-foreground">Session 5h</span>
              <span className="text-[10px] text-muted-foreground">
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
              <span className="text-[10px] text-muted-foreground">Week</span>
              <span className="text-[10px] text-muted-foreground">
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

    return (
      <div className="border-t border-sidebar-border pt-1.5 pb-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex flex-col items-center gap-0.5 cursor-default px-1">
              {fiveHour && (
                <span className={`text-[9px] font-medium leading-none ${barTextColor(fiveHour.usedPercentage)}`}>
                  {Math.round(fiveHour.usedPercentage)}%
                </span>
              )}
              {sevenDay && (
                <span className={`text-[9px] font-medium leading-none ${barTextColor(sevenDay.usedPercentage)}`}>
                  {Math.round(sevenDay.usedPercentage)}%
                </span>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" className="p-3">
            {tooltipContent}
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  // Expanded mode: full inline bars
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

// --- Main Component ---

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
      {/* Header: action icons row above logo */}
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
            className="p-1 rounded-[6px] text-sidebar-foreground-muted hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors opacity-60 hover:opacity-100"
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
            className="h-[26px] w-auto dark:invert group-data-[collapsible=icon]/sidebar:hidden"
          />
          <img
            src="/dorotoing.svg"
            alt="Dorothy"
            className="w-5 h-5 dark:invert hidden group-data-[collapsible=icon]/sidebar:block"
          />
        </div>
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
                  <NavBadge href={item.href} />
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>

        {/* Disabled items */}
        <SidebarGroup className="group-data-[collapsible=icon]/sidebar:px-1 border-t border-sidebar-border pt-1">
          <SidebarMenu className="gap-px">
            {DISABLED_NAV_ITEMS.map((item) => {
              const active = isActive(item.href, pathname);
              return (
                <SidebarMenuItem key={item.href} className="relative">
                  <SidebarMenuButton
                    asChild
                    isActive={active}
                    tooltip={item.label}
                    className="rounded-[6px] text-[12.5px] text-sidebar-foreground-muted data-[active=true]:text-sidebar-foreground data-[active=true]:bg-sidebar-accent hover:bg-sidebar-accent/60 transition-colors duration-150 opacity-50"
                  >
                    <Link to={item.href}>
                      <item.icon className="opacity-30" />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                  <SidebarMenuBadge className="group-data-[collapsible=icon]/sidebar:hidden">
                    <Badge variant="secondary" className="h-4 px-1 text-[8px] bg-muted text-muted-foreground">
                      disabled
                    </Badge>
                  </SidebarMenuBadge>
                  <NavBadge href={item.href} />
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter>
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
