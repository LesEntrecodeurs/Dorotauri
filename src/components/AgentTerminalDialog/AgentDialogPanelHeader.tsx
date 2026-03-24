import { memo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface AgentDialogPanelHeaderProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  color: string;
  isExpanded: boolean;
  badge?: React.ReactNode;
  onToggle: () => void;
}

export const AgentDialogPanelHeader = memo(function AgentDialogPanelHeader({
  icon: Icon,
  title,
  color,
  isExpanded,
  badge,
  onToggle,
}: AgentDialogPanelHeaderProps) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center justify-between px-3 py-2.5 transition-colors hover:bg-muted/50 ${
        isExpanded ? 'bg-muted/30' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-sm font-medium">{title}</span>
        {badge}
      </div>
      {isExpanded ? (
        <ChevronDown className="w-4 h-4 text-muted-foreground" />
      ) : (
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      )}
    </button>
  );
});
