


import { useEffect, useRef, useCallback } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@/hooks/useTauri';
import 'xterm/css/xterm.css';

interface TerminalProps {
  ptyId?: string;
  onData?: (data: string) => void;
  className?: string;
}

export default function Terminal({ ptyId, onData, className = '' }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const initTerminal = useCallback(() => {
    if (!terminalRef.current || xtermRef.current) return;

    const term = new XTerm({
      theme: {
        background: '#0D0B08',
        foreground: '#e4e4e7',
        cursor: '#3D9B94',
        cursorAccent: '#0D0B08',
        selectionBackground: '#3D9B9433',
        black: '#18181b',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#3D9B94',
        white: '#e4e4e7',
        brightBlack: '#52525b',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#67e8f9',
        brightWhite: '#fafafa',
      },
      fontSize: 13,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Courier New, monospace',
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 10000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Handle terminal input
    term.onData((data) => {
      const cleaned = data.replace(/\x1b\[(?:I|O)/g, '');
      if (!cleaned) return;
      onData?.(cleaned);

      // If we have a PTY, send input to it
      if (ptyId && isTauri()) {
        invoke('pty_write', { ptyId, data: cleaned }).catch(() => {});
      }
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (ptyId && isTauri()) {
        invoke('pty_resize', { ptyId, cols: term.cols, rows: term.rows }).catch(() => {});
      }
    });
    resizeObserver.observe(terminalRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [ptyId, onData]);

  useEffect(() => {
    const cleanup = initTerminal();
    return cleanup;
  }, [initTerminal]);

  // Listen for PTY data via Tauri events
  useEffect(() => {
    if (!ptyId || !isTauri()) return;

    let unlisten: (() => void) | undefined;

    listen<{ agent_id: string; pty_id: string; data: number[] }>('agent:output', (event) => {
      const { pty_id: eventPtyId, data } = event.payload;
      if (eventPtyId === ptyId && xtermRef.current) {
        const bytes = new Uint8Array(data);
        xtermRef.current.write(bytes);
      }
    }).then(fn => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, [ptyId]);

  // Public method to write to terminal
  const write = useCallback((data: string) => {
    xtermRef.current?.write(data);
  }, []);

  // Expose write method via ref
  useEffect(() => {
    if (terminalRef.current) {
      (terminalRef.current as HTMLDivElement & { terminalWrite?: (data: string) => void }).terminalWrite = write;
    }
  }, [write]);

  return (
    <div
      ref={terminalRef}
      className={`bg-[#0D0B08] rounded-none overflow-hidden ${className}`}
      style={{ minHeight: '200px' }}
    />
  );
}

// Hook for using terminal imperatively
export function useTerminalWriter(terminalRef: React.RefObject<HTMLDivElement>) {
  const write = useCallback((data: string) => {
    const el = terminalRef.current as HTMLDivElement & { terminalWrite?: (data: string) => void };
    el?.terminalWrite?.(data);
  }, [terminalRef]);

  return { write };
}
