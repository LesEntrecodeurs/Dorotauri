import { useStore } from '@/store';
import Sidebar from './Sidebar';
import NotificationToast from './NotificationToast';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import { useEffect, useState, lazy, Suspense } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useElectronAgents } from '@/hooks/useElectron';

const MosaicTerminalView = lazy(() => import('./MosaicTerminalView'));

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return isMobile;
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
  const { sidebarCollapsed, mobileMenuOpen, setMobileMenuOpen, darkMode, setDarkMode, setVaultUnreadCount } = useStore();
  const isMobile = useIsMobile();
  const location = useLocation();
  const { agents } = useElectronAgents();
  const isOnDashboard = location.pathname === '/';

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

  // Close mobile menu on resize to desktop
  useEffect(() => {
    if (!isMobile && mobileMenuOpen) {
      setMobileMenuOpen(false);
    }
  }, [isMobile, mobileMenuOpen, setMobileMenuOpen]);

  const mainMarginLeft = isMobile ? 0 : (sidebarCollapsed ? 72 : 240);

  return (
    <div className="min-h-screen bg-bg-primary relative">
      {/* Full-width window drag bar at the very top (desktop only) */}
      <div className="window-drag hidden lg:block fixed top-0 left-0 right-0 h-7 z-[60]" />

      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-bg-secondary border-b border-border-primary z-40 flex items-center px-4">
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 -ml-2 text-text-secondary hover:text-text-primary transition-colors"
          aria-label="Toggle menu"
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
        <div className="flex items-center gap-2 ml-2">
          <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0">
            <img src="/dorothy-without-text.png" alt="Dorothy" className="w-full h-full object-cover scale-150" />
          </div>
          <span className="text-base font-semibold tracking-wide text-foreground" style={{ fontFamily: "'DM Serif Display', Georgia, serif" }}>Dorothy</span>
        </div>
      </div>

      {/* Mobile Overlay */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="lg:hidden fixed inset-0 bg-black/50 z-40"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar - Desktop: always visible, Mobile: drawer */}
      <Sidebar isMobile={isMobile} />

      {/* Main Content */}
      <motion.main
        initial={false}
        animate={{ marginLeft: mainMarginLeft }}
        transition={{ duration: 0.2, ease: 'easeInOut' }}
        className="min-h-screen pt-16 lg:pt-0"
      >
        {/* Persistent terminal layer — always mounted, hidden when not on dashboard */}
        <div
          style={{ display: isOnDashboard ? 'block' : 'none' }}
          className="h-[calc(100vh-28px)] lg:h-screen"
        >
          <Suspense fallback={null}>
            <MosaicTerminalView agents={agents} />
          </Suspense>
        </div>

        {/* Route content — shown when NOT on dashboard */}
        {!isOnDashboard && (
          <div className="p-4 lg:p-6 pb-6">
            <Outlet />
          </div>
        )}
      </motion.main>

      <NotificationToast />
    </div>
  );
}
