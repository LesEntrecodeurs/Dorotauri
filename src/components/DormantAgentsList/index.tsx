import { useState } from 'react';
import { Power, Trash2, Clock, FolderOpen, Moon } from 'lucide-react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Agent } from '@/types/electron';
import { CHARACTER_FACES } from '@/components/AgentList/constants';

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface DormantAgentsListProps {
  agents: Agent[];
  onReanimate: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function DormantAgentsList({ agents, onReanimate, onDelete }: DormantAgentsListProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Moon className="w-10 h-10 text-muted-foreground/20 mb-3" />
        <p className="text-sm text-muted-foreground">No dormant agents</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 pb-4">
      {agents.map((agent) => {
        const emoji = agent.character ? (CHARACTER_FACES[agent.character] || '🤖') : '🤖';
        const displayName = agent.name || `Agent ${agent.id.slice(0, 6)}`;
        const isConfirming = confirmDeleteId === agent.id;

        return (
          <Card
            key={agent.id}
            className="group relative transition-all hover:bg-accent/10 shadow-sm border-l-[3px] border-l-zinc-500/40"
          >
            <CardContent className="p-3">
              {/* Row 1: Avatar + Name + Dormant badge */}
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 flex items-center justify-center shrink-0 text-base bg-zinc-500/20 opacity-60">
                  {emoji}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-sm truncate text-foreground/70">
                      {displayName}
                    </span>
                  </div>
                  {agent.role && (
                    <p className="text-[11px] text-muted-foreground/60 truncate">{agent.role}</p>
                  )}
                </div>

                <Badge
                  variant="secondary"
                  className="text-[11px] px-2 py-0.5 font-medium shrink-0 bg-zinc-500/20 text-zinc-400"
                >
                  dormant
                </Badge>
              </div>

              {/* Row 2: Working directory */}
              <p className="text-[11px] text-muted-foreground/60 mt-2 truncate font-mono flex items-center gap-1" title={agent.cwd}>
                <FolderOpen className="w-3 h-3 shrink-0" />
                {agent.cwd}
              </p>

              {/* Row 3: Business state if set */}
              {agent.businessState && (
                <p className="text-xs text-muted-foreground/50 mt-1.5 line-clamp-2 leading-relaxed italic">
                  {agent.businessState}
                </p>
              )}
            </CardContent>

            {/* Footer: timestamp + actions */}
            <CardFooter className="px-3 py-2 border-t border-border/40 flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatTimeAgo(agent.lastActivity)}
              </span>

              <div className="flex items-center gap-0.5">
                <Button
                  onClick={() => onReanimate(agent.id)}
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 hover:bg-primary/10"
                  title="Reanimate agent"
                >
                  <Power className="w-3.5 h-3.5 text-primary" />
                </Button>

                {isConfirming ? (
                  <div className="flex items-center gap-1">
                    <Button
                      onClick={() => {
                        onDelete(agent.id);
                        setConfirmDeleteId(null);
                      }}
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[11px] text-red-400 hover:bg-red-500/10"
                    >
                      Confirm
                    </Button>
                    <Button
                      onClick={() => setConfirmDeleteId(null)}
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[11px] text-muted-foreground"
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    onClick={() => setConfirmDeleteId(agent.id)}
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 hover:bg-red-500/10"
                    title="Delete agent"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-red-400" />
                  </Button>
                )}
              </div>
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
}
