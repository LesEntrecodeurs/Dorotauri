

import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Trash2, Save, Bot, Clock, Plus, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import type { KanbanTask } from '@/types/kanban';
import { COLUMN_CONFIG, getLabelColor } from '../constants';

interface KanbanCardDetailProps {
  task: KanbanTask;
  onClose: () => void;
  onUpdate: (data: Partial<KanbanTask>) => Promise<void>;
  onDelete: () => void;
}

export function KanbanCardDetail({ task, onClose, onUpdate, onDelete }: KanbanCardDetailProps) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [priority, setPriority] = useState(task.priority);
  const [requiredSkills, setRequiredSkills] = useState<string[]>(task.requiredSkills);
  const [skillInput, setSkillInput] = useState('');
  const [labels, setLabels] = useState<string[]>(task.labels);
  const [labelInput, setLabelInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const columnConfig = COLUMN_CONFIG[task.column];

  const hasChanges =
    title !== task.title ||
    description !== task.description ||
    priority !== task.priority ||
    JSON.stringify(requiredSkills) !== JSON.stringify(task.requiredSkills) ||
    JSON.stringify(labels) !== JSON.stringify(task.labels);

  const handleAddSkill = () => {
    if (skillInput.trim() && !requiredSkills.includes(skillInput.trim())) {
      setRequiredSkills([...requiredSkills, skillInput.trim()]);
      setSkillInput('');
    }
  };

  const handleRemoveSkill = (skill: string) => {
    setRequiredSkills(requiredSkills.filter((s) => s !== skill));
  };

  const handleAddLabel = () => {
    if (labelInput.trim() && !labels.includes(labelInput.trim())) {
      setLabels([...labels, labelInput.trim()]);
      setLabelInput('');
    }
  };

  const handleRemoveLabel = (label: string) => {
    setLabels(labels.filter((l) => l !== label));
  };

  const handleSave = async () => {
    if (!title.trim()) return;

    setIsSaving(true);
    try {
      await onUpdate({
        title: title.trim(),
        description: description.trim(),
        priority,
        requiredSkills,
        labels,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-xl"
      >
        <div className="bg-card border border-border rounded-md shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${columnConfig.accentColor}`} />
              <span className="text-sm font-medium text-muted-foreground">
                {columnConfig.title}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={onDelete}
                className="text-muted-foreground hover:text-destructive"
                title="Delete task"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="w-4 h-4 text-muted-foreground" />
              </Button>
            </div>
          </div>

          {/* Content */}
          <div className="p-6 space-y-5 max-h-[60vh] overflow-y-auto">
            {/* Title */}
            <div>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Task title..."
                className="w-full text-lg font-semibold bg-transparent border-none focus:outline-none focus:ring-0 p-0 placeholder:text-muted-foreground/50"
              />
            </div>

            {/* Description */}
            <div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add a description..."
                rows={4}
                className="w-full text-sm bg-secondary/30 border border-border rounded-md px-4 py-3 focus:outline-none focus:ring-2 focus:ring-ring resize-none placeholder:text-muted-foreground/50"
              />
            </div>

            {/* Priority */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Priority
              </label>
              <div className="flex gap-2">
                {(['low', 'medium', 'high'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`
                      flex-1 px-3 py-2 text-sm rounded-md border-2 transition-all font-medium
                      ${priority === p
                        ? p === 'high'
                          ? 'bg-destructive/10 border-destructive/50 text-destructive'
                          : p === 'medium'
                          ? 'bg-warning/10 border-warning/50 text-warning'
                          : 'bg-zinc-500/10 border-zinc-500/50 text-zinc-500'
                        : 'bg-transparent border-border/50 text-muted-foreground hover:border-border'
                      }
                    `}
                  >
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Labels */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Labels
              </label>
              <div className="flex gap-2 mb-3">
                <Input
                  type="text"
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddLabel();
                    }
                  }}
                  placeholder="Add label..."
                  className="flex-1 h-9 text-sm"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleAddLabel}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {labels.map((label) => {
                  const colors = getLabelColor(label);
                  return (
                    <Badge
                      key={label}
                      variant="secondary"
                      className={`flex items-center gap-1.5 ${colors.bg} ${colors.text}`}
                    >
                      {label}
                      <button
                        type="button"
                        onClick={() => handleRemoveLabel(label)}
                        className="hover:opacity-70"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  );
                })}
                {labels.length === 0 && (
                  <span className="text-xs text-muted-foreground/50">No labels</span>
                )}
              </div>
            </div>

            {/* Skills */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Required Skills
              </label>
              <div className="flex gap-2 mb-3">
                <Input
                  type="text"
                  value={skillInput}
                  onChange={(e) => setSkillInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddSkill();
                    }
                  }}
                  placeholder="Add skill..."
                  className="flex-1 h-9 text-sm"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleAddSkill}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {requiredSkills.map((skill) => (
                  <Badge
                    key={skill}
                    variant="secondary"
                    className="flex items-center gap-1.5 bg-primary/10 text-primary"
                  >
                    {skill}
                    <button
                      type="button"
                      onClick={() => handleRemoveSkill(skill)}
                      className="hover:opacity-70"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
                {requiredSkills.length === 0 && (
                  <span className="text-xs text-muted-foreground/50">No skills required</span>
                )}
              </div>
            </div>

            {/* Meta info */}
            <div className="flex items-center gap-4 pt-4 border-t border-border/50 text-xs text-muted-foreground">
              {task.assignedAgentId && (
                <div className="flex items-center gap-1.5 text-green-500">
                  <Bot className="w-3.5 h-3.5" />
                  <span>Agent assigned</span>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span>Created {new Date(task.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-border bg-secondary/20">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!hasChanges || !title.trim() || isSaving}
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </motion.div>
    </>
  );
}
