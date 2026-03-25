import { useStore } from '@/store';
import AppSidebar from './Sidebar';
import NotificationToast from './NotificationToast';
import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useElectronAgents } from '@/hooks/useElectron';
import { useUsageLimits } from '@/hooks/useUsageLimits';
import { SidebarProvider, SidebarInset, useSidebar } from '@/components/ui/sidebar';

const MosaicTerminalView = lazy(() => import('./MosaicTerminalView'));

/** In zen mode, sidebar is hidden but slides in as overlay on left-edge hover */
function ZenSidebarOverlay({ children }: { children: React.ReactNode }) {
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
  const [zenMode, setZenMode] = useState(false);

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

  const zenDashboard = zenMode && isOnDashboard;

  return (
    <SidebarProvider defaultOpen={!zenDashboard}>
      {zenDashboard ? (
        <ZenSidebarOverlay>
          <AppSidebar />
        </ZenSidebarOverlay>
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
