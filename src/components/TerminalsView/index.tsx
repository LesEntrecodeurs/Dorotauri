

import { useState, useCallback, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import { isElectron } from '@/hooks/useElectron';
import { isTauri } from '@/hooks/useTauri';
import { invoke } from '@tauri-apps/api/core';
import { DndContext } from '@dnd-kit/core';
import { useElectronAgents, useElectronFS, useElectronSkills } from '@/hooks/useElectron';
import { useMultiTerminal } from './hooks/useMultiTerminal';
import { useTerminalGrid } from './hooks/useTerminalGrid';
import { useTabManager } from './hooks/useTabManager';
import { useBroadcast } from './hooks/useBroadcast';
import { useTerminalKeyboard } from './hooks/useTerminalKeyboard';
import { useTerminalSearch } from './hooks/useTerminalSearch';
import { useTerminalContextMenu } from './hooks/useTerminalContextMenu';
import { useTerminalDnd } from './hooks/useTerminalDnd';
import { LAYOUT_PRESETS } from './constants';
import type { LayoutPreset } from './types';
import GlobalToolbar from './components/GlobalToolbar';
import TerminalGrid from './components/TerminalGrid';
import CustomTabBar from './components/CustomTabBar';
import ProjectTabBar from './components/ProjectTabBar';
import Sidebar from './components/Sidebar';
import StatusBar from './components/StatusBar';
import BroadcastIndicator from './components/BroadcastIndicator';
import ContextMenu from './components/ContextMenu';
import 'xterm/css/xterm.css';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

// Lazy-load NewChatModal only when needed
const NewChatModal = lazy(() => import('@/components/NewChatModal'));

export default function TerminalsView() {
  const {
    agents,
    isLoading,
    startAgent,
    stopAgent,
    removeAgent,
    sendInput,
    createAgent,
  } = useElectronAgents();
  const { projects, openFolderDialog } = useElectronFS();
  const { installedSkills, refresh: refreshSkills } = useElectronSkills();

  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [focusedPanelId, setFocusedPanelId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [viewFullscreen, setViewFullscreen] = useState(false);
  const [terminalFontSize, setTerminalFontSize] = useState(11);
  const pendingStartRef = useRef<{ agentId: string; prompt: string; options?: { model?: string } } | null>(null);
  const [terminalTheme, setTerminalTheme] = useState<'dark' | 'light'>('dark');
  const [terminalSettingsLoaded, setTerminalSettingsLoaded] = useState(!isTauri());

  // Load terminal settings from app settings
  useEffect(() => {
    if (!isTauri()) {
      setTerminalSettingsLoaded(true);
      return;
    }
    invoke<{ terminalFontSize?: number; terminalTheme?: 'dark' | 'light' } | null>('app_settings_get').then((settings) => {
      if (settings) {
        if (settings.terminalFontSize) setTerminalFontSize(settings.terminalFontSize);
        if (settings.terminalTheme) setTerminalTheme(settings.terminalTheme);
      }
      setTerminalSettingsLoaded(true);
    }).catch(() => { setTerminalSettingsLoaded(true); });
  }, []);

  // Tab manager — core state backed by Tauri IPC
  const tabManager = useTabManager({ agents });

  // Agents for the active tab are derived from Agent.tabId
  const filteredAgents = tabManager.activeTabAgents;

  // Derive grid preset and editable state
  const gridPreset: LayoutPreset = (tabManager.activeTab?.layout as LayoutPreset) || '3x3';
  const isEditable = !!tabManager.activeTabId;
  const tabType: 'custom' | 'project' = 'custom';
  const tabId = tabManager.activeTabId || 'default';

  // Compute disabled presets for layout selector
  const agentCount = filteredAgents.length;
  const disabledPresets = useMemo(() => {
    return (Object.keys(LAYOUT_PRESETS) as LayoutPreset[]).filter(
      preset => LAYOUT_PRESETS[preset].maxPanels < agentCount
    );
  }, [agentCount]);

  // Current tab agent IDs (for AddAgentDropdown) — derived from Agent.tabId
  const currentTabAgentIds = useMemo(
    () => filteredAgents.map(a => a.id),
    [filteredAgents]
  );

  // Agent IDs for grid
  const agentIds = useMemo(() => filteredAgents.map(a => a.id), [filteredAgents]);

  // Called when a terminal is fully initialized — fire any deferred agent start
  const handleTerminalReady = useCallback((agentId: string) => {
    const pending = pendingStartRef.current;
    if (pending && pending.agentId === agentId) {
      pendingStartRef.current = null;
      startAgent(pending.agentId, pending.prompt, pending.options as { model?: string; resume?: boolean }).catch(error => {
        console.error('Failed to start agent after creation:', error);
      });
    }
  }, [startAgent]);

  // Core hooks — delay terminal init until settings are loaded to avoid wrong font size
  const multiTerminal = useMultiTerminal({
    agents: terminalSettingsLoaded ? filteredAgents : [],
    initialFontSize: terminalFontSize,
    onFontSizeChange: (size) => {
      setTerminalFontSize(size);
      if (isTauri()) {
        invoke('app_settings_save', { settings: { terminalFontSize: size } }).catch(() => {});
      }
    },
    theme: terminalTheme,
    onTerminalReady: handleTerminalReady,
  });
  const grid = useTerminalGrid({ agentIds, preset: gridPreset, isEditable, tabId });
  const broadcast = useBroadcast();
  const search = useTerminalSearch(filteredAgents);
  const contextMenu = useTerminalContextMenu();

  // Dnd hook
  const dnd = useTerminalDnd({
    onSkillDrop: async (skillName, agentId) => {
      await sendInput(agentId, `use this skill: ${skillName}\n`);
    },
  });

  // Keyboard shortcuts
  const visibleAgentIds = useMemo(
    () => grid.visiblePanels.map(p => p.agentId),
    [grid.visiblePanels]
  );

  useTerminalKeyboard({
    panelAgentIds: visibleAgentIds,
    onFocusPanel: (agentId) => {
      setFocusedPanelId(agentId);
      multiTerminal.focusTerminal(agentId);
    },
    onToggleFullscreen: () => grid.toggleFullscreen(focusedPanelId || undefined),
    onToggleBroadcast: broadcast.toggleBroadcast,
    onToggleSidebar: () => { },
    onNewAgent: () => setShowNewChatModal(true),
    onExitFullscreen: grid.exitFullscreen,
    isFullscreen: !!grid.fullscreenPanelId,
  });

  // Handler callbacks
  const handleStartAgent = useCallback(async (agentId: string) => {
    await startAgent(agentId, '', { resume: true });
  }, [startAgent]);

  const handleStopAgent = useCallback(async (agentId: string) => {
    await stopAgent(agentId);
  }, [stopAgent]);

  // Remove agent from its tab by clearing tabId, then stop it
  const handleRemoveFromTab = useCallback(async (agentId: string) => {
    await stopAgent(agentId);
    await tabManager.moveAgentToTab(agentId, '');
  }, [stopAgent, tabManager]);

  // Full remove: unregister terminal and delete agent
  const handleRemoveAgent = useCallback(async (agentId: string) => {
    multiTerminal.unregisterContainer(agentId);
    await removeAgent(agentId);
  }, [removeAgent, multiTerminal]);

  // Add agent to active tab by updating its tabId
  const handleAddAgentToTab = useCallback(async (agentId: string) => {
    if (tabManager.activeTabId) {
      await tabManager.moveAgentToTab(agentId, tabManager.activeTabId);
    }
  }, [tabManager]);

  const handleMoveToTab = useCallback(async (agentId: string, targetTabId: string) => {
    await tabManager.moveAgentToTab(agentId, targetTabId);
  }, [tabManager]);

  const handleMoveToNewTab = useCallback(async (agentId: string) => {
    await tabManager.createTabAndMoveAgent(agentId);
  }, [tabManager]);

  const handleFocusPanel = useCallback((agentId: string) => {
    setFocusedPanelId(agentId);
    multiTerminal.focusTerminal(agentId);
  }, [multiTerminal]);

  const handleStartAll = useCallback(async () => {
    const needsStart = filteredAgents.filter(a =>
      (a.processState === 'inactive' || a.processState === 'completed') && !a.ptyId
    );
    for (const agent of needsStart) {
      await startAgent(agent.id, '', { resume: true });
    }
  }, [filteredAgents, startAgent]);

  const handleStopAll = useCallback(async () => {
    const running = filteredAgents.filter(a => a.processState === 'running' || a.processState === 'waiting');
    for (const agent of running) {
      await stopAgent(agent.id);
    }
  }, [filteredAgents, stopAgent]);

  const handleCopyOutput = useCallback((agentId: string) => {
    const agent = agents.find(a => a.id === agentId);
    if (agent) {
      navigator.clipboard.writeText(agent.output.join('')).catch(() => { });
    }
  }, [agents]);

  const handleLayoutChange = useCallback((preset: LayoutPreset) => {
    if (tabManager.activeTabId) {
      tabManager.updateLayout(tabManager.activeTabId, preset);
    }
  }, [tabManager]);

  const handleNewAgent = useCallback(async (
    projectPath: string,
    skills: string[],
    prompt: string,
    model?: string,
    worktree?: { enabled: boolean; branchName: string },
    character?: string,
    name?: string,
    secondaryProjectPath?: string,
    skipPermissions?: boolean,
  ) => {
    const agent = await createAgent({
      cwd: projectPath,
      skills,
      worktree,
      character: character as import('@/types/electron').AgentCharacter,
      name,
      secondaryPaths: secondaryProjectPath ? [secondaryProjectPath] : undefined,
      skipPermissions,
      tabId: tabManager.activeTabId ?? undefined,
    });
    // Agent is created with tabId — no separate addAgentToTab needed
    // Defer start until the terminal for this agent is initialized.
    // The onTerminalReady callback will fire startAgent once xterm is ready.
    if (prompt) {
      pendingStartRef.current = { agentId: agent.id, prompt, options: { model } };
    }
    setShowNewChatModal(false);
  }, [createAgent, tabManager]);

  // Auto-start agents that have no PTY (freshly loaded from disk).
  // Skip agents that already have a live PTY — they're idle but have an
  // active Claude session waiting for the next prompt.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (isLoading || autoStartedRef.current) return;
    autoStartedRef.current = true;
    const needsStart = agents.filter(a =>
      (a.processState === 'inactive' || a.processState === 'completed') && !a.ptyId
    );
    for (const agent of needsStart) {
      startAgent(agent.id, '', { resume: true }).catch(() => { });
    }
  }, [isLoading, agents, startAgent]);

  // Exit view fullscreen on Escape
  useEffect(() => {
    if (!viewFullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewFullscreen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [viewFullscreen]);

  // Re-fit terminals when view fullscreen changes
  useEffect(() => {
    const timer = setTimeout(() => multiTerminal.fitAll(), 100);
    return () => clearTimeout(timer);
  }, [viewFullscreen, multiTerminal]);

  const runningCount = filteredAgents.filter(a => a.processState === 'running' || a.processState === 'waiting').length;

  return (
    <DndContext sensors={dnd.sensors} onDragEnd={dnd.handleDragEnd}>
      <div className={`flex flex-col overflow-hidden ${viewFullscreen ? 'fixed inset-0 z-[100] bg-background' : 'h-full w-full relative'}`}>
        {/* Broadcast overlay */}
        <BroadcastIndicator active={broadcast.broadcastMode} />

        {/* Top toolbar */}
        <GlobalToolbar
          layout={gridPreset}
          onLayoutChange={handleLayoutChange}
          broadcastMode={broadcast.broadcastMode}
          onToggleBroadcast={broadcast.toggleBroadcast}
          onStartAll={handleStartAll}
          onStopAll={handleStopAll}
          onNewAgent={() => setShowNewChatModal(true)}
          runningCount={runningCount}
          totalCount={filteredAgents.length}
          fontSize={multiTerminal.fontSize}
          onZoomIn={multiTerminal.zoomIn}
          onZoomOut={multiTerminal.zoomOut}
          onZoomReset={multiTerminal.zoomReset}
          isViewFullscreen={viewFullscreen}
          onToggleViewFullscreen={() => setViewFullscreen(prev => !prev)}
          isCustomTabActive={!!tabManager.activeTabId}
          allAgents={agents}
          currentTabAgentIds={currentTabAgentIds}
          onAddAgentToTab={handleAddAgentToTab}
          disabledPresets={disabledPresets}
        />

        {/* Custom tab bar — top */}
        <CustomTabBar
          tabs={tabManager.tabs}
          activeTab={tabManager.activeTabId}
          canCreateTab={tabManager.canCreateTab}
          onSelectTab={tabManager.setActiveTabId}
          onCreateTab={tabManager.createTab}
          onDeleteTab={tabManager.deleteTab}
          onRenameTab={tabManager.renameTab}
          onReorderTabs={async (fromIndex, toIndex) => {
            const reordered = [...tabManager.tabs];
            const [moved] = reordered.splice(fromIndex, 1);
            reordered.splice(toIndex, 0, moved);
            await tabManager.reorderTabs(reordered.map(t => t.id));
          }}
        />

        {/* Terminal grid — takes full space, relative for sidebar panel */}
        <div className="flex-1 min-h-0 relative">
          <TerminalGrid
            agents={filteredAgents}
            visiblePanels={grid.visiblePanels}
            rglLayout={grid.rglLayout}
            cols={grid.cols}
            rows={grid.gridDefinition.rows}
            onDragStop={grid.onDragStop}
            broadcastMode={broadcast.broadcastMode}
            focusedPanelId={focusedPanelId}
            fullscreenPanelId={grid.fullscreenPanelId}
            isLoading={isLoading}
            isEditable={isEditable}
            tabType={tabType}
            onRegisterContainer={multiTerminal.registerContainer}
            onStartAgent={handleStartAgent}
            onStopAgent={handleStopAgent}
            onRemoveAgent={handleRemoveAgent}
            onClearTerminal={multiTerminal.clearTerminal}
            onFullscreenPanel={grid.fullscreenPanel}
            onExitFullscreen={grid.exitFullscreen}
            onFocusPanel={handleFocusPanel}
            onContextMenu={contextMenu.openMenu}
            onFitAll={multiTerminal.fitAll}
          />

          {/* Sidebar panel — overlays grid from the right */}
          <Sidebar
            open={panelOpen}
            onClose={() => setPanelOpen(false)}
            agents={filteredAgents}
            focusedPanelId={focusedPanelId}
            onFocusPanel={handleFocusPanel}
            onStartAgent={handleStartAgent}
            onStopAgent={handleStopAgent}
            installedSkills={installedSkills}
          />
        </div>

        {/* Project tab bar — bottom */}
        <ProjectTabBar
          agents={agents}
          activeTab={tabManager.activeTabId}
          onSelectProject={() => {/* project tabs are deprecated — no-op */}}
          panelOpen={panelOpen}
          onTogglePanel={() => setPanelOpen(prev => !prev)}
        />

        {/* Status bar */}
        <StatusBar agents={filteredAgents} />

        {/* Context menu */}
        <ContextMenu
          state={contextMenu.menuState}
          agent={contextMenu.menuState.agentId ? agents.find(a => a.id === contextMenu.menuState.agentId) || null : null}
          onClose={contextMenu.closeMenu}
          onStart={handleStartAgent}
          onStop={handleStopAgent}
          onClear={multiTerminal.clearTerminal}
          onFullscreen={grid.fullscreenPanel}
          onCopyOutput={handleCopyOutput}
          tabs={tabManager.tabs}
          activeTabId={tabManager.activeTabId}
          onMoveToTab={handleMoveToTab}
          onMoveToNewTab={handleMoveToNewTab}
          onNewAgent={() => setShowNewChatModal(true)}
        />

        {/* New Chat Modal */}
        {showNewChatModal && (
          <Suspense fallback={null}>
            <NewChatModal
              open={showNewChatModal}
              onClose={() => setShowNewChatModal(false)}
              onSubmit={handleNewAgent}
              projects={projects}
              onBrowseFolder={openFolderDialog}
              installedSkills={installedSkills}
              onRefreshSkills={refreshSkills}
            />
          </Suspense>
        )}
      </div>
    </DndContext>
  );
}
