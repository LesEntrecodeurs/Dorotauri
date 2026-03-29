

import { Bot, Pause, Play, Square, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useStore } from '@/store';
import type { AgentStatus } from '@/types';
import { Link } from 'react-router';

const statusConfig: Record<AgentStatus | string, { icon: typeof Bot; color: string; bg: string; label: string }> = {
  inactive: { icon: Square, color: 'text-muted-foreground', bg: 'bg-muted-foreground/20', label: 'Idle' },
  running: { icon: Play, color: 'text-success', bg: 'bg-success/20', label: 'Running' },
  paused: { icon: Pause, color: 'text-warning', bg: 'bg-warning/20', label: 'Paused' },
  error: { icon: AlertTriangle, color: 'text-destructive', bg: 'bg-destructive/20', label: 'Error' },
  completed: { icon: Square, color: 'text-primary', bg: 'bg-primary/20', label: 'Completed' },
  dormant: { icon: Square, color: 'text-muted-foreground', bg: 'bg-muted-foreground/20', label: 'Dormant' },
};

const modelColors: Record<string, string> = {
  opus: 'text-primary bg-primary/10',
  sonnet: 'text-primary bg-primary/10',
  haiku: 'text-success bg-success/10',
};

export default function AgentActivity() {
  const { agents, projects, tasks } = useStore();

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <CardHeader className="px-5 py-4 border-b border-border flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-primary" />
          <CardTitle className="text-sm font-medium">Agent Activity</CardTitle>
        </div>
        <Link to="/agents" className="text-xs text-primary hover:underline">
          View all &rarr;
        </Link>
      </CardHeader>

      {/* Agent List */}
      <CardContent className="p-0 divide-y divide-border">
        {agents.slice(0, 4).map((agent, index) => {
          const config = statusConfig[agent.processState];
          const StatusIcon = config.icon;
          const project = projects.find(p => p.id === agent.assignedProject);
          const agentTask = tasks.find(t => t.id === agent.businessState);

          return (
            <div
              key={agent.id}
              className="animate-mount-fade-up px-5 py-4 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-start gap-3">
                {/* Avatar */}
                <div className={`relative w-10 h-10 ${config.bg} flex items-center justify-center`}>
                  <Bot className={`w-5 h-5 ${config.color}`} />
                  {agent.processState === 'running' && (
                    <span className="absolute -bottom-1 -right-1 w-3 h-3 bg-success rounded-full border border-card">
                      <span className="absolute inset-0 rounded-full bg-success animate-ping opacity-75" />
                    </span>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{agent.name}</span>
                    <Badge variant="secondary" className={`text-[10px] px-1.5 py-0.5 ${modelColors[agent.model]}`}>
                      {agent.model.toUpperCase()}
                    </Badge>
                    <Badge variant="secondary" className={`text-[10px] px-1.5 py-0.5 ${config.bg} ${config.color}`}>
                      {config.label}
                    </Badge>
                  </div>

                  {project && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Working on <span className="text-muted-foreground">{project.name}</span>
                    </p>
                  )}

                  {agentTask && agent.processState === 'running' && (
                    <div className="mt-2 p-2 bg-muted/50 border border-border">
                      <p className="text-xs text-muted-foreground truncate">{agentTask.title}</p>
                      <div className="mt-1.5 h-1 bg-background overflow-hidden">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${agentTask.progress}%`, transition: 'width 500ms ease' }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Stats row */}
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span>{(agent.tokensUsed / 1000).toFixed(0)}k tokens</span>
                    <span>{agent.tasksCompleted} tasks done</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
