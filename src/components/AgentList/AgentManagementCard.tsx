import { Play, Square, Pencil, Trash2, AlertTriangle, Clock } from 'lucide-react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Agent } from '@/types/electron';
import {
  STATUS_COLORS,
  STATUS_LABELS,
  CHARACTER_FACES,
  isSuperAgentCheck,
} from '@/components/AgentList/constants';
import { getChampionIconUrl } from '@/components/NewChatModal/constants';

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

interface AgentManagementCardProps {
  agent: Agent;
  onClick: () => void;
  onEdit: () => void;
  onStart: () => void;
  onStop: () => void;
  onRemove: () => void;
  agents?: Agent[];
}

export function AgentManagementCard({ agent, onClick, onEdit, onStart, onStop, onRemove, agents = [] }: AgentManagementCardProps) {
  const statusConfig = STATUS_COLORS[agent.processState];
  const isSuper = isSuperAgentCheck(agent);
  const isGlobalScope = isSuper && agent.superAgentScope === 'all';
  const isSubAgent = agent.parentId != null;
  const parentAgent = isSubAgent ? agents.find(a => a.id === agent.parentId) : undefined;
  const parentName = parentAgent?.name || agent.parentId || 'parent';
  const crownBadge = isSuper ? (isGlobalScope ? '\u{1F451}\u{1F451}' : '\u{1F451}') : '';
  const isRunning = agent.processState === 'running' || agent.processState === 'waiting';
  const isError = agent.processState === 'error';

  // Show the user's last prompt, not terminal output
  const lastPrompt = agent.businessState || agent.statusLine || null;

  return (
    <div style={{ marginLeft: isSubAgent ? 24 : 0 }}>
    <Card
      onClick={onClick}
      className={`
        group relative cursor-pointer transition-all hover:bg-accent/10 shadow-sm
        ${isSuper ? 'border-l-[3px] border-l-amber-500/60' : ''}
        ${isRunning && !isSuper ? 'border-l-[3px] border-l-primary/60' : ''}
        ${isError ? 'border-l-[3px] border-l-red-500/60' : ''}
        ${isGlobalScope ? 'ring-2 ring-amber-500/50' : ''}
        ${isSubAgent && !isSuper && !isRunning && !isError ? 'border-l-[3px] border-l-muted-foreground/30' : ''}
      `}
    >
      <CardContent className="p-3">
        {/* Row 1: Avatar + Name + Status (top-right) */}
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 flex items-center justify-center shrink-0 text-base overflow-hidden rounded-sm ${
            isSuper ? 'bg-gradient-to-br from-amber-500/30 to-yellow-600/20' : statusConfig.bg
          }`}>
            {isSuper ? (
              isGlobalScope ? '\u{1F451}\u{1F451}' : '\u{1F451}'
            ) : (() => {
              const iconUrl = agent.name ? getChampionIconUrl(agent.name) : null;
              if (iconUrl) return <img src={iconUrl} alt="" className="w-8 h-8 object-cover" />;
              return <span>{agent.character ? (CHARACTER_FACES[agent.character] || '\u{1F916}') : '\u{1F916}'}</span>;
            })()}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {crownBadge && <span className="text-xs shrink-0">{crownBadge}</span>}
              <span className={`text-sm truncate text-foreground ${isSuper ? 'font-bold' : 'font-medium'}`}>
                {agent.name || 'Unnamed Agent'}
              </span>
            </div>
          </div>

          {/* Status pill -- top right */}
          <Badge
            variant="secondary"
            className={`text-[11px] px-2 py-0.5 font-medium shrink-0 ${
              isSuper && isRunning
                ? 'bg-amber-500/20 text-amber-400'
                : `${statusConfig.bg} ${statusConfig.text}`
            }`}
          >
            {STATUS_LABELS[agent.processState]}
          </Badge>
        </div>

        {/* Row 2: Project path */}
        <p className="text-[11px] text-muted-foreground mt-2 truncate font-mono" title={agent.cwd}>
          {agent.cwd}
        </p>

        {/* Row 3: Last user prompt */}
        {agent.pathMissing ? (
          <p className="text-xs text-amber-500 flex items-center gap-1 mt-1.5">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            Path not found
          </p>
        ) : lastPrompt ? (
          <p className="text-xs text-muted-foreground/80 mt-1.5 line-clamp-2 leading-relaxed">
            {lastPrompt}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground/40 mt-1.5 italic">No task assigned</p>
        )}

        {/* Skills */}
        {agent.skills.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {agent.skills.map((skill) => (
              <Badge
                key={skill}
                variant="secondary"
                className="px-1.5 py-0.5 bg-purple-500/15 text-purple-600 dark:text-purple-400 text-[10px] truncate max-w-[100px]"
                title={skill}
              >
                {skill}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>

      {/* Footer: timestamp + actions */}
      <CardFooter className="px-3 py-2 border-t border-border/40 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatTimeAgo(agent.lastActivity)}
        </span>

        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {isRunning ? (
            <Button
              onClick={onStop}
              variant="ghost"
              size="icon"
              className="h-7 w-7 hover:bg-red-500/10"
              title="Stop agent"
            >
              <Square className="w-3.5 h-3.5 text-red-400" />
            </Button>
          ) : (
            <Button
              onClick={onStart}
              disabled={agent.pathMissing}
              variant="ghost"
              size="icon"
              className="h-7 w-7 hover:bg-primary/10 disabled:opacity-30"
              title="Start agent"
            >
              <Play className="w-3.5 h-3.5 text-primary" />
            </Button>
          )}
          <Button
            onClick={onEdit}
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Edit agent"
          >
            <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
          </Button>
          <Button
            onClick={onRemove}
            variant="ghost"
            size="icon"
            className="h-7 w-7 hover:bg-red-500/10"
            title="Remove agent"
          >
            <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-red-400" />
          </Button>
        </div>
      </CardFooter>
    </Card>
    {isSubAgent && (
      <p className="mt-0.5 pl-1 text-[10px] text-muted-foreground">
        delegated by {parentName}
      </p>
    )}
    </div>
  );
}
