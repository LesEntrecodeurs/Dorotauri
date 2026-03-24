import { useCallback, useEffect, useMemo, useState, memo } from 'react';
import { Mosaic, MosaicWindow, MosaicNode, getLeaves } from 'react-mosaic-component';
import 'react-mosaic-component/react-mosaic-component.css';
import './mosaic-theme.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@/hooks/useTauri';
import { ExternalLink, Maximize2, Minimize2, Plus, X, Terminal, Settings } from 'lucide-react';
import { useNavigate } from 'react-router';
import type { AgentStatus as AgentStatusType } from '@/types/electron';
import { CHARACTER_FACES } from '@/components/AgentTerminalDialog/constants';
import TerminalTile from './TerminalTile';

type ViewId = string;

interface MosaicTerminalViewProps {
  agents: AgentStatusType[];
  zenMode?: boolean;
}

// --- Tab types (workspace system) ---

interface WorkspaceTab {
  id: string;
  name: string;
  agentIds: string[];
  layout: MosaicNode<string> | null;
}

const STORAGE_KEY = 'dorothy-workspace-tabs';
const MAX_TABS = 10;

function loadTabs(): WorkspaceTab[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return [{ id: Math.random().toString(36).slice(2) + Date.now().toString(36), name: 'Main', agentIds: [], layout: null }];
}

function saveTabs(tabs: WorkspaceTab[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  } catch {}
}

// --- Layout builder ---

function buildGridLayout(agentIds: string[], direction: 'row' | 'column' = 'row'): MosaicNode<string> | null {
  if (agentIds.length === 0) return null;
  if (agentIds.length === 1) return agentIds[0];
  const mid = Math.floor(agentIds.length / 2);
  const nextDir = direction === 'row' ? 'column' : 'row';
  return {
    direction,
    first: buildGridLayout(agentIds.slice(0, mid), nextDir)!,
    second: buildGridLayout(agentIds.slice(mid), nextDir)!,
    splitPercentage: 50,
  };
}

// --- Status colors ---

const STATUS_DOTS: Record<string, string> = {
  running: 'bg-green-500',
  waiting: 'bg-amber-500',
  idle: 'bg-gray-400',
  error: 'bg-red-500',
  completed: 'bg-blue-500',
};

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-green-600/20 text-green-400',
  waiting: 'bg-amber-500/20 text-amber-400',
  idle: 'bg-gray-500/20 text-gray-400',
  error: 'bg-red-500/20 text-red-400',
  completed: 'bg-primary/20 text-primary',
};

