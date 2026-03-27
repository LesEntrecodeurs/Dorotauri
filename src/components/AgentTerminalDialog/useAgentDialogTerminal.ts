

import { useState, useEffect, useRef } from 'react';
import type { Agent } from '@/types/electron';
import { attachKeyHandler } from '@/lib/terminal';
import { TERMINAL_THEME } from './constants';
import { useAgentPtyWebSocket } from '../../hooks/useAgentWebSocket';

// Clean xterm query/focus escape sequences out of user input before forwarding.
function cleanInput(data: string): string {
  return data
    .replace(/\x1b\[\?[\d;]*c/g, '')
    .replace(/\x1b\[\d+;\d+R/g, '')
    .replace(/\x1b\[(?:I|O)/g, '')
    .replace(/\d+;\d+c/g, '');
}

interface UseAgentDialogTerminalOptions {
  open: boolean;
  agent: Agent | null;
  isFullscreen: boolean;
  skipHistoricalOutput: boolean;
}

export function useAgentDialogTerminal({
  open,
  agent,
  isFullscreen,
  skipHistoricalOutput: _skipHistoricalOutput,
}: UseAgentDialogTerminalOptions) {
  const [terminalReady, setTerminalReady] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<import('xterm').Terminal | null>(null);
  const fitAddonRef = useRef<import('xterm-addon-fit').FitAddon | null>(null);
  const agentIdRef = useRef<string | null>(null);

  // Keep agentIdRef current
  useEffect(() => {
    agentIdRef.current = agent?.id || null;
  }, [agent?.id]);

  // WebSocket PTY connection — write() and resize() are stable callbacks
  const { write, resize } = useAgentPtyWebSocket(
    open ? (agent?.id ?? null) : null,
    (data: Uint8Array) => {
      xtermRef.current?.write(data);
    },
  );

  // Initialize terminal when dialog opens
  useEffect(() => {
    if (!open || !agent) return;

    if (xtermRef.current) {
      xtermRef.current.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    }

    let cancelled = false;

    const initTerminal = async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (cancelled || !terminalRef.current) return;

      const rect = terminalRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        setTimeout(initTerminal, 100);
        return;
      }

      const { Terminal } = await import('xterm');
      const { FitAddon } = await import('xterm-addon-fit');

      const term = new Terminal({
        theme: TERMINAL_THEME,
        fontSize: 13,
        fontFamily: 'JetBrains Mono, Menlo, Monaco, Courier New, monospace',
        cursorBlink: true,
        cursorStyle: 'bar',
        scrollback: 10000,
        convertEol: agent.provider !== 'gemini',
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      try {
        term.open(terminalRef.current);
        if (cancelled) { term.dispose(); return; }

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        const fitAndResize = () => {
          try {
            fitAddon.fit();
            resize(term.cols, term.rows);
          } catch (e) {
            console.warn('Failed to fit terminal:', e);
          }
        };

        fitAndResize();
        setTimeout(fitAndResize, 50);
        setTimeout(fitAndResize, 200);
        setTimeout(() => { fitAndResize(); term.focus(); }, 350);

        attachKeyHandler(term, (data) => {
          write(data);
        });

        term.onData((data) => {
          if (/^(\x1b\[\?[\d;]*c|\d+;\d+c)+$/.test(data)) return;
          const cleaned = cleanInput(data);
          if (!cleaned) return;
          write(cleaned);
        });

        if (!cancelled) {
          setTerminalReady(true);
        }

        term.writeln(`\x1b[36m● Connected to ${agent.name || 'Agent'}\x1b[0m`);
        term.writeln('');
      } catch (e) {
        console.error('Failed to initialize terminal:', e);
      }
    };

    initTerminal();

    return () => {
      cancelled = true;
      if (xtermRef.current) {
        xtermRef.current.dispose();
        xtermRef.current = null;
        fitAddonRef.current = null;
      }
      setTerminalReady(false);
    };
  }, [open, agent?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resize observer
  useEffect(() => {
    if (!terminalRef.current || !fitAddonRef.current) return;
    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current && xtermRef.current) {
        try {
          fitAddonRef.current.fit();
          resize(xtermRef.current.cols, xtermRef.current.rows);
        } catch (e) {
          console.warn('Failed to fit terminal:', e);
        }
      }
    });
    observer.observe(terminalRef.current);
    return () => observer.disconnect();
  }, [terminalReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fit when entering/exiting fullscreen
  useEffect(() => {
    if (!terminalReady || !fitAddonRef.current || !xtermRef.current) return;
    const t1 = setTimeout(() => {
      fitAddonRef.current?.fit();
      const term = xtermRef.current;
      if (term) {
        resize(term.cols, term.rows);
      }
    }, 50);
    const t2 = setTimeout(() => fitAddonRef.current?.fit(), 150);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [isFullscreen, terminalReady]); // eslint-disable-line react-hooks/exhaustive-deps

  return { terminalReady, terminalRef, xtermRef, agentIdRef };
}
