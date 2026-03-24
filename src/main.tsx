import { StrictMode, Component, ReactNode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router'
import './globals.css'
import ClientLayout from './components/ClientLayout'

// Hub and Console are loaded eagerly (critical paths)
import Hub from './routes/hub'
import Console from './routes/console'

// All other routes are lazy-loaded (only fetched when navigated to)
const AgentsPage = lazy(() => import('./routes/agents'))
const KanbanPage = lazy(() => import('./routes/kanban'))
const MemoryPage = lazy(() => import('./routes/memory'))
const VaultPage = lazy(() => import('./routes/vault'))
const SettingsPage = lazy(() => import('./routes/settings'))
const SkillsPage = lazy(() => import('./routes/skills'))
const AutomationsPage = lazy(() => import('./routes/automations'))
const PluginsPage = lazy(() => import('./routes/plugins'))
const ProjectsPage = lazy(() => import('./routes/projects'))
const RecurringTasksPage = lazy(() => import('./routes/recurring-tasks'))
const UsagePage = lazy(() => import('./routes/usage'))
const WhatsNewPage = lazy(() => import('./routes/whats-new'))
const TrayPanel = lazy(() => import('./routes/tray-panel'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-[50vh]">
      <div className="text-muted-foreground text-sm">Loading...</div>
    </div>
  )
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: 'monospace', color: '#c00', background: 'white' }}>
          <h1>React Error</h1>
          <pre>{this.state.error.message}</pre>
          <pre style={{ fontSize: 12, color: '#666' }}>{this.state.error.stack}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

// macOS: add class for traffic light padding (titleBarStyle: Overlay)
if (/Mac/.test(navigator.platform)) {
  document.documentElement.classList.add('macos-titlebar');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route element={<ClientLayout />}>
              <Route path="/" element={<Hub />} />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/kanban" element={<KanbanPage />} />
              <Route path="/memory" element={<MemoryPage />} />
              <Route path="/vault" element={<VaultPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/skills" element={<SkillsPage />} />
              <Route path="/automations" element={<AutomationsPage />} />
              <Route path="/plugins" element={<PluginsPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/recurring-tasks" element={<RecurringTasksPage />} />
              <Route path="/usage" element={<UsagePage />} />
              <Route path="/whats-new" element={<WhatsNewPage />} />
            </Route>
            <Route path="/console/:agentId" element={<Console />} />
            <Route path="/tray-panel" element={<TrayPanel />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
)
