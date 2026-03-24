import {
  Bot,
  Cpu,
  FolderOpen,
  Clock,
  GitBranch,
  AlertTriangle,
  Square,
  Play,
  Trash2,
  Sparkles,
  Terminal as TerminalIcon,
  Loader2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { AgentStatus } from '@/types/electron';
import { STATUS_COLORS, CHARACTER_FACES } from '@/components/AgentList/constants';

interface AgentDetailPanelProps {
  agent: AgentStatus;
  terminalRef: React.RefObject<HTMLDivElement | null>;
  terminalReady: boolean;
  onStop: () => void;
  onStart: () => void;
  onRemove: () => void;
}

export function AgentDetailPanel({
  agent,
  terminalRef,
  terminalReady,
  onStop,
  onStart,
  onRemove,
}: AgentDetailPanelProps) {
  const statusConfig = STATUS_COLORS[agent.status];

  return (
    <>
      {/* Agent Header */}
      <div className="px-3 lg:px-5 py-3 lg:py-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-muted/30">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 ${agent.name?.toLowerCase() === 'bitwonka' ? 'bg-success/20' : statusConfig.bg} flex items-center justify-center relative`}>
            {agent.name?.toLowerCase() === 'bitwonka' ? (
              <span className="text-2xl">🐸</span>
            ) : agent.character ? (
              <span className="text-2xl">{CHARACTER_FACES[agent.character] || '🤖'}</span>
            ) : agent.status === 'running' ? (
              <Cpu className={`w-6 h-6 ${statusConfig.text} animate-pulse`} />
            ) : (
              <Bot className={`w-6 h-6 ${statusConfig.text}`} />
            )}
            {agent.status === 'running' && (
              <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-primary animate-pulse border border-secondary" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{agent.name || agent.projectPath.split('/').pop()}</h3>
              {agent.provider && agent.provider !== 'claude' && agent.provider !== 'local' && (
                <Badge
                  variant="secondary"
                  className={`text-[10px] px-1.5 py-0.5 font-medium uppercase tracking-wider ${
                    agent.provider === 'codex' ? 'bg-green-500/15 text-green-600 dark:text-green-400' :
                    agent.provider === 'gemini' ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400' :
                    'bg-muted text-muted-foreground'
                  }`}
                >
                  {agent.provider}
                </Badge>
              )}
              {agent.branchName && (
                <Badge variant="secondary" className="gap-1 bg-purple-500/20 text-purple-600 dark:text-purple-400 text-xs">
                  <GitBranch className="w-3 h-3" />
                  {agent.branchName}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
              <span className="flex items-center gap-1">
                <FolderOpen className="w-3 h-3" />
                {agent.worktreePath || agent.projectPath}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {(() => {
                  try {
                    const date = new Date(agent.lastActivity);
                    if (isNaN(date.getTime())) return 'Just now';
                    return date.toLocaleTimeString();
                  } catch {
                    return 'Just now';
                  }
                })()}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {agent.pathMissing && (
            <div className="flex items-center gap-2 px-2 lg:px-3 py-1 lg:py-1.5 bg-warning/20 text-warning text-xs lg:text-sm">
              <AlertTriangle className="w-3 h-3 lg:w-4 lg:h-4" />
              <span className="hidden sm:inline">Path not found</span>
            </div>
          )}
          {agent.status === 'running' ? (
            <Button
              onClick={onStop}
              variant="ghost"
              size="sm"
              className="gap-1.5 lg:gap-2 bg-destructive/20 text-destructive hover:bg-destructive/30 text-xs lg:text-sm"
            >
              <Square className="w-3 h-3 lg:w-4 lg:h-4" />
              Stop
            </Button>
          ) : (
            <Button
              onClick={onStart}
              disabled={agent.pathMissing}
              variant="ghost"
              size="sm"
              className={`gap-1.5 lg:gap-2 text-xs lg:text-sm ${
                agent.pathMissing
                  ? 'bg-muted text-muted-foreground cursor-not-allowed'
                  : 'bg-success/20 text-success hover:bg-success/30'
              }`}
            >
              <Play className="w-3 h-3 lg:w-4 lg:h-4" />
              Start
            </Button>
          )}
          <Button
            onClick={onRemove}
            variant="ghost"
            size="sm"
            className="gap-1.5 lg:gap-2 bg-muted text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="w-3 h-3 lg:w-4 lg:h-4" />
          </Button>
        </div>
      </div>

      {/* Skills Bar */}
      {agent.skills.length > 0 && (
        <div className="px-5 py-2 border-b border-border bg-purple-500/5 flex items-center gap-2 overflow-x-auto">
          <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
          <span className="text-xs text-muted-foreground shrink-0">Skills:</span>
          {agent.skills.map((skill) => (
            <Badge
              key={skill}
              variant="secondary"
              className="bg-purple-500/20 text-purple-600 dark:text-purple-400 text-xs shrink-0"
            >
              {skill}
            </Badge>
          ))}
        </div>
      )}

      {/* Live Terminal Output with xterm */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        <div
          ref={terminalRef}
          className="absolute inset-0 bg-[#1A1726] p-2"
          style={{ cursor: 'text' }}
        />
        {!terminalReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#1A1726]">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Initializing terminal...</span>
            </div>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="px-4 py-2 border-t border-border bg-muted flex items-center justify-between text-xs">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <TerminalIcon className="w-4 h-4 text-primary" />
            <span className="text-muted-foreground">Interactive Terminal</span>
          </div>
          {agent.status === 'running' && (
            <span className="flex items-center gap-1 text-primary">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              Agent is running
            </span>
          )}
          {agent.status === 'waiting' && (
            <span className="flex items-center gap-1 text-warning">
              <span className="w-2 h-2 rounded-full bg-warning animate-pulse" />
              Waiting for input
            </span>
          )}
        </div>
        <span className="text-muted-foreground">
          Type directly in terminal to interact
        </span>
      </div>
    </>
  );
}
