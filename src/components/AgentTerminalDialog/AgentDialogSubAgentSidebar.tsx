import { memo } from 'react';
import { Users, Folder, AlertTriangle, Circle } from 'lucide-react';
import type { Agent } from '@/types/electron';
import { CHARACTER_FACES } from './constants';
import { getChampionIconUrl } from '@/components/NewChatModal/constants';

interface AgentDialogSubAgentSidebarProps {
  agents: Agent[];
  projects: { path: string; name: string }[];
}

const STATUS_COLOR: Record<string, string> = {
  running: 'text-primary',
  completed: 'text-success',
  error: 'text-destructive',
};

const STATUS_BG_COLOR: Record<string, string> = {
  running: 'bg-primary/20',
  completed: 'bg-success/20',
  error: 'bg-destructive/20',
};

export const AgentDialogSubAgentSidebar = memo(function AgentDialogSubAgentSidebar({
  agents,
  projects,
}: AgentDialogSubAgentSidebarProps) {
  const otherAgents = agents;
  const runningAgents = otherAgents.filter(a => a.processState === 'running');
  const idleAgents = otherAgents.filter(a => a.processState === 'inactive' || a.processState === 'completed');
  const errorAgents = otherAgents.filter(a => a.processState === 'error');

  const faceOrIcon = (agent: Agent, size = 'text-lg') => {
    const iconUrl = agent.name ? getChampionIconUrl(agent.name) : null;
    if (iconUrl) return <img src={iconUrl} alt="" className="w-5 h-5 rounded-sm object-cover shrink-0" />;
    return <span className={size}>{CHARACTER_FACES[agent.character as keyof typeof CHARACTER_FACES] || '🤖'}</span>;
  };

  return (
    <div className="h-full overflow-y-auto">
      {/* Agents Section */}
      <div className="border-b border-border">
        <div className="px-3 py-2.5 flex items-center gap-2 bg-muted/30">
          <Users className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Agents</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
            {otherAgents.length}
          </span>
        </div>
        <div className="p-3 space-y-3">
          {runningAgents.length > 0 && (
            <div>
              <p className="text-[10px] text-primary mb-1.5 uppercase tracking-wide flex items-center gap-1">
                <Circle className="w-2 h-2 fill-accent-cyan animate-pulse" />
                Running ({runningAgents.length})
              </p>
              <div className="space-y-1">
                {runningAgents.map((agent) => (
                  <div key={agent.id} className="flex items-center gap-2 px-2 py-1.5 rounded-none bg-primary/10 border border-accent-cyan/20">
                    {faceOrIcon(agent)}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{agent.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {(agent.businessState || agent.statusLine)?.slice(0, 40) || agent.cwd.split('/').pop()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {errorAgents.length > 0 && (
            <div>
              <p className="text-[10px] text-destructive mb-1.5 uppercase tracking-wide flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Error ({errorAgents.length})
              </p>
              <div className="space-y-1">
                {errorAgents.map((agent) => (
                  <div key={agent.id} className="flex items-center gap-2 px-2 py-1.5 rounded-none bg-destructive/10 border border-accent-red/20">
                    {faceOrIcon(agent)}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{agent.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{agent.cwd.split('/').pop()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {idleAgents.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wide">
                Idle ({idleAgents.length})
              </p>
              <div className="space-y-1">
                {idleAgents.map((agent) => (
                  <div key={agent.id} className="flex items-center gap-2 px-2 py-1.5 rounded-none hover:bg-muted/50">
                    {faceOrIcon(agent)}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-muted-foreground truncate">{agent.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{agent.cwd.split('/').pop()}</p>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_BG_COLOR[agent.processState] || 'bg-text-muted/20'} ${STATUS_COLOR[agent.processState] || 'text-muted-foreground'}`}>
                      {agent.processState}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {otherAgents.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">No agents created yet</p>
          )}
        </div>
      </div>

      {/* Projects Section */}
      <div className="border-b border-border">
        <div className="px-3 py-2.5 flex items-center gap-2 bg-muted/30">
          <Folder className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Projects</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
            {projects.length}
          </span>
        </div>
        <div className="p-3">
          {projects.length > 0 ? (
            <div className="space-y-1">
              {projects.map((project) => {
                const projectAgents = otherAgents.filter(
                  a => a.cwd === project.path || a.worktreePath?.startsWith(project.path)
                );
                const runningCount = projectAgents.filter(a => a.processState === 'running').length;
                return (
                  <div key={project.path} className="flex items-center gap-2 px-2 py-1.5 rounded-none hover:bg-muted/50">
                    <Folder className="w-4 h-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{project.name}</p>
                      <p className="text-[10px] text-muted-foreground font-mono truncate">
                        {project.path.split('/').slice(-2).join('/')}
                      </p>
                    </div>
                    {projectAgents.length > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {projectAgents.length} agent{projectAgents.length !== 1 ? 's' : ''}
                        </span>
                        {runningCount > 0 && <span className="w-2 h-2 bg-primary rounded-full animate-pulse" />}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">No projects added yet</p>
          )}
        </div>
      </div>
    </div>
  );
});
