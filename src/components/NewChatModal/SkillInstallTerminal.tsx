import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import 'xterm/css/xterm.css';

interface SkillInstallTerminalProps {
  show: boolean;
  installingSkill: { name: string; repo: string } | null;
  installComplete: boolean;
  installExitCode: number | null;
  terminalRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}

export default function SkillInstallTerminal({
  show,
  installingSkill,
  installComplete,
  installExitCode,
  terminalRef,
  onClose,
}: SkillInstallTerminalProps) {
  return (
    <AnimatePresence>
      {show && installingSkill && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl bg-secondary border border-border overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 flex items-center justify-center ${
                  installComplete
                    ? installExitCode === 0
                      ? 'bg-green-500/20'
                      : 'bg-destructive/20'
                    : 'bg-primary/20'
                }`}>
                  {installComplete ? (
                    installExitCode === 0 ? (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    ) : (
                      <XCircle className="w-4 h-4 text-destructive" />
                    )
                  ) : (
                    <Loader2 className="w-4 h-4 text-primary animate-spin" />
                  )}
                </div>
                <div>
                  <h3 className="font-semibold">
                    {installComplete
                      ? installExitCode === 0
                        ? 'Installation Complete'
                        : 'Installation Failed'
                      : `Installing ${installingSkill.name}...`}
                  </h3>
                  <p className="text-xs text-muted-foreground font-mono">
                    {installingSkill.repo}/{installingSkill.name}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-muted"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4">
              <p className="text-xs text-muted-foreground mb-3">
                Interactive terminal - type your responses and press Enter when prompted.
              </p>
              <div
                ref={terminalRef}
                className="bg-[#1A1726] overflow-hidden"
                style={{ height: '350px' }}
              />
            </div>

            <div className="px-5 py-4 border-t border-border flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {installComplete
                  ? `Exited with code ${installExitCode}`
                  : 'Waiting for installation to complete...'}
              </p>
              <Button
                onClick={onClose}
                variant={installComplete ? 'default' : 'destructive'}
                className={!installComplete ? 'bg-destructive/20 text-destructive hover:bg-destructive/30' : ''}
              >
                {installComplete ? 'Done' : 'Cancel'}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
