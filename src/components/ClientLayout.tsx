import { useStore } from '@/store';
import AppSidebar from './Sidebar';
import NotificationToast from './NotificationToast';
import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useElectronAgents } from '@/hooks/useElectron';
import { useUsageLimits } from '@/hooks/useUsageLimits';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import HoverTitlebar from './HoverTitlebar';

const isMacOS = document.documentElement.classList.contains('macos-titlebar');

const MosaicTerminalView = lazy(() => import('./MosaicTerminalView'));

/** Overlay sidebar — slides in from left edge on hover, dismisses on mouse leave or nav click */
function SidebarOverlay({ children }: { children: React.ReactNode }) {
  const [show, setShow] = useState(false);

  return (
    <>
      <div
        className="fixed left-0 top-0 h-full w-2 z-50"
        onMouseEnter={() => setShow(true)}
      />
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

  const [sidebarHidden, setSidebarHidden] = useState(() => {
    return localStorage.getItem('sidebar_hidden') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('sidebar_hidden', String(sidebarHidden));
  }, [sidebarHidden]);

  const [sidebarMode, setSidebarMode] = useState<'full' | 'icons'>(() => {
    return (localStorage.getItem('sidebar_mode') as 'full' | 'icons') || 'full';
  });
  useEffect(() => {
    localStorage.setItem('sidebar_mode', sidebarMode);
  }, [sidebarMode]);
  const toggleMode = useCallback(() => {
    setSidebarMode(prev => prev === 'full' ? 'icons' : 'full');
  }, []);

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

  useEffect(() => {
    void loadVaultReadDocs;
    void setVaultUnreadCount;
  }, [setVaultUnreadCount]);

  const showOverlay = sidebarHidden;
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
}
