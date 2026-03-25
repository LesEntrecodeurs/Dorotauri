import { useStore } from '@/store';
import AppSidebar from './Sidebar';
import NotificationToast from './NotificationToast';
import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useElectronAgents } from '@/hooks/useElectron';
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
    const saved = localStorage.getItem('dorotauri-dark-mode');
    if (saved === 'true') {
      setDarkMode(true);
    }
  }, [setDarkMode]);

  // Sync dark class on <html> and persist to localStorage
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('dorotauri-dark-mode', String(darkMode));
  }, [darkMode]);

  // Global vault unread badge
  // TODO: Wire to Tauri IPC when vault backend is implemented
  useEffect(() => {
    // Vault unread count is currently a no-op — Electron API removed.
    // Will be re-wired via Tauri invoke in Phase 6.
    void loadVaultReadDocs; // keep reference so linter doesn't remove the helper
    void setVaultUnreadCount;
  }, [setVaultUnreadCount]);

  // Zen mode on dashboard → use overlay
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
