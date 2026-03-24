import { useStore } from '@/store';
import AppSidebar from './Sidebar';
import NotificationToast from './NotificationToast';
import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useElectronAgents } from '@/hooks/useElectron';
import { SidebarProvider, SidebarInset, useSidebar } from '@/components/ui/sidebar';

const MosaicTerminalView = lazy(() => import('./MosaicTerminalView'));

/** Collapses sidebar when entering zen mode, restores when leaving */
function ZenSidebarSync({ zen }: { zen: boolean }) {
  const { setOpen } = useSidebar();
  useEffect(() => {
    if (zen) setOpen(false);
  }, [zen, setOpen]);
  return null;
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
  const { agents } = useElectronAgents();
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
    const saved = localStorage.getItem('dorothy-dark-mode');
    if (saved === 'true') {
      setDarkMode(true);
    }
  }, [setDarkMode]);

  // Sync dark class on <html> and persist to localStorage
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('dorothy-dark-mode', String(darkMode));
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
      <AppSidebar />
      <ZenSidebarSync zen={zenDashboard} />
      <SidebarInset>
        <main className="flex-1 overflow-auto">
          {/* Persistent terminal layer — always mounted, hidden when not on dashboard */}
          <div
            style={{ display: isOnDashboard ? 'flex' : 'none' }}
            className="h-svh flex-col"
          >
            <Suspense fallback={null}>
              <MosaicTerminalView agents={agents} zenMode={zenDashboard} />
            </Suspense>
          </div>

          {/* Route content — shown when NOT on dashboard */}
          {!isOnDashboard && (
            <div className="p-4 lg:p-6 pb-6">
              <Outlet />
            </div>
          )}
        </main>
      </SidebarInset>
      <NotificationToast />
    </SidebarProvider>
  );
}
