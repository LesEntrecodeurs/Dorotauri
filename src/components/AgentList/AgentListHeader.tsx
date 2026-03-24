import { Plus, Crown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AgentStatus } from '@/types/electron';

interface AgentListHeaderProps {
  superAgent: AgentStatus | null;
  isCreatingSuperAgent: boolean;
  onSuperAgentClick: () => void;
  onNewAgentClick: () => void;
}

export function AgentListHeader({
  superAgent,
  isCreatingSuperAgent,
  onSuperAgentClick,
  onNewAgentClick,
}: AgentListHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 lg:mb-6">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold tracking-tight text-foreground">AI Agents Control Center</h1>
        <p className="text-muted-foreground text-xs lg:text-sm mt-1 hidden sm:block">
          Dorothy is watching you AI Agents.
        </p>
      </div>
      <div className="flex items-center gap-2">
        {/* Super Agent Button */}
        <Button
          onClick={onSuperAgentClick}
          disabled={isCreatingSuperAgent}
          variant="outline"
          size="sm"
          className={`
            gap-1.5 font-medium transition-all
            ${superAgent
              ? superAgent.status === 'running' || superAgent.status === 'waiting'
                ? 'bg-green-500/20 border-green-500/50 text-green-700 hover:bg-green-500/30 shadow-lg shadow-green-500/20'
                : 'bg-secondary border-green-500/30 text-green-600 hover:bg-green-500/10 hover:border-green-500/50'
              : 'bg-secondary border-border text-muted-foreground hover:bg-secondary/80 hover:border-green-500/50 hover:text-green-600'
            }
          `}
          title={superAgent ? `Super Agent (${superAgent.status})` : 'Create Super Agent'}
        >
          {isCreatingSuperAgent ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-green-500" />
          ) : (
            <div className="relative">
              <Crown className={`w-3.5 h-3.5 ${superAgent ? 'text-amber-400' : ''}`} />
              {superAgent && (
                <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-secondary ${superAgent.status === 'running' ? 'bg-green-400 animate-pulse' :
                  superAgent.status === 'waiting' ? 'bg-amber-400 animate-pulse' :
                    superAgent.status === 'error' ? 'bg-red-400' :
                      superAgent.status === 'completed' ? 'bg-cyan-400' :
                        'bg-zinc-500'
                  }`} />
              )}
            </div>
          )}
          <span className="hidden sm:inline">
            {isCreatingSuperAgent ? 'Creating...' : 'Super Agent'}
          </span>
        </Button>

        {/* New Agent Button */}
        <Button
          onClick={onNewAgentClick}
          size="sm"
          className="gap-1.5 font-medium"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">New Agent</span>
          <span className="sm:hidden">New</span>
        </Button>
      </div>
    </div>
  );
}
