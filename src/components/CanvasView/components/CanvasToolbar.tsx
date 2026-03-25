

import React from 'react';
import {
  FolderGit2,
  Filter,
  Search,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SuperAgentButton } from './SuperAgentButton';

interface CanvasToolbarProps {
  filter: 'all' | 'running' | 'inactive' | 'dormant';
  setFilter: (filter: 'all' | 'running' | 'inactive' | 'dormant') => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  projectFilter: string;
  setProjectFilter: (project: string) => void;
  projects: { path: string; name: string }[];
  onResetView: () => void;
  zoom: number;
  setZoom: (zoom: number) => void;
  superAgent: { id: string; processState: string } | null;
  isCreatingSuperAgent: boolean;
  onSuperAgentClick: () => void;
  showSuperAgentButton: boolean;
}

export function CanvasToolbar({
  filter,
  setFilter,
  searchQuery,
  setSearchQuery,
  projectFilter,
  setProjectFilter,
  projects,
  onResetView,
  zoom,
  setZoom,
  superAgent,
  isCreatingSuperAgent,
  onSuperAgentClick,
  showSuperAgentButton,
}: CanvasToolbarProps) {
  return (
    <div className="absolute top-3 left-3 right-3 lg:top-4 lg:left-4 lg:right-4 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-2 z-40">
      {/* Left side - Search & Filter */}
      <div className="flex items-center gap-2 lg:gap-3 overflow-x-auto">
        {/* Search - hidden on mobile */}
        <div className="relative hidden sm:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-4 py-2 bg-card/90 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 w-40"
          />
        </div>

        {/* Project filter dropdown */}
        <div className="relative">
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="pl-3 pr-8 py-2 bg-card/90 border border-border text-xs lg:text-sm text-foreground focus:outline-none focus:border-primary/50 appearance-none cursor-pointer min-w-[100px] lg:min-w-[140px]"
          >
            <option value="all">All Projects</option>
            {projects.map((p) => (
              <option key={p.path} value={p.path}>
                {p.name}
              </option>
            ))}
          </select>
          <FolderGit2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-0.5 lg:gap-1 p-1 bg-card/90 border border-border">
          <Filter className="w-4 h-4 text-muted-foreground ml-1 lg:ml-2 hidden sm:block" />
          {(['all', 'running', 'inactive', 'dormant'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-2 lg:px-3 py-1.5 text-[10px] lg:text-xs font-medium transition-all',
                filter === f
                  ? 'bg-primary/20 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {f === 'all' ? 'All' : f === 'running' ? 'Run' : f === 'inactive' ? 'Idle' : 'Sleep'}
            </button>
          ))}
        </div>
      </div>

      {/* Right side - View controls */}
      <div className="flex items-center gap-2 justify-end">
        {showSuperAgentButton && (
          <SuperAgentButton
            superAgent={superAgent}
            isCreating={isCreatingSuperAgent}
            onClick={onSuperAgentClick}
          />
        )}
        <div className="flex items-center gap-1 p-1 bg-card/90 border border-border">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setZoom(Math.max(0.3, zoom - 0.1))}
          >
            <ZoomOut className="w-4 h-4" />
          </Button>
          <span className="px-1.5 lg:px-2 text-[10px] lg:text-xs text-muted-foreground min-w-[2.5rem] lg:min-w-[3rem] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setZoom(Math.min(2, zoom + 0.1))}
          >
            <ZoomIn className="w-4 h-4" />
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 bg-card/90 border border-border"
          onClick={onResetView}
          title="Reset view"
        >
          <RotateCcw className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
