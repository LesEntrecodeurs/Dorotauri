

import React, { useState, useRef, useEffect } from 'react';
import { useAnimatePresence } from '@/hooks/useAnimatePresence';
import {
  FolderGit2,
  GitBranch,
  GripVertical,
  MoreVertical,
  Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useDraggable } from '../hooks/useDraggable';
import type { ProjectNode } from '../types';

interface ProjectNodeCardProps {
  node: ProjectNode;
  isSelected: boolean;
  onSelect: () => void;
  onDrag: (delta: { x: number; y: number }) => void;
  onAddAgent: () => void;
}

export function ProjectNodeCard({
  node,
  isSelected,
  onSelect,
  onDrag,
  onAddAgent,
}: ProjectNodeCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const { isDragging, handleMouseDown, handleTouchStart, handleTouchMove, handleTouchEnd } = useDraggable(onDrag, onSelect);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMenu]);

  const agentCount = node.agentIds.length;
  const menuAnim = useAnimatePresence(showMenu);

  return (
    <div
      className={cn(
        'node-card absolute select-none touch-none animate-mount-fade-up',
        isDragging ? 'z-50 cursor-grabbing' : 'z-10 cursor-pointer'
      )}
      style={{ left: node.position.x, top: node.position.y }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <Card
        className={cn(
          'w-56 backdrop-blur-sm transition-all duration-200',
          isSelected
            ? 'bg-card/95 border-chart-2/50 shadow-lg shadow-chart-2/20'
            : 'bg-card/80 border-border hover:border-muted-foreground/30'
        )}
      >
        {/* Connection point */}
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-card border border-chart-2/50" />

        {/* Header */}
        <div className="flex items-center gap-2 p-3 border-b border-border">
          <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
          <FolderGit2 className="w-4 h-4 text-chart-2" />
          <span className="font-medium text-foreground truncate text-sm flex-1">{node.name}</span>
          {agentCount > 0 && (
            <Badge variant="outline" className="text-xs px-1.5 py-0.5 bg-primary/20 text-primary">
              {agentCount} agent{agentCount > 1 ? 's' : ''}
            </Badge>
          )}
          <div className="relative" ref={menuRef}>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
            >
              <MoreVertical className="w-4 h-4 text-muted-foreground" />
            </Button>
            {menuAnim.shouldRender && (
                <div
                  data-state={menuAnim.animationState}
                  className="animate-fade absolute right-0 top-full mt-1 w-40 bg-card border border-border shadow-xl z-50 overflow-hidden"
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMenu(false);
                      onAddAgent();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-secondary transition-colors"
                  >
                    <Plus className="w-4 h-4 text-primary" />
                    Add agent
                  </button>
                </div>
              )}
          </div>
        </div>

        {/* Content */}
        <div className="p-3 space-y-2">
          <div className="text-xs text-muted-foreground truncate">{node.path}</div>
          {node.branch && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <GitBranch className="w-3 h-3" />
              <span className="truncate">{node.branch}</span>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
