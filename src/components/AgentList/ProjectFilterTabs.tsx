import { Layers, FolderOpen } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface UniqueProject {
  path: string;
  name: string;
}

interface ProjectFilterTabsProps {
  uniqueProjects: UniqueProject[];
  projectFilter: string | null;
  totalAgentCount: number;
  agentCountByProject: (path: string) => number;
  onFilterChange: (path: string | null) => void;
}

export function ProjectFilterTabs({
  uniqueProjects,
  projectFilter,
  totalAgentCount,
  agentCountByProject,
  onFilterChange,
}: ProjectFilterTabsProps) {
  if (uniqueProjects.length === 0) return null;

  return (
    <Tabs
      value={projectFilter ?? '__all__'}
      onValueChange={(val) => onFilterChange(val === '__all__' ? null : val)}
      className="mb-3"
    >
      <TabsList className="h-auto flex-wrap gap-1 bg-transparent p-0">
        {/* All tab */}
        <TabsTrigger
          value="__all__"
          className="gap-1.5 px-2 py-1 text-xs font-medium data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=inactive]:bg-secondary data-[state=inactive]:border data-[state=inactive]:border-border"
        >
          <Layers className="w-3 h-3" />
          All Projects
          <span className="px-1 py-px text-[10px] bg-black/10 data-[state=inactive]:bg-white/10">
            {totalAgentCount}
          </span>
        </TabsTrigger>

        {/* Project tabs */}
        {uniqueProjects.map(({ path, name }) => {
          const agentCount = agentCountByProject(path);

          return (
            <TabsTrigger
              key={path}
              value={path}
              className="gap-1.5 px-2 py-1 text-xs font-medium data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=inactive]:bg-secondary data-[state=inactive]:border data-[state=inactive]:border-border"
              title={path}
            >
              <FolderOpen className="w-3 h-3" />
              <span className="truncate max-w-[120px]">{name}</span>
              <span className="px-1 py-px text-[10px] bg-black/10 data-[state=inactive]:bg-white/10">
                {agentCount}
              </span>
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
