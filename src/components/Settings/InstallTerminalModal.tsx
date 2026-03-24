import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Terminal as TerminalIcon, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { isTauri } from '@/hooks/useTauri';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { TERMINAL_THEME, TERMINAL_CONFIG } from '@/components/AgentTerminalDialog/constants';

interface InstallTerminalModalProps {
  show: boolean;
  command: string;
  onClose: () => void;
  onComplete: () => void;
}

export const InstallTerminalModal = ({ show, command, onClose, onComplete }: InstallTerminalModalProps) => {
  const [installComplete, setInstallComplete] = useState(false);
  const [installExitCode, setInstallExitCode] = useState<number | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<import('xterm').Terminal | null>(null);
  const ptyIdRef = useRef<string | null>(null);

  // Initialize xterm when modal opens
  useEffect(() => {
    if (!show || !terminalRef.current || xtermRef.current) return;

    const initTerminal = async () => {
      const { Terminal } = await import('xterm');
      const { FitAddon } = await import('xterm-addon-fit');

      const term = new Terminal({
        theme: TERMINAL_THEME,
        ...TERMINAL_CONFIG,
        scrollback: 10000,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalRef.current!);
      fitAddon.fit();

      xtermRef.current = term;

      // Handle user input - send to PTY
      term.onData((data) => {
        const cleaned = data.replace(/\x1b\[(?:I|O)/g, '');
        if (!cleaned) return;
        if (ptyIdRef.current && isTauri()) {
          invoke('pty_write', { ptyId: ptyIdRef.current, data: cleaned }).catch(() => {});
        }
      });

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
        if (ptyIdRef.current && isTauri()) {
          invoke('pty_resize', { ptyId: ptyIdRef.current, cols: term.cols, rows: term.rows }).catch(() => {});
        }
      });
      resizeObserver.observe(terminalRef.current!);

      setTerminalReady(true);
    };

    initTerminal();

    return () => {
      // Kill PTY process to prevent zombie processes
      if (ptyIdRef.current && isTauri()) {
        invoke('pty_kill', { ptyId: ptyIdRef.current }).catch(() => {});
        ptyIdRef.current = null;
      }
      if (xtermRef.current) {
        xtermRef.current.dispose();
        xtermRef.current = null;
      }
      setTerminalReady(false);
    };
  }, [show]);

  // Start PTY only after terminal is ready
  useEffect(() => {
    if (!terminalReady || !command || !isTauri()) return;

    const startPty = async () => {
      try {
        const term = xtermRef.current;
        const ptyId = await invoke<string>('pty_create', {
          cols: term?.cols,
          rows: term?.rows,
        });
        ptyIdRef.current = ptyId;
        // Write the command to execute
        await invoke('pty_write', { ptyId, data: command + '\n' });
      } catch (err) {
        console.error('Failed to start plugin installation:', err);
        onClose();
      }
    };

    startPty();
  }, [terminalReady, command, onClose]);

  // Listen for PTY data via Tauri events
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;

    listen<{ agent_id: string; pty_id: string; data: number[] }>('agent:output', (event) => {
      const { pty_id, data } = event.payload;
      if (pty_id === ptyIdRef.current && xtermRef.current) {
        const bytes = new Uint8Array(data);
        xtermRef.current.write(bytes);
      }
    }).then(fn => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, []);

  // Listen for PTY exit via Tauri events
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;

    listen<{ pty_id: string; exit_code: number }>('pty:exit', (event) => {
      const { pty_id, exit_code } = event.payload;
      if (pty_id === ptyIdRef.current) {
        setInstallComplete(true);
        setInstallExitCode(exit_code);
      }
    }).then(fn => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, []);

  const handleClose = () => {
    if (ptyIdRef.current && isTauri()) {
      invoke('pty_kill', { ptyId: ptyIdRef.current }).catch(() => {});
    }
    setInstallComplete(false);
    setInstallExitCode(null);
    ptyIdRef.current = null;
    onComplete();
    onClose();
  };

  return (
    <Dialog open={show} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent className="max-w-4xl p-0 gap-0 overflow-hidden bg-[#1A1726] border-border">
        <DialogTitle className="sr-only">Installing Plugin</DialogTitle>
        {/* Terminal Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
          <div className="flex items-center gap-3">
            <TerminalIcon className="w-5 h-5 text-primary" />
            <div>
              <h3 className="font-medium text-sm">Installing Plugin</h3>
              <p className="text-xs text-muted-foreground font-mono">{command}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {installComplete && (
              <span className={`text-xs px-2 py-1 ${
                installExitCode === 0
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-red-500/20 text-red-400'
              }`}>
                {installExitCode === 0 ? 'Completed' : `Failed (${installExitCode})`}
              </span>
            )}
            {!installComplete && (
              <span className="text-xs px-2 py-1 bg-primary/20 text-primary flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                Running
              </span>
            )}
          </div>
        </div>

        {/* Terminal Content */}
        <div
          ref={terminalRef}
          className="h-[400px]"
          style={{ backgroundColor: '#1A1726' }}
        />

        {/* Terminal Footer */}
        <div className="px-4 py-3 border-t border-border bg-card flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {installComplete
              ? 'Installation finished. You can close this window.'
              : 'Installation in progress... You can interact with the terminal if needed.'}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleClose}
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
