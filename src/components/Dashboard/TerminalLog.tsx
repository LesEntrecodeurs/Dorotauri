

import { Terminal, Circle } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { HistoryEntry } from '@/lib/claude-code';

interface TerminalLogProps {
  history: HistoryEntry[];
}

export default function TerminalLog({ history }: TerminalLogProps) {
  // Get last 15 entries sorted by timestamp
  const recentHistory = [...history]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-15);

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getProjectShortName = (projectPath: string) => {
    const name = projectPath.split('/').pop() || projectPath;
    return name.slice(0, 12);
  };

  const truncateMessage = (message: string, maxLength = 60) => {
    // Clean up message
    const cleaned = message.replace(/\n/g, ' ').trim();
    if (cleaned.length <= maxLength) return cleaned;
    return cleaned.slice(0, maxLength) + '...';
  };

  return (
    <Card className="overflow-hidden">
      {/* Header - looks like terminal titlebar */}
      <CardHeader className="px-4 py-3 border-b border-border bg-muted flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Circle className="w-3 h-3 fill-destructive text-destructive" />
            <Circle className="w-3 h-3 fill-warning text-warning" />
            <Circle className="w-3 h-3 fill-success text-success" />
          </div>
          <span className="text-xs text-muted-foreground ml-2">claude-history &mdash; zsh</span>
        </div>
        <Terminal className="w-4 h-4 text-muted-foreground" />
      </CardHeader>

      {/* Log content */}
      <CardContent className="p-4 h-64 overflow-y-auto font-mono text-xs leading-relaxed bg-background">
        <>
          {recentHistory.map((entry, index) => (
            <div
              key={`${entry.timestamp}-${index}`}
              className="animate-mount-fade-up flex items-start gap-2 py-0.5 hover:bg-muted/30"
            >
              <span className="text-muted-foreground shrink-0">{formatTime(entry.timestamp)}</span>
              <span className="text-primary shrink-0">[{getProjectShortName(entry.project)}]</span>
              <span className="text-primary shrink-0">$</span>
              <span className="text-muted-foreground">{truncateMessage(entry.display)}</span>
            </div>
          ))}
        </>

        {recentHistory.length === 0 && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="animate-pulse">&#9612;</span>
            <span>Waiting for activity...</span>
          </div>
        )}

        {/* Cursor line */}
        <div className="flex items-center gap-2 text-muted-foreground mt-1">
          <span className="text-primary">$</span>
          <span className="cursor-blink"></span>
        </div>
      </CardContent>
    </Card>
  );
}
