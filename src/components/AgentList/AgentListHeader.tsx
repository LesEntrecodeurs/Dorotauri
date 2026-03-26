import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AgentListHeaderProps {
  onNewAgentClick: () => void;
}

export function AgentListHeader({ onNewAgentClick }: AgentListHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 lg:mb-6">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold tracking-tight text-foreground">AI Agents Control Center</h1>
        <p className="text-muted-foreground text-xs lg:text-sm mt-1 hidden sm:block">
          Dorotoring is watching your AI Agents.
        </p>
      </div>
      <Button onClick={onNewAgentClick} size="sm" className="gap-1.5 font-medium">
        <Plus className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">New Agent</span>
        <span className="sm:hidden">New</span>
      </Button>
    </div>
  );
}
