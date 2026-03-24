import { RefreshCw, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PageHeaderProps {
  isRefreshing: boolean;
  onRefresh: () => void;
  onCreateNew: () => void;
}

export function PageHeader({ isRefreshing, onRefresh, onCreateNew }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold tracking-tight">Scheduled Tasks</h1>
        <p className="text-muted-foreground text-xs lg:text-sm mt-1 hidden sm:block">
          Automate recurring tasks with your agents
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        <Button
          size="sm"
          onClick={onCreateNew}
        >
          <Plus className="w-4 h-4" />
          New Task
        </Button>
      </div>
    </div>
  );
}