export default function MosaicTerminalView({ agents, zenMode = false }: MosaicTerminalViewProps) {
  const [tabs, setTabs] = useState<WorkspaceTab[]>(loadTabs);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0]?.id || '');
  const [maximizedAgent, setMaximizedAgent] = useState<string | null>(null);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Persist tabs
  useEffect(() => { saveTabs(tabs); }, [tabs]);

  // Current active tab
  const activeTab = useMemo(() => tabs.find(t => t.id === activeTabId) || tabs[0], [tabs, activeTabId]);

  // Agent lookup
  const agentMap = useMemo(() => {
    const map = new Map<string, AgentStatusType>();
    for (const agent of agents) map.set(agent.id, agent);
    return map;
  }, [agents]);

  // Clean stale agents from tabs
  useEffect(() => {
    const validIds = new Set(agents.map(a => a.id));
    if (validIds.size === 0) return;
    setTabs(prev => {
      let changed = false;
      const updated = prev.map(tab => {
        const filtered = tab.agentIds.filter(id => validIds.has(id));
        if (filtered.length !== tab.agentIds.length) {
          changed = true;
          return { ...tab, agentIds: filtered, layout: buildGridLayout(filtered) };
        }
        return tab;
      });
      return changed ? updated : prev;
    });
  }, [agents]);

  // Track which tab an agent was popped out from (for re-dock)
  const popoutSourceRef = useMemo(() => new Map<string, string>(), []); // agentId → tabId

  // Listen for window:redocked events to re-add agent to its source tab
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;

    listen<{ agentId: string }>('window:redocked', (event) => {
      const { agentId } = event.payload;
      const sourceTabId = popoutSourceRef.get(agentId) || activeTabId;
      popoutSourceRef.delete(agentId);

      // Add agent back to the source tab
      setTabs(prev => prev.map(tab => {
        if (tab.id !== sourceTabId || tab.agentIds.includes(agentId)) return tab;
        const newIds = [...tab.agentIds, agentId];
        const newLayout = tab.layout
          ? { direction: 'row' as const, first: tab.layout, second: agentId, splitPercentage: 70 }
          : agentId as MosaicNode<string>;
        return { ...tab, agentIds: newIds, layout: newLayout };
      }));
    }).then(fn => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, [activeTabId, popoutSourceRef]);

  // --- Tab CRUD ---

  const createTab = useCallback(() => {
    if (tabs.length >= MAX_TABS) return;
    const newTab: WorkspaceTab = {
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      name: `Tab ${tabs.length + 1}`,
      agentIds: [],
      layout: null,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [tabs.length]);

  const deleteTab = useCallback((tabId: string) => {
    setTabs(prev => {
      if (prev.length <= 1) return prev; // keep at least one
      const idx = prev.findIndex(t => t.id === tabId);
      const remaining = prev.filter(t => t.id !== tabId);
      if (activeTabId === tabId) {
        const nextIdx = Math.min(idx, remaining.length - 1);
        setActiveTabId(remaining[nextIdx].id);
      }
      return remaining;
    });
  }, [activeTabId]);

  const renameTab = useCallback((tabId: string, name: string) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, name: name || t.name } : t));
    setEditingTabId(null);
  }, []);

  // --- Agent membership ---

  const addAgentToTab = useCallback((agentId: string) => {
    setTabs(prev => prev.map(tab => {
      if (tab.id !== activeTabId || tab.agentIds.includes(agentId)) return tab;
      const newIds = [...tab.agentIds, agentId];
      const newLayout = tab.layout
        ? { direction: 'row' as const, first: tab.layout, second: agentId, splitPercentage: Math.round(100 * tab.agentIds.length / (tab.agentIds.length + 1)) }
        : agentId;
      return { ...tab, agentIds: newIds, layout: newLayout };
    }));
    // Keep picker open so user can add multiple agents
  }, [activeTabId]);

  const removeAgentFromTab = useCallback((agentId: string) => {
    setTabs(prev => prev.map(tab => {
      if (tab.id !== activeTabId) return tab;
      const newIds = tab.agentIds.filter(id => id !== agentId);
      return { ...tab, agentIds: newIds, layout: buildGridLayout(newIds) };
    }));
    if (maximizedAgent === agentId) setMaximizedAgent(null);
  }, [activeTabId, maximizedAgent]);

  // --- Layout ---

  const handleLayoutChange = useCallback((newLayout: MosaicNode<ViewId> | null) => {
    setTabs(prev => prev.map(tab =>
      tab.id === activeTabId ? { ...tab, layout: newLayout } : tab
    ));
  }, [activeTabId]);

  // --- Actions ---

  const handlePopout = useCallback(async (agentId: string) => {
    if (!isTauri()) return;
    try {
      // Remember which tab this agent came from
      popoutSourceRef.set(agentId, activeTabId);
      await invoke('window_popout', { agentId });
      removeAgentFromTab(agentId);
    } catch (err) {
      console.error('Failed to pop out:', err);
      popoutSourceRef.delete(agentId);
    }
  }, [removeAgentFromTab, activeTabId, popoutSourceRef]);

  const handleMaximize = useCallback((agentId: string) => {
    setMaximizedAgent(prev => prev === agentId ? null : agentId);
  }, []);

  const navigate = useNavigate();

  // Quick terminal: create a temporary unconfig'd agent and add to current tab
  const addQuickTerminal = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const home = await invoke<{ path: string }[]>('projects_list').then(
        projects => projects[0]?.path || '/home'
      ).catch(() => '/home');

      const agent = await invoke<AgentStatusType>('agent_create', {
        config: {
          projectPath: typeof home === 'string' ? home : '/home',
          skills: [],
          name: `Terminal ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
          character: 'robot',
        }
      });
      addAgentToTab(agent.id);
    } catch (err) {
      console.error('Failed to create quick terminal:', err);
    }
  }, [addAgentToTab]);

  // Keyboard shortcut: Ctrl/Cmd+T for quick terminal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 't') {
        e.preventDefault();
        addQuickTerminal();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [addQuickTerminal]);

  const handleOpenAgentSettings = useCallback((agentId: string) => {
    // Navigate to agents page — the agent's edit modal can be opened from there
    navigate('/agents');
  }, [navigate]);

  const getAgentTitle = useCallback((id: string): string => {
    const agent = agentMap.get(id);
    if (!agent) return `Agent ${id.slice(0, 6)}`;
    return agent.name || `Agent ${id.slice(0, 6)}`;
  }, [agentMap]);

  const getAgentEmoji = useCallback((id: string): string => {
    const agent = agentMap.get(id);
    return CHARACTER_FACES[agent?.character || 'robot'] || '\uD83E\uDD16';
  }, [agentMap]);

  // Agents not in the current tab (for the picker)
  const availableAgents = useMemo(() => {
    const inTab = new Set(activeTab?.agentIds || []);
    return agents.filter(a => !inTab.has(a.id));
  }, [agents, activeTab]);

  const layout = activeTab?.layout || null;

  // Right-click context menu handler (zen mode)
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!zenMode) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, [zenMode]);

  return (
    <div className="flex flex-col w-full h-full" onContextMenu={handleContextMenu}>

      {/* Context menu (zen mode right-click) */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-[101] bg-card border border-border rounded-md shadow-lg py-1 min-w-[180px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => { addQuickTerminal(); setContextMenu(null); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left hover:bg-secondary"
            >
              <Terminal className="w-3.5 h-3.5" />
              New Terminal
              <span className="ml-auto text-muted-foreground text-[10px]">Ctrl+T</span>
            </button>
            <button
              onClick={() => { setShowAgentPicker(true); setContextMenu(null); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left hover:bg-secondary"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Agent
            </button>
            <div className="border-t border-border my-1" />
            <button
              onClick={() => { setContextMenu(null); /* exit zen: dispatch keyboard event */ window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F11' })); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left hover:bg-secondary"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              Exit Fullscreen
              <span className="ml-auto text-muted-foreground text-[10px]">F11</span>
            </button>
          </div>
        </>
      )}

      {/* Tab bar — hidden in zen mode */}
      <div className={`flex items-center gap-0.5 px-2 py-1 bg-secondary/80 border-b border-border shrink-0 ${zenMode ? 'hidden' : ''}`}>
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`
              group flex items-center gap-1 px-2.5 py-1 text-xs rounded-t-md cursor-pointer transition-all relative
              ${tab.id === activeTabId
                ? 'bg-card border border-b-0 border-border text-foreground -mb-px z-10'
                : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
              }
            `}
            onClick={() => { setActiveTabId(tab.id); setMaximizedAgent(null); }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditingTabId(tab.id);
              setEditingName(tab.name);
            }}
          >
            {editingTabId === tab.id ? (
              <input
                autoFocus
                className="w-20 bg-transparent border-b border-foreground text-xs outline-none"
                value={editingName}
                onChange={e => setEditingName(e.target.value)}
                onBlur={() => renameTab(tab.id, editingName)}
                onKeyDown={e => { if (e.key === 'Enter') renameTab(tab.id, editingName); if (e.key === 'Escape') setEditingTabId(null); }}
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <span>{tab.name}</span>
            )}
            <span className="text-[10px] text-muted-foreground">({tab.agentIds.length})</span>
            {tabs.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); deleteTab(tab.id); }}
                className="ml-0.5 p-0.5 hover:bg-red-500/20 text-muted-foreground hover:text-red-400 rounded"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        <button
          onClick={createTab}
          className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-card/50 rounded border border-dashed border-border/50 hover:border-border"
          title="New tab"
        >
          <Plus className="w-3 h-3" />
          <span>New Tab</span>
        </button>

        <div className="flex-1" />

        {/* Quick Terminal button */}
        <button
          onClick={addQuickTerminal}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-foreground bg-card border border-border rounded hover:bg-card/80 mr-1"
          title="New Terminal (Ctrl+T)"
        >
          <Terminal className="w-3.5 h-3.5" />
          Terminal
        </button>

        {/* Add agent to tab button */}
        <div className="relative">
          <button
            onClick={() => setShowAgentPicker(!showAgentPicker)}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-foreground bg-card border border-border rounded hover:bg-card/80"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Agent
          </button>
          {showAgentPicker && (
            <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-md shadow-lg z-50 min-w-[250px] max-h-[400px] overflow-y-auto">
              <div className="px-3 py-2 border-b border-border text-xs font-medium text-muted-foreground">
                Click agents to add them to "{activeTab?.name}"
              </div>
              {availableAgents.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground">All agents are already in this tab</div>
              ) : (
                availableAgents.map(agent => (
                  <button
                    key={agent.id}
                    onClick={() => addAgentToTab(agent.id)}
                    className="flex items-center gap-2 w-full px-3 py-2.5 text-xs text-left hover:bg-secondary transition-colors border-b border-border/50 last:border-0"
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOTS[agent.status] || STATUS_DOTS.idle}`} />
                    <span className="text-sm">{getAgentEmoji(agent.id)}</span>
                    <div className="flex flex-col min-w-0">
                      <span className="truncate font-medium">{agent.name || agent.id.slice(0, 8)}</span>
                      <span className="text-[10px] text-muted-foreground truncate">{agent.projectPath?.split('/').pop()}</span>
                    </div>
                    <span className="ml-auto text-muted-foreground">+</span>
                  </button>
                ))
              )}
              <div className="px-3 py-2 border-t border-border">
                <button
                  onClick={() => setShowAgentPicker(false)}
                  className="w-full text-xs text-center text-muted-foreground hover:text-foreground"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Close picker on outside click */}
      {showAgentPicker && (
        <div className="fixed inset-0 z-40" onClick={() => setShowAgentPicker(false)} />
      )}

      {/* Terminal area */}
      <div className="flex-1 min-h-0">
        {!layout || (activeTab?.agentIds.length === 0) ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
            <p className="text-sm">No agents in this tab</p>
            <button
              onClick={() => setShowAgentPicker(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-foreground text-background rounded hover:bg-foreground/90"
            >
              <Plus className="w-3 h-3" />
              Add an agent
            </button>
          </div>
        ) : maximizedAgent && activeTab?.agentIds.includes(maximizedAgent) ? (
          <div className="w-full h-full flex flex-col">
            <div className="flex items-center gap-2 px-3 py-1 bg-secondary border-b border-border shrink-0">
              <span className="text-sm">{getAgentEmoji(maximizedAgent)}</span>
              <span className="text-xs font-medium text-foreground">{getAgentTitle(maximizedAgent)}</span>
              <div className="flex-1" />
              <button onClick={() => handlePopout(maximizedAgent)} className="p-1 hover:bg-primary/10 text-muted-foreground hover:text-foreground" title="Pop out">
                <ExternalLink className="w-3 h-3" />
              </button>
              <button onClick={() => setMaximizedAgent(null)} className="p-1 hover:bg-primary/10 text-muted-foreground hover:text-foreground" title="Restore">
                <Minimize2 className="w-3 h-3" />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <TerminalTile agentId={maximizedAgent} />
            </div>
          </div>
        ) : (
          <div className="mosaic-terminal-view w-full h-full">
            <Mosaic<ViewId>
              renderTile={(id, path) => {
                const agent = agentMap.get(id);
                const statusClass = agent ? (STATUS_COLORS[agent.status] || STATUS_COLORS.idle) : STATUS_COLORS.idle;
                return (
                  <MosaicWindow<ViewId>
                    path={path}
                    title={getAgentTitle(id)}
                    renderToolbar={() => zenMode ? (
                      /* Zen mode: floating overlay toolbar, visible on hover */
                      <div className="group/toolbar relative w-full h-0">
                        <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover/toolbar:opacity-100 hover:!opacity-100 transition-opacity bg-card/90 border border-border/50 rounded px-1 py-0.5 z-10 backdrop-blur-sm">
                          <span className="text-[10px] text-muted-foreground px-1">{getAgentTitle(id)}</span>
                          <button onClick={(e) => { e.stopPropagation(); handleOpenAgentSettings(id); }} className="p-1 hover:bg-primary/10 text-muted-foreground hover:text-foreground" title="Settings">
                            <Settings className="w-3 h-3" />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handlePopout(id); }} className="p-1 hover:bg-primary/10 text-muted-foreground hover:text-foreground" title="Pop out">
                            <ExternalLink className="w-3 h-3" />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); removeAgentFromTab(id); }} className="p-1 hover:bg-primary/10 text-muted-foreground hover:text-foreground" title="Remove">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Normal mode: fixed toolbar */
                      <div className="flex items-center gap-2 px-3 py-1 w-full bg-secondary border-b border-border select-none mosaic-custom-toolbar">
                        <span className="text-sm">{getAgentEmoji(id)}</span>
                        <span className="text-xs font-medium text-foreground truncate max-w-[120px]">{getAgentTitle(id)}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 font-medium ${statusClass}`}>{agent?.status || 'unknown'}</span>
                        <div className="flex-1" />
                        <button onClick={(e) => { e.stopPropagation(); handleOpenAgentSettings(id); }} className="p-1 hover:bg-primary/10 text-muted-foreground hover:text-foreground" title="Agent settings">
                          <Settings className="w-3 h-3" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleMaximize(id); }} className="p-1 hover:bg-primary/10 text-muted-foreground hover:text-foreground" title="Maximize">
                          <Maximize2 className="w-3 h-3" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handlePopout(id); }} className="p-1 hover:bg-primary/10 text-muted-foreground hover:text-foreground" title="Pop out">
                          <ExternalLink className="w-3 h-3" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); removeAgentFromTab(id); }} className="p-1 hover:bg-primary/10 text-muted-foreground hover:text-foreground" title="Remove from tab">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  >
                    <TerminalTile agentId={id} />
                  </MosaicWindow>
                );
              }}
              value={layout}
              onChange={handleLayoutChange}
              className=""
            />
          </div>
        )}
      </div>
    </div>
  );
}
