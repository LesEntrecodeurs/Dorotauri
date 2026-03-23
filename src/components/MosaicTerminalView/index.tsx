import { useState, useCallback, useEffect, useMemo } from 'react';
import { Mosaic, MosaicWindow, MosaicNode, getLeaves, createRemoveUpdate, updateTree } from 'react-mosaic-component';
import 'react-mosaic-component/react-mosaic-component.css';
import './mosaic-theme.css';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@/hooks/useTauri';
import { ExternalLink } from 'lucide-react';
import type { AgentStatus as AgentStatusType } from '@/types/electron';
import { CHARACTER_FACES } from '@/components/AgentWorld/constants';
import TerminalTile from './TerminalTile';

type ViewId = string;

interface MosaicTerminalViewProps {
  agents: AgentStatusType[];
}

/** Build a balanced binary tree layout from a list of agent IDs. */
function buildLayout(agentIds: string[]): MosaicNode<string> | null {
  if (agentIds.length === 0) return null;
  if (agentIds.length === 1) return agentIds[0];
  const mid = Math.floor(agentIds.length / 2);
  return {
    direction: agentIds.length <= 2 ? 'row' : (agentIds.length <= 4 ? 'row' : 'row'),
    first: buildLayout(agentIds.slice(0, mid))!,
    second: buildLayout(agentIds.slice(mid))!,
    splitPercentage: 50,
  };
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

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-green-600/20 text-green-400',
  waiting: 'bg-amber-500/20 text-amber-400',
  idle: 'bg-gray-500/20 text-gray-400',
  error: 'bg-red-500/20 text-red-400',
  completed: 'bg-primary/20 text-primary',
};

export default function MosaicTerminalView({ agents }: MosaicTerminalViewProps) {
  const [layout, setLayout] = useState<MosaicNode<ViewId> | null>(null);
  const prevAgentIdsRef = useMemo(() => ({ current: '' }), []);

  // Build agent lookup map
  const agentMap = useMemo(() => {
    const map = new Map<string, AgentStatusType>();
    for (const agent of agents) {
      map.set(agent.id, agent);
    }
    return map;
  }, [agents]);

  // Rebuild layout when agent list changes
  useEffect(() => {
    const agentIds = agents.map(a => a.id);
    const key = agentIds.join(',');

    // Only rebuild when agent IDs actually change
    if (key === prevAgentIdsRef.current) return;
    prevAgentIdsRef.current = key;

    if (agentIds.length === 0) {
      setLayout(null);
      return;
    }

    // If we have an existing layout, check if we just need to add/remove tiles
    setLayout(prev => {
      if (!prev) return buildGridLayout(agentIds);

      const currentLeaves = new Set(getLeaves(prev));
      const newIds = new Set(agentIds);

      // If sets are identical, keep current layout (user may have rearranged)
      if (currentLeaves.size === newIds.size && agentIds.every(id => currentLeaves.has(id))) {
        return prev;
      }

      // Rebuild from scratch when agents change
      return buildGridLayout(agentIds);
    });
  }, [agents, prevAgentIdsRef]);

  const handlePopout = useCallback(async (agentId: string) => {
    if (!isTauri()) return;
    try {
      await invoke('window_popout', { agentId });
      // Remove this tile from the mosaic layout
      setLayout(prev => {
        if (!prev) return null;
        const leaves = getLeaves(prev);
        const remaining = leaves.filter(id => id !== agentId);
        if (remaining.length === 0) return null;
        return buildGridLayout(remaining);
      });
    } catch (err) {
      console.error('Failed to pop out window:', err);
    }
  }, []);

  const getAgentTitle = useCallback((id: string): string => {
    const agent = agentMap.get(id);
    if (!agent) return `Agent ${id.slice(0, 6)}`;
    return agent.name || `Agent ${id.slice(0, 6)}`;
  }, [agentMap]);

  const handleChange = useCallback((newLayout: MosaicNode<ViewId> | null) => {
    setLayout(newLayout);
  }, []);

  if (!layout) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No agents to display
      </div>
    );
  }

  return (
    <div className="mosaic-terminal-view w-full h-full">
      <Mosaic<ViewId>
        renderTile={(id, path) => {
          const agent = agentMap.get(id);
          const statusClass = agent ? (STATUS_COLORS[agent.status] || STATUS_COLORS.idle) : STATUS_COLORS.idle;
          const emoji = agent?.name?.toLowerCase() === 'bitwonka'
            ? '\uD83D\uDC38'
            : CHARACTER_FACES[agent?.character || 'robot'] || '\uD83E\uDD16';

          return (
            <MosaicWindow<ViewId>
              path={path}
              title={getAgentTitle(id)}
              renderToolbar={() => (
                <div className="flex items-center gap-2 px-3 py-1 w-full bg-secondary border-b border-border select-none mosaic-custom-toolbar">
                  {/* Agent identity */}
                  <span className="text-sm">{emoji}</span>
                  <span className="text-xs font-medium text-foreground truncate max-w-[120px]">
                    {getAgentTitle(id)}
                  </span>

                  {/* Status badge */}
                  <span className={`text-[10px] px-1.5 py-0.5 font-medium ${statusClass}`}>
                    {agent?.status || 'unknown'}
                  </span>

                  {/* Spacer */}
                  <div className="flex-1" />

                  {/* Session ID */}
                  <span className="text-[10px] text-muted-foreground font-mono hidden xl:inline">
                    {id.slice(0, 8)}
                  </span>

                  {/* Pop-out button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePopout(id);
                    }}
                    className="p-1 hover:bg-primary/10 transition-colors text-muted-foreground hover:text-foreground"
                    title="Pop out to separate window"
                  >
                    <ExternalLink className="w-3 h-3" />
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
  );
}
