import { memo, useCallback } from 'react';
import { Settings } from 'lucide-react';
import type { Agent, AgentCharacter, AgentProvider } from '@/types/electron';
import { CHARACTER_FACES } from '@/components/AgentTerminalDialog/constants';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
import { SuperAgentToggle } from './SuperAgentToggle';

const PROVIDERS: AgentProvider[] = ['claude', 'codex', 'gemini', 'opencode', 'pi', 'local'];

interface ConfigWheelProps {
  agent: Agent;
  onUpdate: (id: string, updates: Partial<Agent>) => void;
  availableSkills?: string[];
}

export const ConfigWheel = memo(function ConfigWheel({
  agent,
  onUpdate,
  availableSkills = [],
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

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title="Configure agent"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" side="bottom" className="w-72 p-3 space-y-3">
        {/* Name */}
        <div className="space-y-1">
          <Label htmlFor="cw-name" className="text-xs">Name</Label>
          <Input
            id="cw-name"
            value={agent.name || ''}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="Agent name"
            className="h-7 text-xs"
          />
        </div>

        {/* Role */}
        <div className="space-y-1">
          <Label htmlFor="cw-role" className="text-xs">Role</Label>
          <Input
            id="cw-role"
            value={agent.role || ''}
            onChange={(e) => update({ role: e.target.value })}
            placeholder="e.g. frontend engineer, reviewer..."
            className="h-7 text-xs"
          />
        </div>

        {/* Persona — emoji picker */}
        <div className="space-y-1">
          <Label className="text-xs">Persona</Label>
          <div className="flex flex-wrap gap-1">
            {(Object.entries(CHARACTER_FACES) as [AgentCharacter, string][]).map(
              ([key, emoji]) => (
                <button
                  key={key}
                  onClick={() => update({ character: key })}
                  className={`w-7 h-7 rounded flex items-center justify-center text-sm transition-colors ${
                    (agent.character || 'robot') === key
                      ? 'bg-primary/20 ring-1 ring-primary'
                      : 'hover:bg-muted'
                  }`}
                  title={key}
                >
                  {emoji}
                </button>
              ),
            )}
          </div>
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
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDERS.map((p) => (
                <SelectItem key={p} value={p} className="text-xs">
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Autonomous mode */}
        <div className="flex items-center justify-between">
          <Label htmlFor="cw-autonomous" className="text-xs cursor-pointer">
            Autonomous mode
          </Label>
          <Switch
            id="cw-autonomous"
            checked={agent.skipPermissions}
            onCheckedChange={(checked) => update({ skipPermissions: checked })}
            className="scale-75 origin-right"
          />
        </div>

        {/* Super Agent */}
        <div className="border-t border-border pt-2">
          <SuperAgentToggle
            isSuperAgent={agent.isSuperAgent}
            scope={agent.superAgentScope}
            onChange={(isSuperAgent, scope) => update({ isSuperAgent, superAgentScope: scope })}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
});
