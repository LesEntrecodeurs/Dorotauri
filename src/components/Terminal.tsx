'use client';

import { useEffect, useRef, useCallback } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
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
      if (ptyId && window.electronAPI?.pty) {
        window.electronAPI.pty.write({ id: ptyId, data: cleaned });
      }
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (ptyId && window.electronAPI?.pty) {
        window.electronAPI.pty.resize({
          id: ptyId,
          cols: term.cols,
          rows: term.rows,
        });
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

  // Listen for PTY data
  useEffect(() => {
    if (!ptyId || !window.electronAPI?.pty) return;

    const unsubscribe = window.electronAPI.pty.onData(({ id, data }) => {
      if (id === ptyId && xtermRef.current) {
        xtermRef.current.write(data);
      }
    });

    return unsubscribe;
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
      className={`bg-background rounded-none overflow-hidden ${className}`}
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
