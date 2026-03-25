import { useMemo } from 'react';
import type { Agent } from '@/types/electron';
import { isSuperAgentCheck, getStatusPriority } from '@/components/AgentList/constants';

interface UseAgentFilteringProps {
  agents: Agent[];
  projectFilter: string | null;
  statusFilter?: string | null;
  searchQuery?: string;
  sortBy?: 'status' | 'activity' | 'name';
}

interface UniqueProject {
  path: string;
  name: string;
}

export function useAgentFiltering({ agents, projectFilter, statusFilter, searchQuery, sortBy = 'status' }: UseAgentFilteringProps) {
  const uniqueProjects = useMemo(() => {
    const projectSet = new Map<string, string>();
    agents.forEach((agent) => {
      const projectName = agent.cwd.split('/').pop() || 'Unknown';
      projectSet.set(agent.cwd, projectName);
    });
    return Array.from(projectSet.entries()).map(([path, name]) => ({ path, name }));
  }, [agents]);

  const filteredAgents = useMemo(() => {
    let filtered = projectFilter ? agents.filter(a => a.cwd === projectFilter) : agents;

    if (statusFilter) {
      filtered = filtered.filter(a => a.processState === statusFilter);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(a => {
        const name = (a.name || '').toLowerCase();
        const project = (a.cwd.split('/').pop() || '').toLowerCase();
        const task = (a.businessState || a.statusLine || '').toLowerCase();
        return name.includes(q) || project.includes(q) || task.includes(q);
      });
    }

    return [...filtered].sort((a, b) => {
      const aIsSuper = isSuperAgentCheck(a);
      const bIsSuper = isSuperAgentCheck(b);
      if (aIsSuper && !bIsSuper) return -1;
      if (!aIsSuper && bIsSuper) return 1;

      if (sortBy === 'name') {
        return (a.name || '').localeCompare(b.name || '');
      }
      if (sortBy === 'activity') {
        return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
      }
      // Default: status priority
      const aPriority = getStatusPriority(a.processState);
      const bPriority = getStatusPriority(b.processState);
      return aPriority - bPriority;
    });
  }, [agents, projectFilter, statusFilter, searchQuery, sortBy]);

  return {
    filteredAgents,
    uniqueProjects,
  };
}
