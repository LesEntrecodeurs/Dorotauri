

import { useRef, useEffect, useCallback } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { Agent } from '@/types/electron';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import TerminalPanelHeader from './TerminalPanelHeader';

interface TerminalPanelProps {
  agent: Agent;
  isFullscreen: boolean;
  isBroadcasting: boolean;
  isFocused: boolean;
  tabType: 'custom' | 'project';
  onRegisterContainer: (agentId: string, container: HTMLDivElement | null) => void;
  onStart: (agentId: string) => void;
  onStop: (agentId: string) => void;
  onRemove: (agentId: string) => void;
  onClear: (agentId: string) => void;
  onFullscreen: (agentId: string) => void;
  onExitFullscreen: () => void;
  onFocus: (agentId: string) => void;
  onContextMenu: (e: React.MouseEvent, agentId: string) => void;
}

export default function TerminalPanel({
  agent,
  isFullscreen,
  isBroadcasting,
  isFocused,
  tabType,
  onRegisterContainer,
  onStart,
  onStop,
  onRemove,
  onClear,
  onFullscreen,
  onExitFullscreen,
  onFocus,
  onContextMenu,
}: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onRegisterRef = useRef(onRegisterContainer);
  onRegisterRef.current = onRegisterContainer;

  // Make this panel a drop target for skills
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `panel-${agent.id}`,
    data: { type: 'terminal-panel', agentId: agent.id },
  });

  // Register container for xterm mounting — only on mount or agent ID change.
  // Uses a ref for the callback to avoid re-registering when the parent
  // re-creates the callback (e.g. on agents poll or font size change).
  useEffect(() => {
    if (containerRef.current) {
      onRegisterRef.current(agent.id, containerRef.current);
    }
  }, [agent.id]);

  const handleClick = useCallback(() => {
    onFocus(agent.id);
  }, [agent.id, onFocus]);

  const handleStart = useCallback(() => onStart(agent.id), [agent.id, onStart]);
  const handleStop = useCallback(() => onStop(agent.id), [agent.id, onStop]);
  const handleRemove = useCallback(() => onRemove(agent.id), [agent.id, onRemove]);
  const handleClear = useCallback(() => onClear(agent.id), [agent.id, onClear]);
  const handleFullscreen = useCallback(() => onFullscreen(agent.id), [agent.id, onFullscreen]);
  const handleContextMenu = useCallback((e: React.MouseEvent) => onContextMenu(e, agent.id), [agent.id, onContextMenu]);

  return (
    <Card
      ref={setDropRef}
      className={cn(
        'flex flex-col overflow-hidden h-full border bg-card',
        isOver && 'border-accent shadow-[0_0_15px_rgba(205,127,74,0.2)]',
        !isOver && isFocused && 'border-primary shadow-[0_0_10px_rgba(61,155,148,0.1)]',
        !isOver && !isFocused && 'border-border',
        isFullscreen && 'fixed inset-0 z-50',
      )}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {/* Header */}
      <TerminalPanelHeader
        agent={agent}
        isFullscreen={isFullscreen}
        isBroadcasting={isBroadcasting}
        tabType={tabType}
        onStart={handleStart}
        onStop={handleStop}
        onFullscreen={handleFullscreen}
        onExitFullscreen={onExitFullscreen}
        onClear={handleClear}
        onRemove={handleRemove}
        onContextMenu={handleContextMenu}
      />

      {/* Terminal body */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden relative bg-background"
      />
    </Card>
  );
}
