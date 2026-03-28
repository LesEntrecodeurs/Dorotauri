import { useAnimatePresence } from '@/hooks/useAnimatePresence';
import { X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ScheduledTask } from '../types';
import { ScheduleFieldPicker } from './ScheduleFieldPicker';
import { TaskOptionsFields } from './TaskOptionsFields';
import { NotificationFields } from './NotificationFields';

interface EditTaskModalProps {
  task: ScheduledTask | null;
  onClose: () => void;
  editForm: {
    title: string;
    prompt: string;
    schedulePreset: string;
    customCron: string;
    time: string;
    intervalDays: number;
    selectedDays: string[];
    projectPath: string;
    autonomous: boolean;
    notifyTelegram: boolean;
    notifySlack: boolean;
  };
  onFormChange: (data: EditTaskModalProps['editForm']) => void;
  isSaving: boolean;
  onSave: () => void;
}

export function EditTaskModal({
  task,
  onClose,
  editForm,
  onFormChange,
  isSaving,
  onSave,
}: EditTaskModalProps) {
  const { shouldRender, animationState } = useAnimatePresence(task !== null);

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
              <h2 className="text-lg font-semibold">Edit Scheduled Task</h2>
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
                <label className="block text-sm font-medium mb-2">Title</label>
                <input
                  type="text"
                  value={editForm.title}
                  onChange={(e) => onFormChange({ ...editForm, title: e.target.value })}
                  placeholder="e.g. Daily code review"
                  className="w-full px-3 py-2 bg-secondary border border-border text-sm"
                />
              </div>

              {/* Project Path */}
              <div>
                <label className="block text-sm font-medium mb-2">Project Path</label>
                <input
                  type="text"
                  value={editForm.projectPath}
                  onChange={(e) => onFormChange({ ...editForm, projectPath: e.target.value })}
                  className="w-full px-3 py-2 bg-secondary border border-border font-mono text-sm"
                />
              </div>

              {/* Prompt */}
              <div>
                <label className="block text-sm font-medium mb-2">Task Prompt</label>
                <textarea
                  value={editForm.prompt}
                  onChange={(e) => onFormChange({ ...editForm, prompt: e.target.value })}
                  rows={6}
                  className="w-full px-3 py-2 bg-secondary border border-border resize-none text-sm"
                />
              </div>

              {/* Schedule */}
              <ScheduleFieldPicker
                value={{
                  schedulePreset: editForm.schedulePreset,
                  customCron: editForm.customCron,
                  time: editForm.time,
                  intervalDays: editForm.intervalDays,
                  selectedDays: editForm.selectedDays,
                }}
                onChange={(fields) => onFormChange({ ...editForm, ...fields })}
              />

              {/* Options */}
              <TaskOptionsFields
                autonomous={editForm.autonomous}
                onAutonomousChange={(v) => onFormChange({ ...editForm, autonomous: v })}
              />

              {/* Notifications */}
              <NotificationFields
                notifyTelegram={editForm.notifyTelegram}
                onTelegramChange={(v) => onFormChange({ ...editForm, notifyTelegram: v })}
                notifySlack={editForm.notifySlack}
                onSlackChange={(v) => onFormChange({ ...editForm, notifySlack: v })}
              />
            </div>

            <div className="p-6 border-t border-border flex items-center justify-end gap-3">
              <Button
                variant="ghost"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                onClick={onSave}
                disabled={isSaving || !editForm.prompt.trim()}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
