
import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, CheckCircle, XCircle, X, Link2 } from 'lucide-react';
import { isTauri } from '@/hooks/useTauri';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import ProviderBadge, { PROVIDER_CONFIG } from '@/components/ProviderBadge';
import 'xterm/css/xterm.css';

interface TerminalDialogProps {
  open: boolean;
  repo: string;
  title: string;
  onClose: (success?: boolean) => void;
  availableProviders?: string[];
  /** When set, runs this shell command via pty_create instead of skill install */
  command?: string;
}

export default function TerminalDialog({ open, repo, title, onClose, availableProviders = ['claude'], command }: TerminalDialogProps) {
  const isCommandMode = !!command;
  const [installComplete, setInstallComplete] = useState(false);
  const [installExitCode, setInstallExitCode] = useState<number | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);
  const [selectedProviders, setSelectedProviders] = useState<Set<string>>(new Set(['claude']));
  const [linkingStatus, setLinkingStatus] = useState<Record<string, 'pending' | 'done' | 'error'>>({});
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<import('xterm').Terminal | null>(null);
  const ptyIdRef = useRef<string | null>(null);

  // Reset state when opening with new repo
  useEffect(() => {
    if (open) {
      setInstallComplete(false);
      setInstallExitCode(null);
      setTerminalReady(false);
      setSelectedProviders(new Set(['claude']));
      setLinkingStatus({});
    }
  }, [open, repo]);

  // Initialize xterm when dialog opens
  useEffect(() => {
    if (!open || !terminalRef.current || xtermRef.current) return;

    const initTerminal = async () => {
      const { Terminal } = await import('xterm');
      const { FitAddon } = await import('xterm-addon-fit');

      const term = new Terminal({
        theme: {
          background: '#1A1714',
          foreground: '#E8DEC8',
          cursor: '#4DB8B0',
          cursorAccent: '#1A1714',
          selectionBackground: '#4DB8B033',
          black: '#1A1714',
          red: '#D4634D',
          green: '#5AAF62',
          yellow: '#CD7F4A',
          blue: '#4DB8B0',
          magenta: '#A080B2',
          cyan: '#4DB8B0',
          white: '#E8DEC8',
          brightBlack: '#7A6E58',
          brightRed: '#D4634D',
          brightGreen: '#5AAF62',
          brightYellow: '#CD7F4A',
          brightBlue: '#4DB8B0',
          brightMagenta: '#A080B2',
          brightCyan: '#4DB8B0',
          brightWhite: '#FAF4EA',
        },
        fontSize: 13,
        fontFamily: 'JetBrains Mono, Menlo, Monaco, Courier New, monospace',
        cursorBlink: true,
        cursorStyle: 'bar',
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
        if (!ptyIdRef.current || !isTauri()) return;
        invoke('pty_write', { ptyId: ptyIdRef.current, data: cleaned }).catch(() => {});
      });

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
        if (!ptyIdRef.current || !isTauri()) return;
        invoke('pty_resize', { ptyId: ptyIdRef.current, cols: term.cols, rows: term.rows }).catch(() => {});
      });
      resizeObserver.observe(terminalRef.current!);

      // Terminal is ready - signal that we can start the PTY
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
  }, [open]);

  // Start PTY only after terminal is ready
  useEffect(() => {
    if (!terminalReady || !isTauri()) return;

    const startPty = async () => {
      try {
        const term = xtermRef.current;
        // Create a standalone PTY for the install command or skill install
        const ptyId = await invoke<string>('pty_create', {
          cols: term?.cols,
          rows: term?.rows,
        });
        ptyIdRef.current = ptyId;

        // Write the actual command to run in the PTY
        if (isCommandMode && command) {
          await invoke('pty_write', { ptyId, data: command + '\n' });
        } else if (repo) {
          // For skill install, run the install command
          await invoke('pty_write', { ptyId, data: `claude mcp add-from-claude-code ${repo}\n` });
        }
      } catch (err) {
        xtermRef.current?.writeln(
          `Failed to start: ${err instanceof Error ? err.message : String(err)}`
        );
        setInstallComplete(true);
        setInstallExitCode(1);
      }
    };
    startPty();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalReady, repo, command]);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track command mode in a ref so the exit handler always has the current value
  const isCommandModeRef = useRef(isCommandMode);
  isCommandModeRef.current = isCommandMode;

  // Listen for PTY exit via Tauri events
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;

    listen<{ pty_id: string; exit_code: number }>('pty:exit', (event) => {
      const { pty_id, exit_code } = event.payload;
      if (pty_id === ptyIdRef.current) {
        setInstallComplete(true);
        setInstallExitCode(exit_code);

        // On success, symlink to additional providers (skill mode only)
        if (exit_code === 0 && !isCommandModeRef.current) {
          linkToAdditionalProviders();
        }
      }
    }).then(fn => { unlisten = fn; });

    return () => { unlisten?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const linkToAdditionalProviders = async () => {
    // Extract skill name from repo (last segment after last /)
    const parts = repo.split('/');
    const skillName = parts.length >= 3 ? parts.slice(2).join('/') : parts[parts.length - 1];

    const additionalProviders = Array.from(selectedProviders).filter(p => p !== 'claude');
    if (additionalProviders.length === 0) return;

    for (const providerId of additionalProviders) {
      setLinkingStatus(prev => ({ ...prev, [providerId]: 'pending' }));
      try {
        if (isTauri()) {
          const result = await invoke<{ success: boolean; error?: string }>('skill_link_to_provider', { skillName, providerId });
          setLinkingStatus(prev => ({ ...prev, [providerId]: result.success ? 'done' : 'error' }));
        }
      } catch {
        setLinkingStatus(prev => ({ ...prev, [providerId]: 'error' }));
      }
    }
  };

  const toggleProvider = (id: string) => {
    if (id === 'claude') return; // Claude is always selected (primary installer)
    setSelectedProviders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleClose = () => {
    if (ptyIdRef.current && !installComplete && isTauri()) {
      invoke('pty_kill', { ptyId: ptyIdRef.current }).catch(() => {});
    }
    ptyIdRef.current = null;
    if (xtermRef.current) {
      xtermRef.current.dispose();
      xtermRef.current = null;
    }
    onClose(installComplete && installExitCode === 0);
  };

  const nonClaudeProviders = availableProviders.filter(p => p !== 'claude');

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-4xl bg-card border border-border rounded-none overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-none flex items-center justify-center ${
                  installComplete
                    ? installExitCode === 0
                      ? 'bg-green-500/20'
                      : 'bg-red-500/20'
                    : 'bg-secondary'
                }`}>
                  {installComplete ? (
                    installExitCode === 0 ? (
                      <CheckCircle className="w-4 h-4 text-green-400" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-400" />
                    )
                  ) : (
                    <Loader2 className="w-4 h-4 text-white animate-spin" />
                  )}
                </div>
                <div>
                  <h3 className="font-semibold">
                    {installComplete
                      ? installExitCode === 0
                        ? 'Installation Complete'
                        : 'Installation Failed'
                      : title || 'Installing...'}
                  </h3>
                  <p className="text-xs text-muted-foreground font-mono">{command || repo}</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="p-2 hover:bg-secondary rounded-none"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Provider Selector — skill mode only */}
            {!isCommandMode && nonClaudeProviders.length > 0 && (
              <div className="px-5 py-3 border-b border-border flex items-center gap-3">
                <span className="text-xs text-muted-foreground">Install to:</span>
                {availableProviders.map(id => {
                  const config = PROVIDER_CONFIG[id];
                  if (!config) return null;
                  const isSelected = selectedProviders.has(id);
                  const isClaude = id === 'claude';
                  const status = linkingStatus[id];
                  const icon = config.icon;
                  return (
                    <button
                      key={id}
                      onClick={() => toggleProvider(id)}
                      disabled={isClaude || installComplete}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors ${
                        isSelected
                          ? 'bg-secondary text-foreground'
                          : 'bg-secondary/50 text-muted-foreground hover:text-foreground'
                      } ${isClaude ? 'opacity-90 cursor-default' : ''}`}
                      style={{ borderRadius: 4 }}
                    >
                      {typeof icon === 'string' ? (
                        <img src={icon} alt={config.label} className="w-3 h-3 object-contain" />
                      ) : (
                        React.createElement(icon, { className: 'w-3 h-3' })
                      )}
                      <span>{config.label}</span>
                      {status === 'done' && <CheckCircle className="w-3 h-3" />}
                      {status === 'error' && <XCircle className="w-3 h-3 text-red-400" />}
                      {status === 'pending' && <Loader2 className="w-3 h-3 animate-spin" />}
                    </button>
                  );
                })}
                {installComplete && installExitCode === 0 && Object.keys(linkingStatus).length > 0 && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Link2 className="w-3 h-3" />
                    Linked via symlink
                  </span>
                )}
              </div>
            )}

            <div className="p-4">
              <p className="text-xs text-muted-foreground mb-3">
                This is an interactive terminal. Type your responses and press Enter when prompted.
              </p>
              <div
                ref={terminalRef}
                className="bg-background rounded-none overflow-hidden"
                style={{ height: '400px' }}
              />
            </div>

            <div className="px-5 py-4 border-t border-border flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {installComplete
                  ? `Exited with code ${installExitCode}`
                  : 'Waiting for installation to complete...'}
              </p>
              <button
                onClick={handleClose}
                className={`px-4 py-2 rounded-none font-medium ${
                  installComplete
                    ? 'bg-foreground text-background hover:bg-foreground/90'
                    : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                }`}
              >
                {installComplete ? 'Close' : 'Cancel'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
