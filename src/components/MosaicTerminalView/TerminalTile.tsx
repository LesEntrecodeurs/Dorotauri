import { useRef, useEffect, memo } from 'react';
import type { Terminal } from 'xterm';
import type { FitAddon } from 'xterm-addon-fit';
import { isTauri } from '@/hooks/useTauri';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Agent } from '@/types/electron';
import { getTerminalTheme, TERMINAL_CONFIG } from '@/components/AgentTerminalDialog/constants';
import { attachKeyHandler, attachWebGL, disposeWebGL } from '@/lib/terminal';
import { TerminalWriteManager } from '@/lib/terminal-write';

interface TerminalTileProps {
  agentId: string;
}

// --- Persistent terminal cache ---
// Survives tab switches: xterm instances stay alive with full scrollback,
// PTY subscriptions, and output listeners intact.

interface CachedTerminal {
  terminal: Terminal;
  fitAddon: FitAddon;
  ptyId: string;
  unsubOutput?: () => void;
  resizeObserver: ResizeObserver | null;
}

const terminalCache = new Map<string, CachedTerminal>();

/** Dispose and remove a cached terminal (call when agent is deleted). */
export function disposeCachedTerminal(agentId: string) {
  const cached = terminalCache.get(agentId);
  if (!cached) return;
  cached.resizeObserver?.disconnect();
  cached.unsubOutput?.();
  TerminalWriteManager.unsubscribe(cached.ptyId);
  disposeWebGL(cached.terminal);
  cached.terminal.dispose();
  terminalCache.delete(agentId);
}

/**
 * A single terminal tile for the mosaic layout.
 * Spawns a real PTY shell so the user can type immediately.
 * Terminal instances are cached so tab switches preserve full state.
 */
function TerminalTileInner({ agentId }: TerminalTileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || initRef.current) return;
    initRef.current = true;

    // Check cache first — reattach existing terminal to new container
    const cached = terminalCache.get(agentId);
    if (cached && cached.terminal.element) {
      disposeWebGL(cached.terminal);
      container.appendChild(cached.terminal.element);
      attachWebGL(cached.terminal);

      // Reconnect resize observer to new container
      cached.resizeObserver?.disconnect();
      const resizeObserver = new ResizeObserver(() => {
        try {
          cached.fitAddon.fit();
          const { cols, rows } = cached.terminal;
          invoke('pty_resize', { ptyId: cached.ptyId, cols, rows }).catch(() => {});
        } catch {}
      });
      resizeObserver.observe(container);
      cached.resizeObserver = resizeObserver;

      // Fit to new container size
      try { cached.fitAddon.fit(); } catch {}

      return;
    }

    // No cache — create fresh terminal
    let cancelled = false;

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('xterm'),
        import('xterm-addon-fit'),
      ]);
      if (cancelled) return;

      // Wait for container to have dimensions
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const rect = container.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) {
        const ready = await new Promise<boolean>(resolve => {
          let resolved = false;
          const observer = new ResizeObserver((entries) => {
            if (resolved) return;
            for (const e of entries) {
              if (e.contentRect.width >= 10 && e.contentRect.height >= 10) {
                resolved = true;
                observer.disconnect();
                resolve(true);
              }
            }
          });
          observer.observe(container);
          setTimeout(() => { if (!resolved) { resolved = true; observer.disconnect(); resolve(false); } }, 3000);
        });
        if (!ready || cancelled) return;
      }

      const term = new Terminal({
        theme: getTerminalTheme('dark'),
        fontSize: TERMINAL_CONFIG.fontSize || 13,
        fontFamily: TERMINAL_CONFIG.fontFamily,
        cursorBlink: true,
        cursorStyle: 'block',
        scrollback: 10000,
        convertEol: true,
        allowProposedApi: true,
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(container);
      attachWebGL(term);

      try { fitAddon.fit(); } catch {}

      if (!isTauri()) {
        term.write('Not running in Tauri — terminal unavailable.\r\n');
        return;
      }

      // Get agent info to determine project directory
      let cwd = '/home';
      try {
        const agent = await invoke<Agent | null>('agent_get', { id: agentId });
        if (agent?.cwd) cwd = agent.cwd;
      } catch {}

      // Check if there's already a PTY for this agent
      let ptyId: string;
      try {
        const existing = await invoke<string | null>('pty_lookup', { key: agentId });
        if (existing) {
          ptyId = existing;
        } else {
          const { cols, rows } = term;
          ptyId = await invoke<string>('pty_create', { cwd, cols, rows });
          await invoke('pty_register', { key: agentId, ptyId });
        }
      } catch (err) {
        term.write(`\x1b[31mFailed to create PTY: ${err}\x1b[0m\r\n`);
        return;
      }

      // Subscribe to PTY output
      TerminalWriteManager.subscribe(ptyId, term, ptyId);

      const unsubOutput = await listen<{ agent_id: string; pty_id: string; data: number[] }>('agent:output', (event) => {
        if (event.payload.agent_id === ptyId || event.payload.pty_id === ptyId) {
          TerminalWriteManager.write(ptyId, new Uint8Array(event.payload.data));
        }
      });

      attachKeyHandler(term, (data) => {
        invoke('pty_write', { ptyId, data }).catch(() => {});
      });

      term.onData((data) => {
        if (/^(\x1b\[\?[\d;]*c|\d+;\d+c)+$/.test(data)) return;
        invoke('pty_write', { ptyId, data }).catch(() => {});
      });

      // ResizeObserver
      const resizeObserver = new ResizeObserver(() => {
        try {
          fitAddon.fit();
          const { cols, rows } = term;
          invoke('pty_resize', { ptyId, cols, rows }).catch(() => {});
        } catch {}
      });
      resizeObserver.observe(container);

      // Store in cache
      terminalCache.set(agentId, {
        terminal: term,
        fitAddon,
        ptyId,
        unsubOutput,
        resizeObserver,
      });
    })();

    return () => {
      cancelled = true;
      // On unmount: only disconnect resize observer, keep everything else alive
      const entry = terminalCache.get(agentId);
      if (entry) {
        entry.resizeObserver?.disconnect();
        entry.resizeObserver = null;
      }
      initRef.current = false;
    };
  }, [agentId]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden"
      style={{ backgroundColor: '#1A1726' }}
    />
  );
}

const TerminalTile = memo(TerminalTileInner);
export default TerminalTile;
