import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare,
  Check,
  Zap,
  GitBranch,
  GitFork,
  ChevronDown,
  ChevronRight,
  Settings2,
  Sparkles,
  BookOpen,
} from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import type { AgentProvider } from '@/types/electron';

interface StepTaskProps {
  prompt: string;
  onPromptChange: (prompt: string) => void;
  selectedSkills: string[];
  useWorktree: boolean;
  onToggleWorktree: () => void;
  branchName: string;
  onBranchNameChange: (name: string) => void;
  skipPermissions: boolean;
  onToggleSkipPermissions: () => void;
  // Summary data
  provider: AgentProvider;
  model: string;
  selectedObsidianVaults: string[];
}

const StepTask = React.memo(function StepTask({
  prompt,
  onPromptChange,
  selectedSkills,
  useWorktree,
  onToggleWorktree,
  branchName,
  onBranchNameChange,
  skipPermissions,
  onToggleSkipPermissions,
  provider,
  model,
  selectedObsidianVaults,
}: StepTaskProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="space-y-5">
      {/* Section header */}
      <div>
        <h3 className="text-lg font-medium mb-1 flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-green-500" />
          Define Task
        </h3>
        <p className="text-muted-foreground text-sm">
          Describe the task or leave empty to start an interactive session
        </p>
      </div>

      {/* Prompt */}
      <div>
        <label className="block text-sm font-medium mb-2">
          What should this agent do?
          <span className="text-muted-foreground font-normal ml-1">(optional)</span>
        </label>
        <Textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder="Describe the task, or leave empty to start an interactive session"
          rows={4}
          className="resize-none"
        />
        {selectedSkills.length > 0 && !prompt && (
          <p className="text-xs text-primary mt-2">
            Agent will start with selected skills: {selectedSkills.slice(0, 3).join(', ')}{selectedSkills.length > 3 ? ` +${selectedSkills.length - 3} more` : ''}
          </p>
        )}
      </div>

      {/* Advanced Options (collapsible) */}
      <div className="rounded-md border border-border overflow-hidden">
        <button
          onClick={() => setShowAdvanced(prev => !prev)}
          className="w-full flex items-center justify-between px-4 py-3 bg-secondary/50 hover:bg-secondary/80 transition-colors"
        >
          <span className="font-medium text-sm flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-muted-foreground" />
            Advanced Options
          </span>
          {showAdvanced ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </button>

        <AnimatePresence>
          {showAdvanced && (
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0 }}
              className="overflow-hidden"
            >
              <div className="p-4 space-y-4 border-t border-border">
                {/* Git Worktree Option */}
                <div className="p-3 rounded-md border border-border bg-muted/30">
                  <div className="flex items-start gap-3">
                    <button
                      onClick={onToggleWorktree}
                      className={`
                        mt-0.5 w-5 h-5 rounded border flex items-center justify-center transition-all shrink-0
                        ${useWorktree
                          ? 'bg-primary border-primary'
                          : 'border-border hover:border-primary'
                        }
                      `}
                    >
                      {useWorktree && <Check className="w-3 h-3 text-white" />}
                    </button>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <GitFork className="w-4 h-4 text-primary" />
                        <span className="font-medium text-sm">Use Git Worktree</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Create an isolated branch for this agent
                      </p>

                      <AnimatePresence>
                        {useWorktree && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-3 pt-3 border-t border-border">
                              <label className="block text-xs font-medium mb-2 flex items-center gap-2">
                                <GitBranch className="w-3.5 h-3.5 text-primary" />
                                Branch Name
                              </label>
                              <Input
                                type="text"
                                value={branchName}
                                onChange={(e) => onBranchNameChange(e.target.value.replace(/\s+/g, '-'))}
                                placeholder="feature/my-task"
                                className="font-mono"
                              />
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                {/* Skip Permissions */}
                <div className="p-3 rounded-md border border-amber-500/30 bg-amber-500/5">
                  <div className="flex items-start gap-3">
                    <button
                      onClick={onToggleSkipPermissions}
                      className={`
                        mt-0.5 w-5 h-5 rounded border flex items-center justify-center transition-all shrink-0
                        ${skipPermissions
                          ? 'bg-amber-500 border-amber-500'
                          : 'border-amber-500/50 hover:border-amber-500'
                        }
                      `}
                    >
                      {skipPermissions && <Check className="w-3 h-3 text-white" />}
                    </button>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-amber-500" />
                        <span className="font-medium text-sm">Skip Permission Prompts</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Run without asking for permission — the agent will have full autonomy
                      </p>
                    </div>
                  </div>
                </div>

              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Summary Card */}
      <div className="rounded-md border border-border bg-secondary/30 p-4 space-y-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Summary</span>
        <div className="space-y-1.5">
          <SummaryRow icon={<Sparkles className="w-3.5 h-3.5" />} label="Model" value={`${provider} / ${model}`} />
          {selectedSkills.length > 0 && (
            <SummaryRow icon={<Zap className="w-3.5 h-3.5" />} label="Skills" value={`${selectedSkills.length} selected`} />
          )}
          {selectedObsidianVaults.length > 0 && (
            <SummaryRow icon={<BookOpen className="w-3.5 h-3.5" />} label="Vaults" value={`${selectedObsidianVaults.length + 1} sources`} />
          )}
          {useWorktree && branchName && (
            <SummaryRow icon={<GitBranch className="w-3.5 h-3.5" />} label="Branch" value={branchName} mono />
          )}
        </div>
      </div>
    </div>
  );
});

function SummaryRow({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <span className={`truncate max-w-[200px] ${mono ? 'font-mono text-primary' : ''}`}>{value}</span>
    </div>
  );
}

export default StepTask;
