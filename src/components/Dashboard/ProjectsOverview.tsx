

import { FolderKanban, MessageSquare, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from 'react-router';
import type { ClaudeProject } from '@/lib/claude-code';

interface ProjectsOverviewProps {
  projects: ClaudeProject[];
}

// Generate consistent colors for projects based on name
const getProjectColor = (name: string) => {
  const colors = [
    'hsl(265 75% 54%)', 'hsl(290 60% 50%)', 'hsl(160 60% 45%)', 'hsl(45 80% 50%)',
    'hsl(0 84% 60%)', 'hsl(200 80% 50%)', 'hsl(330 70% 55%)', 'hsl(160 60% 52%)',
  ];
  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
};

export default function ProjectsOverview({ projects }: ProjectsOverviewProps) {
  const formatDate = (date: Date) => {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <CardHeader className="px-5 py-4 border-b border-border flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <FolderKanban className="w-4 h-4 text-warning" />
          <CardTitle className="text-sm font-medium">Projects</CardTitle>
        </div>
        <Link to="/projects" className="text-xs text-primary hover:underline">
          View all &rarr;
        </Link>
      </CardHeader>

      {/* Projects List */}
      <CardContent className="p-0 divide-y divide-border max-h-80 overflow-y-auto">
        {projects.slice(0, 6).map((project, index) => {
          const color = getProjectColor(project.name);

          return (
            <div
              key={project.id}
              className="animate-mount-fade-up relative px-5 py-4 hover:bg-muted/50 transition-colors cursor-pointer"
            >
              {/* Color indicator */}
              <div
                className="absolute left-0 top-0 bottom-0 w-1"
                style={{ backgroundColor: color }}
              />

              <div className="pl-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <h4 className="font-medium text-sm truncate">{project.name}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate font-mono">
                      {project.path}
                    </p>
                  </div>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" />
                    <span>{project.sessions.length} sessions</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>{formatDate(project.lastActivity)}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {projects.length === 0 && (
          <div className="py-8 text-center text-muted-foreground">
            <FolderKanban className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No projects found</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
