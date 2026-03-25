import { memo } from 'react';
import { Crown } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface SuperAgentToggleProps {
  isSuperAgent: boolean;
  scope?: 'tab' | 'all';
  onChange: (isSuperAgent: boolean, scope?: 'tab' | 'all') => void;
}

export const SuperAgentToggle = memo(function SuperAgentToggle({
  isSuperAgent,
  scope = 'tab',
  onChange,
}: SuperAgentToggleProps) {
  const stop = (e: React.MouseEvent | React.PointerEvent) => e.stopPropagation();

  return (
    <div className="space-y-2" onPointerDown={stop} onClick={stop}>
      <div className="flex items-center justify-between">
        <Label htmlFor="super-agent-toggle" className="flex items-center gap-1.5 text-xs cursor-pointer">
          <Crown className="w-3 h-3 text-amber-400" />
          Super Agent
        </Label>
        <Switch
          id="super-agent-toggle"
          checked={isSuperAgent}
          onCheckedChange={(checked) => onChange(checked, checked ? scope : undefined)}
          className="scale-75 origin-right"
        />
      </div>

      {isSuperAgent && (
        <div className="flex gap-1 ml-4.5">
          <button
            onClick={() => onChange(true, 'tab')}
            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
              scope === 'tab'
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                : 'border-border text-muted-foreground hover:border-amber-500/30'
            }`}
          >
            This tab only
          </button>
          <button
            onClick={() => onChange(true, 'all')}
            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
              scope === 'all'
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                : 'border-border text-muted-foreground hover:border-amber-500/30'
            }`}
          >
            All tabs
          </button>
        </div>
      )}
    </div>
  );
});
