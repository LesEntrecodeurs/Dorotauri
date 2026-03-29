

import { Activity, MessageSquare, FolderKanban } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { HistoryEntry, ClaudeProject } from '@/lib/claude-code';

interface LiveActivityFeedProps {
  history: HistoryEntry[];
  projects: ClaudeProject[];
}

export default function LiveActivityFeed({ history, projects }: LiveActivityFeedProps) {
  // Get recent history items sorted by timestamp
  const recentHistory = [...history]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 10);

  const getProjectName = (projectPath: string) => {
    const project = projects.find(p => p.path === projectPath);
    if (project) return project.name;
    return projectPath.split('/').pop() || projectPath;
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const truncateMessage = (message: string, maxLength = 100) => {
    if (message.length <= maxLength) return message;
    return message.slice(0, maxLength) + '...';
  };

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <CardHeader className="px-5 py-4 border-b border-border flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-success" />
          <CardTitle className="text-sm font-medium">Recent Activity</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
          </span>
          <span className="text-xs text-muted-foreground">Live</span>
        </div>
      </CardHeader>

      {/* Activity List */}
      <CardContent className="p-0 divide-y divide-border max-h-80 overflow-y-auto">
        <>
          {recentHistory.map((entry, index) => (
            <div
              key={`${entry.timestamp}-${index}`}
              className="animate-mount-fade-up animate-stagger px-5 py-4 hover:bg-muted/50 transition-colors"
              style={{ '--stagger-index': index } as React.CSSProperties}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 p-1.5 bg-primary/10">
                  <MessageSquare className="w-3.5 h-3.5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground line-clamp-2">
                    {truncateMessage(entry.display)}
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <FolderKanban className="w-3 h-3" />
                      {getProjectName(entry.project)}
                    </span>
                    <span>{formatTime(entry.timestamp)}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </>

        {recentHistory.length === 0 && (
          <div className="px-5 py-8 text-center text-muted-foreground">
            <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No recent activity</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
