

import React from 'react';
import { Bot, FolderGit2 } from 'lucide-react';

interface CanvasStatusBarProps {
  agentCount: number;
  runningCount: number;
  projectCount: number;
  waitingCount: number;
}

export function CanvasStatusBar({ agentCount, runningCount, projectCount, waitingCount }: CanvasStatusBarProps) {
  return (
    <div className="absolute bottom-3 left-3 lg:bottom-4 lg:left-4 flex items-center gap-3 lg:gap-6 px-3 lg:px-4 py-2 bg-card/90 border border-border text-[10px] lg:text-xs text-muted-foreground z-40">
      <div className="flex items-center gap-1.5 lg:gap-2">
        <Bot className="w-3.5 h-3.5 lg:w-4 lg:h-4 text-primary" />
        <span>{agentCount}</span>
        {runningCount > 0 && <span className="text-success hidden sm:inline">({runningCount} run)</span>}
        {waitingCount > 0 && <span className="text-warning">({waitingCount} wait)</span>}
      </div>
      <div className="flex items-center gap-1.5 lg:gap-2 hidden sm:flex">
        <FolderGit2 className="w-3.5 h-3.5 lg:w-4 lg:h-4 text-chart-2" />
        <span>{projectCount}</span>
      </div>
    </div>
  );
}
