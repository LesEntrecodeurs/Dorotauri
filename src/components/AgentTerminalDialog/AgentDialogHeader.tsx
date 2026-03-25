import { memo } from 'react';
import { X, Maximize2, Minimize2, FolderOpen, GitBranch, Layers, Crown } from 'lucide-react';
import type { Agent } from '@/types/electron';
import { CHARACTER_FACES } from './constants';

interface AgentDialogHeaderProps {
  agent: Agent;
  character: string;
  isFullscreen: boolean;
  hasSecondaryProject: boolean;
  isSuperAgentMode: boolean;
  onOpenInFinder: () => void;
  onToggleFullscreen: () => void;
  onClose: () => void;
}

export const AgentDialogHeader = memo(function AgentDialogHeader({
  agent,
  character,
  isFullscreen,
  hasSecondaryProject,
  isSuperAgentMode,
  onOpenInFinder,
  onToggleFullscreen,
  onClose,
}: AgentDialogHeaderProps) {
  return (
    <div className="px-5 py-3 border-b border-border flex items-center justify-between bg-muted/30">
      <div className="flex items-center gap-3">
        <span className="text-2xl">
          {isSuperAgentMode ? '👑' : CHARACTER_FACES[character as keyof typeof CHARACTER_FACES] || '🤖'}
        </span>
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            {agent.name || 'Agent'}
            <span
              className={`
                text-xs px-2 py-0.5 rounded-full
                ${agent.processState === 'running' ? 'bg-primary/20 text-primary' : ''}
                ${agent.processState === 'inactive' ? 'bg-text-muted/20 text-muted-foreground' : ''}
                ${agent.processState === 'completed' ? 'bg-success/20 text-success' : ''}
                ${agent.processState === 'error' ? 'bg-destructive/20 text-destructive' : ''}
              `}
            >
              {agent.processState}
            </span>
          </h3>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {isSuperAgentMode ? (
              <span className="text-amber-400 flex items-center gap-1">
                <Crown className="w-3 h-3" />
                Orchestrator
              </span>
            ) : (
              <>
                <span className="font-mono truncate max-w-[200px]">
                  {agent.cwd.split('/').pop()}
                </span>
                {agent.branchName && (
                  <span className="text-primary flex items-center gap-1">
                    <GitBranch className="w-3 h-3" />
                    {agent.branchName}
                  </span>
                )}
                {hasSecondaryProject && (
                  <span className="text-amber-400 flex items-center gap-1">
                    <Layers className="w-3 h-3" />
                    +1 context
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {!isSuperAgentMode && (
          <>
            <button
              onClick={onOpenInFinder}
              className="p-2 hover:bg-muted rounded-none transition-colors"
              title="Open in Finder"
            >
              <FolderOpen className="w-4 h-4 text-muted-foreground" />
            </button>
            <div className="w-px h-5 bg-border-primary mx-1" />
          </>
        )}
        <button
          onClick={onToggleFullscreen}
          className="p-2 hover:bg-muted rounded-none transition-colors"
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
        <button
          onClick={onClose}
          className="p-2 hover:bg-muted rounded-none transition-colors"
          title="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
});
