

import { useState } from 'react';
import {
  Play,
  Square,
  RotateCcw,
  Maximize2,
  Copy,
  ArrowRightFromLine,
  ChevronRight,
  Plus,
  Terminal,
} from 'lucide-react';
import type { ContextMenuState } from '../types';
import type { AgentStatus } from '@/types/electron';
import type { Tab } from '../../../types/electron.d';

interface ContextMenuProps {
  state: ContextMenuState;
  agent: AgentStatus | null;
  onClose: () => void;
  onStart: (agentId: string) => void;
  onStop: (agentId: string) => void;
  onClear: (agentId: string) => void;
  onFullscreen: (agentId: string) => void;
  onCopyOutput: (agentId: string) => void;
  tabs: Tab[];
  activeTabId: string | null;
  onMoveToTab: (agentId: string, targetTabId: string) => void;
  onMoveToNewTab: (agentId: string) => void;
  onNewAgent: () => void;
}

export default function ContextMenu({
  state,
  agent,
  onClose,
  onStart,
  onStop,
  onClear,
  onFullscreen,
  onCopyOutput,
  tabs,
  activeTabId,
  onMoveToTab,
  onMoveToNewTab,
  onNewAgent,
}: ContextMenuProps) {
  const [showTabSubmenu, setShowTabSubmenu] = useState(false);

  if (!state.open || !state.agentId || !agent) return null;

  const agentId = state.agentId;
  const isRunning = agent.status === 'running' || agent.status === 'waiting';

  // Other tabs to move to (exclude current)
  const otherTabs = tabs.filter(t => t.id !== activeTabId);

  const x = Math.min(state.x, window.innerWidth - 200);
  const itemCount = 7;
  const y = Math.min(state.y, window.innerHeight - itemCount * 36 - 20);

  const buttonClass = 'flex items-center gap-2.5 w-full px-3 py-1.5 text-xs transition-colors text-muted-foreground hover:bg-primary/5 hover:text-foreground';

  return (
    <div
      className="fixed z-[100] bg-card border border-border shadow-xl min-w-[180px] py-1"
      style={{ left: x, top: y }}
      onClick={e => e.stopPropagation()}
    >
      {/* Start/Stop */}
      <button
        onClick={() => { isRunning ? onStop(agentId) : onStart(agentId); onClose(); }}
        className={`flex items-center gap-2.5 w-full px-3 py-1.5 text-xs transition-colors ${isRunning ? 'text-red-400 hover:bg-red-500/10' : 'text-muted-foreground hover:bg-primary/5 hover:text-foreground'}`}
      >
        {isRunning ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        {isRunning ? 'Stop Agent' : 'Start Agent'}
      </button>

      {/* Clear */}
      <button onClick={() => { onClear(agentId); onClose(); }} className={buttonClass}>
        <RotateCcw className="w-3.5 h-3.5" />
        Clear Terminal
      </button>

      {/* Fullscreen */}
      <button onClick={() => { onFullscreen(agentId); onClose(); }} className={buttonClass}>
        <Maximize2 className="w-3.5 h-3.5" />
        Fullscreen
      </button>

      {/* Copy Output */}
      <button onClick={() => { onCopyOutput(agentId); onClose(); }} className={buttonClass}>
        <Copy className="w-3.5 h-3.5" />
        Copy Output
      </button>

      {/* Divider */}
      <div className="border-t border-border my-1" />

      {/* New Agent */}
      <button onClick={() => { onNewAgent(); onClose(); }} className={buttonClass}>
        <Plus className="w-3.5 h-3.5" />
        New Agent
      </button>

      {/* Move to Tab — always visible */}
      <div
        className="relative"
        onMouseEnter={() => setShowTabSubmenu(true)}
        onMouseLeave={() => setShowTabSubmenu(false)}
      >
        <button className={`${buttonClass} justify-between`}>
          <span className="flex items-center gap-2.5">
            <ArrowRightFromLine className="w-3.5 h-3.5" />
            Move to Tab
          </span>
          <ChevronRight className="w-3 h-3" />
        </button>

        {/* Submenu */}
        {showTabSubmenu && (
          <div
            className="absolute left-full top-0 bg-card border border-border shadow-xl min-w-[140px] py-1 -ml-px"
            style={{ maxHeight: 240, overflowY: 'auto' }}
          >
            {otherTabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => { onMoveToTab(agentId, tab.id); onClose(); }}
                className={buttonClass}
              >
                <Terminal className="w-3 h-3" />
                {tab.name}
              </button>
            ))}
            {/* Always offer "New Tab" */}
            <button
              onClick={() => { onMoveToNewTab(agentId); onClose(); }}
              className={buttonClass}
            >
              <Plus className="w-3 h-3" />
              New Tab
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
