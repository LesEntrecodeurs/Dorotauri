import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router'
import './globals.css'
import ClientLayout from './components/ClientLayout'
import Hub from './routes/hub'
import Console from './routes/console'
import AgentsPage from './routes/agents'
import KanbanPage from './routes/kanban'
import MemoryPage from './routes/memory'
import VaultPage from './routes/vault'
import SettingsPage from './routes/settings'
import SkillsPage from './routes/skills'
import AutomationsPage from './routes/automations'
import PluginsPage from './routes/plugins'
import ProjectsPage from './routes/projects'
import RecurringTasksPage from './routes/recurring-tasks'
import UsagePage from './routes/usage'
import WhatsNewPage from './routes/whats-new'
import PalletTownPage from './routes/pallet-town'
import TrayPanel from './routes/tray-panel'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
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
          <Route path="/pallet-town" element={<PalletTownPage />} />
        </Route>
        <Route path="/console/:agentId" element={<Console />} />
        <Route path="/tray-panel" element={<TrayPanel />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
)
