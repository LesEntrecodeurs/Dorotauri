import { useRef, useEffect, useState } from 'react';
import type { Terminal } from 'xterm';
import type { FitAddon } from 'xterm-addon-fit';
import { isTauri } from '@/hooks/useTauri';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AgentStatus } from '@/types/electron';
import { getTerminalTheme, TERMINAL_CONFIG } from '@/components/AgentWorld/constants';
import { attachShiftEnterHandler } from '@/lib/terminal';

interface TerminalTileProps {
  agentId: string;
}

/**
 * A single terminal tile for the mosaic layout.
 * Each tile creates its own xterm.js instance, subscribes to agent:output,
 * and forwards input to the agent PTY.
 */
export default function TerminalTile({ agentId }: TerminalTileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<{ terminal: Terminal; fitAddon: FitAddon; disposed: boolean } | null>(null);
  const initRef = useRef(false);
  const ptyIdRef = useRef<string | null>(null);

  // Initialize xterm in this tile
  useEffect(() => {
    const container = containerRef.current;
    if (!container || initRef.current) return;
    initRef.current = true;

    let cancelled = false;

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('xterm'),
        import('xterm-addon-fit'),
      ]);

      if (cancelled) return;

      // Wait for layout to settle so container has real dimensions
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const rect = container.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) {
        const ready = await new Promise<boolean>(resolve => {
          let resolved = false;
          const observer = new ResizeObserver((entries) => {
            if (resolved) return;
            for (const entry of entries) {
              const { width, height } = entry.contentRect;
              if (width >= 10 && height >= 10) {
                resolved = true;
                observer.disconnect();
                resolve(true);
                return;
              }
            }
          });
          observer.observe(container);
          setTimeout(() => {
            if (!resolved) {
              resolved = true;
              observer.disconnect();
              resolve(false);
            }
          }, 3000);
        });
        if (!ready || cancelled) return;
      }

      const term = new Terminal({
        theme: getTerminalTheme('dark'),
        fontSize: TERMINAL_CONFIG.fontSize || 11,
        fontFamily: TERMINAL_CONFIG.fontFamily,
        cursorBlink: TERMINAL_CONFIG.cursorBlink,
        cursorStyle: TERMINAL_CONFIG.cursorStyle,
        scrollback: TERMINAL_CONFIG.scrollback,
        convertEol: TERMINAL_CONFIG.convertEol,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(container);

      const entry = { terminal: term, fitAddon, disposed: false };
      termRef.current = entry;

      // Fetch agent to get ptyId and status
      let agent: AgentStatus | null = null;
      if (isTauri()) {
        try {
          agent = await invoke<AgentStatus | null>('agent_get', { id: agentId });
          if (agent?.ptyId) {
            ptyIdRef.current = agent.ptyId;
          }
        } catch {}
      }

      // Initial fit — use ptyId if available
      try {
        fitAddon.fit();
        const { cols, rows } = term;
        if (isTauri() && ptyIdRef.current) {
          invoke('pty_resize', { ptyId: ptyIdRef.current, cols, rows }).catch(() => {});
        }
      } catch {}

      // Show status message or replay output
      if (agent?.status === 'idle' || agent?.status === 'completed' || agent?.status === 'error') {
        term.write(`\x1b[90m\u2014 Session ${agent.status} \u2014\x1b[0m\r\n`);
        if (agent.status === 'idle') {
          term.write(`\x1b[90mStart this agent from the Agents page or NewChat modal.\x1b[0m\r\n`);
        }
      } else if (agent?.output?.length) {
        term.write(agent.output.join(''));
      }

      // Fit after content
      setTimeout(() => {
        if (!entry.disposed) {
          try { fitAddon.fit(); } catch {}
        }
      }, 50);

      // Shift+Enter handler
      attachShiftEnterHandler(term, (data) => {
        if (isTauri()) {
          invoke('agent_send_input', { id: agentId, input: data }).catch(() => {});
        }
      });

      // Forward keyboard input
      term.onData((data) => {
        if (/^(\x1b\[\?[\d;]*c|\d+;\d+c)+$/.test(data)) return;
        const cleaned = data
          .replace(/\x1b\[\?[\d;]*c/g, '')
          .replace(/\x1b\[\d+;\d+R/g, '')
          .replace(/\x1b\[(?:I|O)/g, '')
          .replace(/\d+;\d+c/g, '');
        if (!cleaned) return;
        if (isTauri()) {
          invoke('agent_send_input', { id: agentId, input: cleaned }).catch(() => {});
        }
      });

      // ResizeObserver for auto-fit
      const resizeObserver = new ResizeObserver(() => {
        if (!entry.disposed) {
          try {
            fitAddon.fit();
            const { cols, rows } = term;
            if (isTauri() && ptyIdRef.current) {
              invoke('pty_resize', { ptyId: ptyIdRef.current, cols, rows }).catch(() => {});
            }
          } catch {}
        }
      });
      resizeObserver.observe(container);

      // Subscribe to agent output
      let unsubOutput: (() => void) | undefined;
      let unsubError: (() => void) | undefined;
      let unsubStatus: (() => void) | undefined;

      listen<{ agent_id: string; pty_id: string; data: number[] }>('agent:output', (event) => {
        if (event.payload.agent_id === agentId && !entry.disposed) {
          // Track the ptyId from output events
          if (event.payload.pty_id && !ptyIdRef.current) {
            ptyIdRef.current = event.payload.pty_id;
          }
          term.write(new Uint8Array(event.payload.data));
        }
      }).then(fn => { unsubOutput = fn; });

      listen<{ agentId: string; data: string }>('agent:error', (event) => {
        if (event.payload.agentId === agentId && !entry.disposed) {
          term.write(`\x1b[31m${event.payload.data}\x1b[0m`);
        }
      }).then(fn => { unsubError = fn; });

      // Listen for status changes to update ptyId when agent starts
      listen<AgentStatus>('agent:status', (event) => {
        if (event.payload.id === agentId && event.payload.ptyId) {
          ptyIdRef.current = event.payload.ptyId;
        }
      }).then(fn => { unsubStatus = fn; });

      // Cleanup
      const cleanup = () => {
        entry.disposed = true;
        resizeObserver.disconnect();
        unsubOutput?.();
        unsubError?.();
        unsubStatus?.();
        term.dispose();
      };
      (entry as Record<string, unknown>)._cleanup = cleanup;
    })();

    return () => {
      cancelled = true;
      const entry = termRef.current;
      if (entry) {
        const cleanup = (entry as Record<string, unknown>)._cleanup as (() => void) | undefined;
        cleanup?.();
        termRef.current = null;
      }
      initRef.current = false;
    };
  }, [agentId]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden"
      style={{ backgroundColor: '#1a1a2e' }}
    />
  );
}
