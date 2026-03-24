import { useCallback, useEffect, useMemo, useState } from 'react';
import { Mosaic, MosaicWindow, MosaicNode, getLeaves } from 'react-mosaic-component';
import 'react-mosaic-component/react-mosaic-component.css';
import './mosaic-theme.css';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@/hooks/useTauri';
import { useLayout } from '@/hooks/useLayout';
import { ExternalLink, Maximize2, Minimize2, Plus, X } from 'lucide-react';
import type { AgentStatus as AgentStatusType } from '@/types/electron';
import { CHARACTER_FACES } from '@/components/AgentWorld/constants';
import TerminalTile from './TerminalTile';

type ViewId = string;

interface MosaicTerminalViewProps {
  agents: AgentStatusType[];
}

/** Alternate row/column direction at each level for a grid feel. */
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

export default function MosaicTerminalView({ agents }: MosaicTerminalViewProps) {
  const { layout, setLayout, removeTile, addTile } = useLayout();
  const [focusedAgent, setFocusedAgent] = useState<string | null>(null);
  const [maximizedAgent, setMaximizedAgent] = useState<string | null>(null);
  const prevAgentIdsRef = useMemo(() => ({ current: '' }), []);

  // Build agent lookup map
  const agentMap = useMemo(() => {
    const map = new Map<string, AgentStatusType>();
    for (const agent of agents) {
      map.set(agent.id, agent);
    }
    return map;
  }, [agents]);

  // Get which agents are currently visible in mosaic
  const visibleAgentIds = useMemo(() => {
    if (!layout) return new Set<string>();
    return new Set(getLeaves(layout));
  }, [layout]);

  // Rebuild layout when agent list changes
  useEffect(() => {
    const agentIds = agents.map(a => a.id);
    const key = agentIds.join(',');

    if (key === prevAgentIdsRef.current) return;
    prevAgentIdsRef.current = key;

    if (agentIds.length === 0) {
      setLayout(null);
      return;
    }

    if (!layout) {
      setLayout(buildGridLayout(agentIds));
      return;
    }

    const currentLeaves = new Set(getLeaves(layout));
    const newIds = new Set(agentIds);

    if (currentLeaves.size === newIds.size && agentIds.every(id => currentLeaves.has(id))) {
      return;
    }

    // Add new agents to existing layout instead of rebuilding
    const addedIds = agentIds.filter(id => !currentLeaves.has(id));
    if (addedIds.length > 0 && currentLeaves.size > 0) {
      // Add each new agent to the layout
      let newLayout = layout;
      for (const id of addedIds) {
        newLayout = {
          direction: 'row',
          first: newLayout,
          second: id,
          splitPercentage: 70,
        };
      }
      setLayout(newLayout);
    } else {
      setLayout(buildGridLayout(agentIds));
    }
  }, [agents, layout, prevAgentIdsRef, setLayout]);

  const handlePopout = useCallback(async (agentId: string) => {
    if (!isTauri()) return;
    try {
      await invoke('window_popout', { agentId });
      removeTile(agentId);
    } catch (err) {
      console.error('Failed to pop out window:', err);
    }
  }, [removeTile]);

  const handleDock = useCallback((agentId: string) => {
    // Re-add agent to mosaic if it's not already visible
    if (!visibleAgentIds.has(agentId)) {
      addTile(agentId);
    }
    setFocusedAgent(agentId);
  }, [addTile, visibleAgentIds]);

  const handleMaximize = useCallback((agentId: string) => {
    setMaximizedAgent(prev => prev === agentId ? null : agentId);
  }, []);

  const handleRemoveFromMosaic = useCallback((agentId: string) => {
    removeTile(agentId);
    if (maximizedAgent === agentId) setMaximizedAgent(null);
  }, [removeTile, maximizedAgent]);

  const getAgentTitle = useCallback((id: string): string => {
    const agent = agentMap.get(id);
    if (!agent) return `Agent ${id.slice(0, 6)}`;
    return agent.name || `Agent ${id.slice(0, 6)}`;
  }, [agentMap]);

  const getAgentEmoji = useCallback((id: string): string => {
    const agent = agentMap.get(id);
    if (agent?.name?.toLowerCase() === 'bitwonka') return '\uD83D\uDC38';
    return CHARACTER_FACES[agent?.character || 'robot'] || '\uD83E\uDD16';
  }, [agentMap]);

  const handleChange = useCallback((newLayout: MosaicNode<ViewId> | null) => {
    setLayout(newLayout);
  }, [setLayout]);

  // Group agents by project for tabs
  const agentsByProject = useMemo(() => {
    const groups = new Map<string, AgentStatusType[]>();
    for (const agent of agents) {
      const project = agent.projectPath?.split('/').pop() || 'Unknown';
      if (!groups.has(project)) groups.set(project, []);
      groups.get(project)!.push(agent);
    }
    return groups;
  }, [agents]);

  return (
    <div className="flex flex-col w-full h-full">
      {/* Tab bar — shows all agents grouped by project */}
      <div className="flex items-center gap-1 px-2 py-1 bg-secondary/80 border-b border-border overflow-x-auto shrink-0">
        {agents.map(agent => {
          const isVisible = visibleAgentIds.has(agent.id);
          const isFocused = focusedAgent === agent.id;
          const dotColor = STATUS_DOTS[agent.status] || STATUS_DOTS.idle;
          const emoji = getAgentEmoji(agent.id);
          const projectName = agent.projectPath?.split('/').pop() || '';

          return (
            <button
              key={agent.id}
              onClick={() => {
                if (!isVisible) {
                  addTile(agent.id);
                }
                setFocusedAgent(agent.id);
                if (maximizedAgent && maximizedAgent !== agent.id) {
                  setMaximizedAgent(agent.id);
                }
              }}
              className={`
                flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md whitespace-nowrap transition-all
                ${isVisible
                  ? 'bg-card border border-border text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
                }
              `}
              title={`${agent.name || agent.id.slice(0,8)} — ${projectName} (${agent.status})`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
              <span>{emoji}</span>
              <span className="max-w-[100px] truncate">
                {agent.name || agent.id.slice(0, 6)}
              </span>
              <span className="text-[10px] text-muted-foreground">{projectName}</span>
            </button>
          );
        })}
      </div>

      {/* Mosaic terminal area */}
      <div className="flex-1 min-h-0">
        {!layout ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No agents to display — create one from the Agents page
          </div>
        ) : maximizedAgent ? (
          /* Maximized single agent view */
          <div className="w-full h-full flex flex-col">
            <div className="flex items-center gap-2 px-3 py-1 bg-secondary border-b border-border shrink-0">
              <span className="text-sm">{getAgentEmoji(maximizedAgent)}</span>
              <span className="text-xs font-medium text-foreground">{getAgentTitle(maximizedAgent)}</span>
              <div className="flex-1" />
              <button
                onClick={() => handlePopout(maximizedAgent)}
                className="p-1 hover:bg-primary/10 text-muted-foreground hover:text-foreground"
                title="Pop out"
              >
                <ExternalLink className="w-3 h-3" />
              </button>
              <button
                onClick={() => setMaximizedAgent(null)}
                className="p-1 hover:bg-primary/10 text-muted-foreground hover:text-foreground"
                title="Restore"
              >
                <Minimize2 className="w-3 h-3" />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <TerminalTile agentId={maximizedAgent} />
            </div>
          </div>
        ) : (
          /* Mosaic tiling view */
          <div className="mosaic-terminal-view w-full h-full">
            <Mosaic<ViewId>
              renderTile={(id, path) => {
                const agent = agentMap.get(id);
                const statusClass = agent ? (STATUS_COLORS[agent.status] || STATUS_COLORS.idle) : STATUS_COLORS.idle;

                return (
                  <MosaicWindow<ViewId>
                    path={path}
                    title={getAgentTitle(id)}
                    renderToolbar={() => (
                      <div className="flex items-center gap-2 px-3 py-1 w-full bg-secondary border-b border-border select-none mosaic-custom-toolbar">
                        <span className="text-sm">{getAgentEmoji(id)}</span>
                        <span className="text-xs font-medium text-foreground truncate max-w-[120px]">
                          {getAgentTitle(id)}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 font-medium ${statusClass}`}>
                          {agent?.status || 'unknown'}
                        </span>
                        <div className="flex-1" />
                        <button
                          onClick={(e) => { e.stopPropagation(); handleMaximize(id); }}
                          className="p-1 hover:bg-primary/10 text-muted-foreground hover:text-foreground"
                          title="Maximize"
                        >
                          <Maximize2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handlePopout(id); }}
                          className="p-1 hover:bg-primary/10 text-muted-foreground hover:text-foreground"
                          title="Pop out to separate window"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRemoveFromMosaic(id); }}
                          className="p-1 hover:bg-primary/10 text-muted-foreground hover:text-foreground"
                          title="Close tile"
                        >
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
              onChange={handleChange}
              className=""
            />
          </div>
        )}
      </div>
    </div>
  );
}
