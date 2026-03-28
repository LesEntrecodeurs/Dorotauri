import { useAnimatePresence } from '@/hooks/useAnimatePresence';
import { X, Plus, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Agent } from '../types';
import { ScheduleFieldPicker } from './ScheduleFieldPicker';
import { TaskOptionsFields } from './TaskOptionsFields';
import { NotificationFields } from './NotificationFields';

interface CreateTaskModalProps {
  show: boolean;
  onClose: () => void;
  agents: Agent[];
  formData: {
    agentId: string;
    projectPath: string;
    title: string;
    prompt: string;
    schedulePreset: string;
    customCron: string;
    time: string;
    days: string[];
    intervalDays: number;
    selectedDays: string[];
    autonomous: boolean;
    useWorktree: boolean;
    notifyTelegram: boolean;
    notifySlack: boolean;
  };
  onFormChange: (data: CreateTaskModalProps['formData']) => void;
  isCreating: boolean;
  createError: string | null;
  onSubmit: () => void;
}

export function CreateTaskModal({
  show,
  onClose,
  agents,
  formData,
  onFormChange,
  isCreating,
  createError,
  onSubmit,
}: CreateTaskModalProps) {
  const { shouldRender, animationState } = useAnimatePresence(show);

  return (
    <>
      {shouldRender && (
        <div
          data-state={animationState}
          className="animate-fade fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={onClose}
        >
          <div
            data-state={animationState}
            onClick={(e) => e.stopPropagation()}
            className="animate-modal bg-card border border-border w-full max-w-lg max-h-[90vh] overflow-y-auto"
          >
            <div className="p-6 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-semibold">Create Scheduled Task</h2>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onClose}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="p-6 space-y-4">
              {/* Title */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  Title <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => onFormChange({ ...formData, title: e.target.value })}
                  placeholder="e.g. Daily code review"
                  className="w-full px-3 py-2 bg-secondary border border-border text-sm"
                  autoFocus
                />
              </div>

              {/* Agent Selection */}
              <div>
                <label className="block text-sm font-medium mb-2">Agent (optional)</label>
                <select
                  value={formData.agentId}
                  onChange={(e) => {
                    const selectedAgent = agents.find(a => a.id === e.target.value);
                    onFormChange({
                      ...formData,
                      agentId: e.target.value,
                      projectPath: selectedAgent?.cwd || formData.projectPath,
                    });
                  }}
                  className="w-full px-3 py-2 bg-secondary border border-border"
                >
                  <option value="">No agent (use project path below)</option>
                  {agents.map(agent => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name || agent.id} - {agent.cwd.split('/').pop()}
                    </option>
                  ))}
                </select>
              </div>

              {/* Project Path */}
              {!formData.agentId && (
                <div>
                  <label className="block text-sm font-medium mb-2">Project Path</label>
                  <input
                    type="text"
                    value={formData.projectPath}
                    onChange={(e) => onFormChange({ ...formData, projectPath: e.target.value })}
                    placeholder="/path/to/your/project"
                    className="w-full px-3 py-2 bg-secondary border border-border font-mono text-sm"
                  />
                </div>
              )}

              {/* Prompt */}
              <div>
                <label className="block text-sm font-medium mb-2">Task Prompt</label>
                <textarea
                  value={formData.prompt}
                  onChange={(e) => onFormChange({ ...formData, prompt: e.target.value })}
                  placeholder="What should Claude do?"
                  rows={4}
                  className="w-full px-3 py-2 bg-secondary border border-border resize-none"
                />
              </div>

              {/* Schedule */}
              <ScheduleFieldPicker
                value={{
                  schedulePreset: formData.schedulePreset,
                  customCron: formData.customCron,
                  time: formData.time,
                  intervalDays: formData.intervalDays,
                  selectedDays: formData.selectedDays,
                }}
                onChange={(fields) => onFormChange({ ...formData, ...fields })}
              />

              {/* Options */}
              <TaskOptionsFields
                autonomous={formData.autonomous}
                onAutonomousChange={(v) => onFormChange({ ...formData, autonomous: v })}
                useWorktree={formData.useWorktree}
                onWorktreeChange={(v) => onFormChange({ ...formData, useWorktree: v })}
              />

              {/* Notifications */}
              <NotificationFields
                notifyTelegram={formData.notifyTelegram}
                onTelegramChange={(v) => onFormChange({ ...formData, notifyTelegram: v })}
                notifySlack={formData.notifySlack}
                onSlackChange={(v) => onFormChange({ ...formData, notifySlack: v })}
              />

              {createError && (
                <div className="bg-destructive/10 border border-destructive/20 p-3 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-destructive" />
                  <span className="text-sm text-destructive">{createError}</span>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-border flex items-center justify-end gap-3">
              <Button
                variant="ghost"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                onClick={onSubmit}
                disabled={isCreating || !formData.prompt || (!formData.agentId && !formData.projectPath)}
              >
                {isCreating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Create Task
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
