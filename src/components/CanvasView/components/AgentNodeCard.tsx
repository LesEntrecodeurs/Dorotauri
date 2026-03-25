

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FolderGit2,
  Play,
  Square,
  Sparkles,
  Terminal,
  GripVertical,
  MoreVertical,
  Settings2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useDraggable } from '../hooks/useDraggable';
import { StatusIndicator } from './StatusIndicator';
import { STATUS_COLORS, CHARACTER_EMOJIS } from '../constants';
import type { AgentNode } from '../types';

interface AgentNodeCardProps {
  node: AgentNode;
  isSelected: boolean;
  onSelect: () => void;
  onDrag: (delta: { x: number; y: number }) => void;
  onOpenTerminal: () => void;
  onToggleAgent: () => void;
  onEdit: () => void;
}

export function AgentNodeCard({
  node,
  isSelected,
  onSelect,
  onDrag,
  onOpenTerminal,
  onToggleAgent,
  onEdit,
}: AgentNodeCardProps) {
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

  const isRunning = node.status === 'running' || node.status === 'waiting';

  return (
    <motion.div
      className={cn(
        'node-card absolute select-none touch-none',
        isDragging ? 'z-50 cursor-grabbing' : 'z-10 cursor-pointer'
      )}
      style={{ left: node.position.x, top: node.position.y }}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: isDragging ? 1 : 1.02 }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <StatusIndicator status={node.status} />

      <Card
        className={cn(
          'w-72 backdrop-blur-sm transition-all duration-200',
          isSelected
            ? 'bg-card/95 border-primary/50 shadow-lg shadow-primary/20'
            : node.status === 'waiting'
              ? 'bg-card/95 border-warning/50 shadow-lg shadow-warning/20'
              : 'bg-card/80 border-border hover:border-muted-foreground/30'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-border">
          <div className="flex items-center gap-2">
            <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
            <span className="text-xl">{CHARACTER_EMOJIS[node.character] || '\u{1F916}'}</span>
            <span className="font-medium text-foreground truncate max-w-[100px]">{node.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn('w-2 h-2 rounded-full', STATUS_COLORS[node.status], isRunning && 'animate-pulse')} />
            <span className="text-xs text-muted-foreground capitalize">{node.status}</span>
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
              <AnimatePresence>
                {showMenu && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -5 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -5 }}
                    transition={{ duration: 0.1 }}
                    className="absolute right-0 top-full mt-1 w-36 bg-card border border-border shadow-xl z-50 overflow-hidden"
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMenu(false);
                        onEdit();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-secondary transition-colors"
                    >
                      <Settings2 className="w-4 h-4 text-primary" />
                      Edit
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-3 space-y-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FolderGit2 className="w-3 h-3 text-chart-2" />
            <span className="truncate">{node.cwd.split('/').pop()}</span>
          </div>

          {node.skills.length > 0 && (
            <div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1.5">
                <Sparkles className="w-3 h-3" />
                <span>Skills</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {node.skills.slice(0, 3).map((skill) => (
                  <Badge
                    key={skill}
                    variant="outline"
                    className="text-xs px-2 py-0.5 bg-primary/10 text-primary border-primary/20"
                  >
                    {skill}
                  </Badge>
                ))}
                {node.skills.length > 3 && (
                  <Badge variant="secondary" className="text-xs px-2 py-0.5">
                    +{node.skills.length - 3}
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2">
            {isRunning ? (
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20"
                onClick={(e) => { e.stopPropagation(); onToggleAgent(); }}
              >
                <Square className="w-3 h-3" />
                Stop
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 bg-success/10 text-success border border-success/20 hover:bg-success/20"
                onClick={(e) => { e.stopPropagation(); onToggleAgent(); }}
              >
                <Play className="w-3 h-3" />
                Start
              </Button>
            )}
            {(node.status === 'running' || node.status === 'waiting') && (
              <Button
                variant="ghost"
                size="sm"
                className="bg-secondary/50 text-foreground hover:bg-secondary"
                onClick={(e) => { e.stopPropagation(); onOpenTerminal(); }}
              >
                <Terminal className="w-3 h-3" />
                Terminal
              </Button>
            )}
          </div>
        </div>

        {/* Connection point */}
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-card border border-primary/50" />
      </Card>
    </motion.div>
  );
}
