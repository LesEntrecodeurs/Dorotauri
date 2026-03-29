import {
  CalendarClock,
  Clock,
  Bot,
  FolderOpen,
  Send,
  Play,
  FileText,
  Pencil,
  Trash2,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SlackIcon } from '@/components/Settings/SlackIcon';
import type { ScheduledTask } from '../types';
import { formatNextRun } from '../utils';

interface TaskCardProps {
  task: ScheduledTask;
  isExpanded: boolean;
  onToggleExpand: () => void;
  isRunning: boolean;
  runningTaskId: string | null;
  onRun: (taskId: string) => void;
  onViewLogs: (taskId: string) => void;
  onEdit: (task: ScheduledTask) => void;
  onDelete: (taskId: string) => void;
}

export function TaskCard({
  task,
  isExpanded,
  onToggleExpand,
  isRunning,
  runningTaskId,
  onRun,
  onViewLogs,
  onEdit,
  onDelete,
}: TaskCardProps) {
  return (
    <div className="animate-mount-fade-up">
      <Card className="p-4 hover:border-primary/30 transition-colors">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <CalendarClock className="w-4 h-4 text-primary shrink-0" />
              {task.title ? (
                <span className="font-semibold text-sm">{task.title}</span>
              ) : (
                <span className="font-medium text-sm font-mono text-muted-foreground">{task.id}</span>
              )}
              {formatNextRun(task.nextRun) && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary">
                  {formatNextRun(task.nextRun)}
                </Badge>
              )}
            </div>

            <p className={cn('text-sm text-muted-foreground mb-1', !isExpanded && 'line-clamp-2')}>
              {task.prompt}
            </p>
            {task.prompt.length > 120 && (
              <button
                onClick={onToggleExpand}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
              >
                {isExpanded ? 'Show less' : 'Show more'}
              </button>
            )}

            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {task.scheduleHuman || task.schedule}
              </div>

              {task.agentName && (
                <div className="flex items-center gap-1">
                  <Bot className="w-3 h-3" />
                  {task.agentName}
                </div>
              )}

              <div className="flex items-center gap-1">
                <FolderOpen className="w-3 h-3" />
                {task.projectPath.split('/').pop()}
              </div>

              {task.lastRun && (
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Last: {new Date(task.lastRun).toLocaleString()}
                </div>
              )}

              {task.lastRunStatus === 'running' && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 bg-info/10 text-info">
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  RUNNING
                </Badge>
              )}

              {task.lastRunStatus === 'partial' && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 bg-warning/10 text-warning">
                  PARTIAL
                </Badge>
              )}

              {task.lastRunStatus === 'success' && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 bg-success/10 text-success">
                  SUCCESS
                </Badge>
              )}

              {task.lastRunStatus === 'error' && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 bg-destructive/10 text-destructive">
                  ERROR
                </Badge>
              )}

              {task.notifications.telegram && (
                <div className="flex items-center gap-1 text-info">
                  <Send className="w-3 h-3" />
                  Telegram
                </div>
              )}

              {task.notifications.slack && (
                <div className="flex items-center gap-1 text-chart-2">
                  <SlackIcon className="w-3 h-3" />
                  Slack
                </div>
              )}

              {task.autonomous && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 bg-warning/10 text-warning">
                  AUTONOMOUS
                </Badge>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-success hover:bg-success/10"
              onClick={() => onRun(task.id)}
              disabled={runningTaskId === task.id}
              title="Run now"
            >
              {isRunning ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onViewLogs(task.id)}
              title="View logs"
            >
              <FileText className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onEdit(task)}
              title="Edit task"
            >
              <Pencil className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:bg-destructive/10"
              onClick={() => onDelete(task.id)}
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
