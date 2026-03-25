import { useStore } from '@/store';
import AppSidebar from './Sidebar';
import NotificationToast from './NotificationToast';
import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useElectronAgents } from '@/hooks/useElectron';
import { useUsageLimits } from '@/hooks/useUsageLimits';
import { SidebarProvider, SidebarInset, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import HoverTitlebar from './HoverTitlebar';

const isMacOS = document.documentElement.classList.contains('macos-titlebar');

const MosaicTerminalView = lazy(() => import('./MosaicTerminalView'));

/** Cmd+B keyboard handler — cycles through 3 sidebar states: expanded → collapsed → hidden → expanded */
function SidebarKeyboardCycler({ sidebarHidden, setSidebarHidden }: { sidebarHidden: boolean; setSidebarHidden: React.Dispatch<React.SetStateAction<boolean>> }) {
  const { state, toggleSidebar } = useSidebar();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.code === 'KeyB') {
        e.preventDefault();
        e.stopPropagation();
        if (sidebarHidden) {
          // Hidden → Full menu
          setSidebarHidden(false);
        } else if (state === 'expanded') {
          // Full menu → Icons
          toggleSidebar();
        } else {
          // Icons → Hidden
          setSidebarHidden(true);
        }
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [sidebarHidden, setSidebarHidden, state, toggleSidebar]);

  return null;
}

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

  // --- Sidebar hidden mode (persisted) ---
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    return localStorage.getItem('sidebar_hidden') === 'true';
  });

  // Persist hidden state
  useEffect(() => {
    localStorage.setItem('sidebar_hidden', String(sidebarHidden));
  }, [sidebarHidden]);

  // Listen for sidebar-toggle-hidden event from Sidebar.tsx fullscreen button
  useEffect(() => {
    const handleToggle = () => setSidebarHidden(prev => !prev);
    window.addEventListener('sidebar-toggle-hidden', handleToggle);
    return () => window.removeEventListener('sidebar-toggle-hidden', handleToggle);
  }, []);

  // F11: toggle sidebar hidden (fullscreen mode)
  // Uses event.code for cross-platform reliability (WebKitGTK on Linux).
  // Uses capture phase to intercept before xterm or other handlers consume the event.
  const toggleHidden = useCallback(() => setSidebarHidden(prev => !prev), []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'F11') {
        e.preventDefault();
        toggleHidden();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [toggleHidden]);

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
  // TODO: Wire to Tauri IPC when vault backend is implemented
  useEffect(() => {
    // Vault unread count is currently a no-op — Electron API removed.
    // Will be re-wired via Tauri invoke in Phase 6.
    void loadVaultReadDocs; // keep reference so linter doesn't remove the helper
    void setVaultUnreadCount;
  }, [setVaultUnreadCount]);

  const showOverlay = sidebarHidden;

  return (
    <>
      {!isMacOS && <HoverTitlebar />}
      <SidebarProvider
        key={showOverlay ? 'overlay' : 'normal'}
        defaultOpen={!showOverlay}
      >
      <SidebarKeyboardCycler sidebarHidden={sidebarHidden} setSidebarHidden={setSidebarHidden} />
      {showOverlay ? (
        <SidebarOverlay>
          <AppSidebar sidebarHidden={sidebarHidden} />
        </SidebarOverlay>
      ) : (
        <AppSidebar sidebarHidden={sidebarHidden} />
      )}
      <SidebarInset className="h-svh overflow-hidden relative">
        {/* Floating sidebar toggle — always accessible */}
        <SidebarTrigger className="absolute top-2 left-2 z-40 opacity-30 hover:opacity-100 transition-opacity" />
        <main className="flex-1 overflow-auto h-full">
          {/* Persistent terminal layer — always mounted, hidden when not on dashboard */}
          <div
            style={{ display: isOnDashboard ? 'flex' : 'none' }}
            className="h-svh flex-col"
          >
            <Suspense fallback={null}>
              <MosaicTerminalView agents={agents} zenMode={sidebarHidden} createAgent={createAgent} updateAgent={updateAgent} />
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
    </>
  );
}
