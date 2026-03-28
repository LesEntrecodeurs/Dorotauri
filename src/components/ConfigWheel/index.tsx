import { memo, useCallback } from 'react';
import { Settings, Dices, Zap } from 'lucide-react';
import type { Agent, AgentProvider } from '@/types/electron';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CHARACTER_FACES } from '@/components/AgentList/constants';
import { getChampionIconUrl } from '@/components/NewChatModal/constants';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfigWheelWorktree } from './ConfigWheelWorktree';

const PROVIDERS: AgentProvider[] = ['claude', 'codex', 'gemini', 'opencode', 'pi', 'local'];

interface ConfigWheelProps {
  agent: Agent;
  onUpdate: (id: string, updates: Partial<Agent>) => void;
  availableSkills?: string[];
  /** Callback to re-roll the agent name (random LoL champion) */
  onRerollName?: (id: string) => void;
}

export const ConfigWheel = memo(function ConfigWheel({
  agent,
  onUpdate,
  availableSkills = [],
  onRerollName,
}: ConfigWheelProps) {
  const update = useCallback(
    (updates: Partial<Agent>) => onUpdate(agent.id, updates),
    [agent.id, onUpdate],
  );

  const toggleSkill = useCallback(
    (skill: string) => {
      const current = agent.skills || [];
      const next = current.includes(skill)
        ? current.filter((s) => s !== skill)
        : [...current, skill];
      update({ skills: next });
    },
    [agent.skills, update],
  );

  /** Stop pointer events from reaching the mosaic drag layer */
  const stopMosaicDrag = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title="Configure agent"
          onPointerDown={stopMosaicDrag}
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="bottom"
        className="w-72 p-3 space-y-3 z-[200]"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerDown={stopMosaicDrag}
        onClick={stopMosaicDrag}
      >
        {/* Name — display with champion icon + dice re-roll */}
        <div className="flex items-center gap-2">
          {(() => {
            const iconUrl = agent.name ? getChampionIconUrl(agent.name) : null;
            if (iconUrl) return <img src={iconUrl} alt="" className="w-5 h-5 rounded-sm object-cover shrink-0" />;
            if (agent.character) return <span className="text-base shrink-0">{CHARACTER_FACES[agent.character] || '🤖'}</span>;
            return null;
          })()}
          <span className="text-xs font-medium text-foreground truncate flex-1">{agent.name || 'Unnamed'}</span>
          {onRerollName && (
            <button
              onClick={() => onRerollName(agent.id)}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Random name"
            >
              <Dices className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Role description (free-text label, separate from agent.role type) */}
        <div className="space-y-1">
          <Label htmlFor="cw-role" className="text-xs">Role description</Label>
          <Input
            id="cw-role"
            value={agent.businessState || ''}
            onChange={(e) => update({ businessState: e.target.value })}
            onPointerDown={stopMosaicDrag}
            placeholder="e.g. frontend engineer, reviewer..."
            className="h-7 text-xs"
          />
        </div>

        {/* Skills — multi-select chips */}
        {availableSkills.length > 0 && (
          <div className="space-y-1">
            <Label className="text-xs">Skills</Label>
            <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
              {availableSkills.map((skill) => {
                const active = agent.skills?.includes(skill);
                return (
                  <button
                    key={skill}
                    onClick={() => toggleSkill(skill)}
                    className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ${
                      active
                        ? 'bg-primary/20 border-primary/50 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/30'
                    }`}
                  >
                    {skill}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Provider */}
        <div className="space-y-1">
          <Label className="text-xs">Provider</Label>
          <Select
            value={agent.provider || 'claude'}
            onValueChange={(value: string) => update({ provider: value as AgentProvider })}
          >
            <SelectTrigger className="h-7 text-xs" onPointerDown={stopMosaicDrag}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent onPointerDown={stopMosaicDrag}>
              {PROVIDERS.map((p) => (
                <SelectItem key={p} value={p} className="text-xs">
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* ── AUTONOMY ─────────────────────────────────────────── */}
        <div className="border-t border-border pt-2">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Autonomy</p>
          <div className="flex items-center justify-between">
            <Label htmlFor="cw-autonomous" className="text-xs cursor-pointer flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-amber-400" />
              Skip Permissions
            </Label>
            <Switch
              id="cw-autonomous"
              checked={agent.skipPermissions ?? false}
              onCheckedChange={(checked) => update({ skipPermissions: checked })}
              className="scale-75 origin-right"
            />
          </div>
        </div>

        {/* ── GIT WORKTREE ─────────────────────────────────────── */}
        <div className="border-t border-border pt-2">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Git Worktree</p>
          <ConfigWheelWorktree
            branchName={agent.branchName}
            onUpdate={(branchName) => update({ branchName: branchName || undefined })}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
});
