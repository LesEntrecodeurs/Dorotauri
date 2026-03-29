

import React from 'react';
import { useAnimatePresence } from '@/hooks/useAnimatePresence';
import {
  Bot,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ChevronRight,
  ChevronLeft,
  Bell,
  Loader2,
  MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CHARACTER_EMOJIS } from '../constants';
import type { AgentNode } from '../types';

interface NotificationPanelProps {
  agents: AgentNode[];
  isCollapsed: boolean;
  onToggle: () => void;
  onOpenTerminal: (agentId: string) => void;
}

function AgentItem({
  agent,
  showAction = false,
  onOpenTerminal,
}: {
  agent: AgentNode;
  showAction?: boolean;
  onOpenTerminal: (agentId: string) => void;
}) {
  return (
    <div
      className={cn(
        'p-3 border transition-colors cursor-pointer hover:bg-secondary/50',
        agent.status === 'waiting'
          ? 'bg-warning/5 border-warning/30'
          : agent.status === 'running'
            ? 'bg-primary/5 border-primary/20'
            : agent.status === 'completed'
              ? 'bg-success/5 border-success/20'
              : agent.status === 'error'
                ? 'bg-destructive/5 border-destructive/20'
                : 'bg-secondary/30 border-border'
      )}
      onClick={() => onOpenTerminal(agent.id)}
    >
      <div className="flex items-start gap-2">
        <span className="text-lg">{CHARACTER_EMOJIS[agent.character] || '\u{1F916}'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-foreground truncate">{agent.name}</span>
            {agent.status === 'waiting' && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 bg-warning/20 text-warning border-warning/30">
                <AlertCircle className="w-3 h-3 mr-1" />
                Input needed
              </Badge>
            )}
            {agent.status === 'running' && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 bg-primary/20 text-primary border-primary/30">
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                Working
              </Badge>
            )}
            {agent.status === 'completed' && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 bg-success/20 text-success border-success/30">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Done
              </Badge>
            )}
            {agent.status === 'error' && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 bg-destructive/20 text-destructive border-destructive/30">
                <XCircle className="w-3 h-3 mr-1" />
                Error
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {agent.cwd.split('/').pop()}
          </p>
          {showAction && agent.status === 'waiting' && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 bg-warning/20 text-warning hover:bg-warning/30"
              onClick={(e) => { e.stopPropagation(); onOpenTerminal(agent.id); }}
            >
              <MessageSquare className="w-3 h-3" />
              Respond
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function NotificationPanel({
  agents,
  isCollapsed,
  onToggle,
  onOpenTerminal,
}: NotificationPanelProps) {
  const panelAnim = useAnimatePresence(!isCollapsed);

  const waitingAgents = agents.filter(a => a.status === 'waiting');
  const runningAgents = agents.filter(a => a.status === 'running');
  const completedAgents = agents.filter(a => a.status === 'completed');
  const errorAgents = agents.filter(a => a.status === 'error');

  return (
    <div
      className="absolute top-4 bottom-4 right-4 z-50 flex animate-panel-width"
      style={{ width: isCollapsed ? 48 : 320 }}
    >
      {/* Toggle button */}
      <button
        onClick={onToggle}
        className="flex items-center justify-center w-8 h-12 my-auto -mr-1 bg-card/95 border border-r-0 border-border hover:bg-secondary transition-colors z-10"
      >
        {isCollapsed ? (
          <div className="relative">
            <ChevronLeft className="w-4 h-4 text-muted-foreground" />
            {waitingAgents.length > 0 && (
              <span className="absolute -top-2 -right-2 w-4 h-4 flex items-center justify-center text-[10px] font-bold rounded-full bg-warning text-white">
                {waitingAgents.length}
              </span>
            )}
          </div>
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {/* Panel content */}
      {panelAnim.shouldRender && (
        <div
          data-state={panelAnim.animationState}
          className="animate-fade flex-1 bg-card/95 border border-border overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-border bg-secondary/30">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" />
              <span className="font-medium text-sm text-foreground">Activity</span>
              {waitingAgents.length > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-warning text-white font-bold">
                  {waitingAgents.length}
                </span>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            <>
              {/* Waiting agents */}
              {waitingAgents.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="w-3.5 h-3.5 text-warning" />
                    <span className="text-xs font-medium text-warning uppercase tracking-wide">
                      Needs Attention
                    </span>
                  </div>
                  <div className="space-y-2">
                    {waitingAgents.map(agent => (
                      <AgentItem key={agent.id} agent={agent} showAction onOpenTerminal={onOpenTerminal} />
                    ))}
                  </div>
                </div>
              )}

              {/* Running agents */}
              {runningAgents.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                    <span className="text-xs font-medium text-primary uppercase tracking-wide">
                      Working
                    </span>
                  </div>
                  <div className="space-y-2">
                    {runningAgents.map(agent => (
                      <AgentItem key={agent.id} agent={agent} onOpenTerminal={onOpenTerminal} />
                    ))}
                  </div>
                </div>
              )}

              {/* Completed agents */}
              {completedAgents.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                    <span className="text-xs font-medium text-success uppercase tracking-wide">
                      Completed
                    </span>
                  </div>
                  <div className="space-y-2">
                    {completedAgents.map(agent => (
                      <AgentItem key={agent.id} agent={agent} onOpenTerminal={onOpenTerminal} />
                    ))}
                  </div>
                </div>
              )}

              {/* Error agents */}
              {errorAgents.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <XCircle className="w-3.5 h-3.5 text-destructive" />
                    <span className="text-xs font-medium text-destructive uppercase tracking-wide">
                      Errors
                    </span>
                  </div>
                  <div className="space-y-2">
                    {errorAgents.map(agent => (
                      <AgentItem key={agent.id} agent={agent} onOpenTerminal={onOpenTerminal} />
                    ))}
                  </div>
                </div>
              )}
            </>

            {/* Empty state */}
            {agents.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Bot className="w-10 h-10 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">No agents yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Create an agent to see activity</p>
              </div>
            )}

            {/* All idle state */}
            {agents.length > 0 && waitingAgents.length === 0 && runningAgents.length === 0 && completedAgents.length === 0 && errorAgents.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center mb-3">
                  <Bot className="w-5 h-5 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">All agents idle</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Start an agent to see activity</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
