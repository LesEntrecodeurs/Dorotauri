import { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface StartPromptModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (prompt: string) => void;
  value: string;
  onChange: (value: string) => void;
}

export function StartPromptModal({
  open,
  onClose,
  onSubmit,
  value,
  onChange,
}: StartPromptModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const handleSubmit = () => {
    if (value.trim()) {
      onSubmit(value.trim());
      onChange('');
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-background border border-border p-6 w-full max-w-lg mx-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Play className="w-5 h-5 text-success" />
                Start Agent Task
              </DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground text-sm mb-4 mt-4">
              Enter the task you want the agent to perform:
            </p>
            <Input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && value.trim()) {
                  handleSubmit();
                  onClose();
                }
                if (e.key === 'Escape') {
                  onClose();
                }
              }}
              placeholder="e.g., Fix the bug in login.tsx..."
              className="mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <Button
                onClick={onClose}
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  handleSubmit();
                  onClose();
                }}
                disabled={!value.trim()}
                className="bg-success/20 text-success hover:bg-success/30"
              >
                Start Agent
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
