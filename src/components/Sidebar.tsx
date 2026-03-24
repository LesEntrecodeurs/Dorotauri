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
    <button
      onClick={toggleSidebar}
      className="flex h-8 items-center gap-2 rounded-md px-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2 group-data-[collapsible=icon]:justify-center"
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
    >
      {collapsed ? <PanelLeft className="size-4 shrink-0" /> : <PanelLeftClose className="size-4 shrink-0" />}
      <span className="group-data-[collapsible=icon]:hidden">{collapsed ? 'Expand' : 'Collapse'}</span>
    </button>
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
      <SidebarHeader className="group-data-[collapsible=icon]:p-0">
        <div className="flex items-center gap-2 px-2 py-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <div className="w-6 h-6 overflow-hidden shrink-0 group-data-[collapsible=icon]:w-5 group-data-[collapsible=icon]:h-5">
            <img
              src="/dorothy-without-text.png"
              alt="Dorothy"
              className="w-full h-full object-cover scale-150"
            />
          </div>
          <img
            src="/text.png"
            alt="Dorothy"
            className="h-4 w-auto object-contain flex-1 group-data-[collapsible=icon]:hidden"
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
