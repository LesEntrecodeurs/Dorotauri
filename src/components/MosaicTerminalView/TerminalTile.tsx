import { useRef, useEffect, memo } from 'react';
import type { Terminal } from 'xterm';
import type { FitAddon } from 'xterm-addon-fit';
import { isTauri } from '@/hooks/useTauri';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AgentStatus } from '@/types/electron';
import { getTerminalTheme, TERMINAL_CONFIG } from '@/components/AgentWorld/constants';

interface TerminalTileProps {
  agentId: string;
}

/**
 * A single terminal tile for the mosaic layout.
 * Spawns a real PTY shell so the user can type immediately.
 * Output streams via Tauri events, input goes via pty_write.
 */
function TerminalTileInner({ agentId }: TerminalTileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || initRef.current) return;
    initRef.current = true;

    let cancelled = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      // Dynamic import xterm
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

      // Create xterm instance
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

      // Initial fit
      try { fitAddon.fit(); } catch {}

      if (!isTauri()) {
        term.write('Not running in Tauri — terminal unavailable.\r\n');
        cleanup = () => term.dispose();
        return;
      }

      // Get agent info to determine project directory
      let cwd = '/home';
      try {
        const agent = await invoke<AgentStatus | null>('agent_get', { id: agentId });
        if (agent?.projectPath) cwd = agent.projectPath;
      } catch {}

      // Spawn a real PTY shell in the agent's project directory
      let ptyId: string;
      try {
        const { cols, rows } = term;
        ptyId = await invoke<string>('pty_create', { cwd, cols, rows });
      } catch (err) {
        term.write(`\x1b[31mFailed to create PTY: ${err}\x1b[0m\r\n`);
        cleanup = () => term.dispose();
        return;
      }

      // Subscribe to PTY output
      let unsubOutput: (() => void) | undefined;
      let disposed = false;

      listen<{ agent_id: string; pty_id: string; data: number[] }>('agent:output', (event) => {
        if ((event.payload.agent_id === ptyId || event.payload.pty_id === ptyId) && !disposed) {
          term.write(new Uint8Array(event.payload.data));
        }
      }).then(fn => { unsubOutput = fn; });

      // Forward keyboard input to PTY
      term.onData((data) => {
        if (/^(\x1b\[\?[\d;]*c|\d+;\d+c)+$/.test(data)) return;
        invoke('pty_write', { ptyId, data }).catch(() => {});
      });

      // ResizeObserver
      const resizeObserver = new ResizeObserver(() => {
        if (disposed) return;
        try {
          fitAddon.fit();
          const { cols, rows } = term;
          invoke('pty_resize', { ptyId, cols, rows }).catch(() => {});
        } catch {}
      });
      resizeObserver.observe(container);

      cleanup = () => {
        disposed = true;
        resizeObserver.disconnect();
        unsubOutput?.();
        invoke('pty_kill', { ptyId }).catch(() => {});
        term.dispose();
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
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

const TerminalTile = memo(TerminalTileInner);
export default TerminalTile;
