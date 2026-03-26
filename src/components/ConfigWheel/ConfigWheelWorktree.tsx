import { useState, useEffect } from 'react';
import { GitBranch } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface ConfigWheelWorktreeProps {
  branchName?: string;
  onUpdate: (branchName: string) => void;
}

export function ConfigWheelWorktree({ branchName, onUpdate }: ConfigWheelWorktreeProps) {
  const [enabled, setEnabled] = useState(!!branchName);
  const [value, setValue] = useState(branchName || '');

  // Sync when agent prop changes (e.g. external update)
  useEffect(() => {
    setEnabled(!!branchName);
    setValue(branchName || '');
  }, [branchName]);

  const handleToggle = () => {
    const next = !enabled;
    setEnabled(next);
    if (!next) {
      setValue('');
      onUpdate('');
    }
  };

  const handleBlur = () => {
    if (enabled) onUpdate(value.trim());
  };

  return (
    <div className="space-y-1.5">
      <button
        onClick={handleToggle}
        className="flex items-center gap-2 w-full group"
      >
        <div
          className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
            enabled ? 'bg-primary border-primary' : 'border-border group-hover:border-primary/50'
          }`}
        >
          {enabled && (
            <svg viewBox="0 0 10 8" className="w-2 h-2 fill-primary-foreground">
              <path d="M1 4l2.5 2.5L9 1" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
        <GitBranch className="w-3 h-3 text-muted-foreground" />
        <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
          Git Worktree
        </span>
      </button>

      {enabled && (
        <div className="ml-5 space-y-1">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={handleBlur}
            placeholder="feature/branch-name"
            className="h-6 text-xs"
          />
          <p className="text-[10px] text-muted-foreground">Applied on next restart</p>
        </div>
      )}
    </div>
  );
}
