


import { useEffect, useRef } from 'react';
import { isTauri } from '@/hooks/useTauri';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { attachShiftEnterHandler } from '@/lib/terminal';
import { TERMINAL_THEME } from '@/components/AgentTerminalDialog/constants';
import type { Agent } from '@/types/electron';

interface UseTrayTerminalProps {
  agentId: string;
  // Callback-ref pattern: React sets this to the DOM element once mounted,
  // guaranteeing the element already has its CSS dimensions.
  container: HTMLDivElement | null;
}


export function useTrayTerminal({ agentId, container }: UseTrayTerminalProps) {
  const xtermRef = useRef<import('xterm').Terminal | null>(null);
  const fitAddonRef = useRef<import('xterm-addon-fit').FitAddon | null>(null);
  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;

  useEffect(() => {
    // container is null until the div mounts (callback-ref sets it).
    // When it is non-null, the element is already in the DOM with its CSS dimensions.
    if (!container) return;

    let cancelled = false;
    let unsubOutput: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const fitTimers: ReturnType<typeof setTimeout>[] = [];

    const init = async () => {
      // Wait for the container to be fully laid out (matches the approach used
      // in useAgentDialogTerminal which works correctly).
      await new Promise(resolve => setTimeout(resolve, 150));
      if (cancelled) return;

      if (container.getBoundingClientRect().width === 0) {
        setTimeout(init, 100);
        return;
      }

      const { Terminal } = await import('xterm');
      const { FitAddon } = await import('xterm-addon-fit');
      if (cancelled) return;

      const term = new Terminal({
        theme: TERMINAL_THEME,
        fontSize: 11,
        fontFamily: 'JetBrains Mono, Menlo, Monaco, Courier New, monospace',
        cursorBlink: true,
        cursorStyle: 'bar',
        scrollback: 3000,
        convertEol: true,
        overviewRulerWidth: 0,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(container);

      if (cancelled) { term.dispose(); return; }

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;

      const doFitAndResize = () => {
        if (cancelled) return;
        fitAddon.fit();
        if (isTauri()) {
          invoke('pty_resize', {
            ptyId: agentIdRef.current,
            cols: term.cols,
            rows: term.rows,
          }).catch(() => {});
        }
      };

      doFitAndResize();
      fitTimers.push(
        setTimeout(() => { if (!cancelled) doFitAndResize(); }, 50),
        setTimeout(() => { if (!cancelled) doFitAndResize(); }, 200),
        setTimeout(() => { if (!cancelled) doFitAndResize(); }, 350),
      );

      // Replay full session output with cursor sequences intact — xterm is a
      // proper terminal emulator and processes them correctly, rendering the
      // final screen state just like live output does.
      // Do NOT strip sequences: stripping causes duplicated/garbled text.
      setTimeout(async () => {
        if (cancelled) return;
        try {
          if (isTauri()) {
            const agentData = await invoke<Agent | null>('agent_get', { id: agentId });
            if (!cancelled && agentData?.output?.length) {
              agentData.output.forEach(chunk => term.write(chunk));
              term.scrollToBottom();
              doFitAndResize();
              term.focus();
            }
          }
        } catch { /* ignore */ }
      }, 400);

      attachShiftEnterHandler(term, (data) => {
        if (isTauri()) {
          invoke('agent_send_input', { id: agentIdRef.current, input: data }).catch(() => {});
        }
      });

      term.onData((data) => {
        if (/^(\x1b\[\?[\d;]*c|\d+;\d+c)+$/.test(data)) return;
        const cleaned = data
          .replace(/\x1b\[\?[\d;]*c/g, '')
          .replace(/\x1b\[\d+;\d+R/g, '')
          .replace(/\x1b\[(?:I|O)/g, '')
          .replace(/\d+;\d+c/g, '');
        if (!cleaned) return;
        if (isTauri()) {
          invoke('agent_send_input', { id: agentIdRef.current, input: cleaned }).catch(() => {});
        }
      });

      resizeObserver = new ResizeObserver(() => {
        if (!cancelled) doFitAndResize();
      });
      resizeObserver.observe(container);

      if (isTauri()) {
        listen<{ agent_id: string; pty_id: string; data: number[] }>('agent:output', (event) => {
          const { agent_id, data } = event.payload;
          if (agent_id === agentIdRef.current && xtermRef.current) {
            const bytes = new Uint8Array(data);
            xtermRef.current.write(bytes);
          }
        }).then(fn => { unsubOutput = fn; });
      }
    };

    init();

    return () => {
      cancelled = true;
      fitTimers.forEach(clearTimeout);
      unsubOutput?.();
      resizeObserver?.disconnect();
      if (xtermRef.current) {
        xtermRef.current.dispose();
        xtermRef.current = null;
        fitAddonRef.current = null;
      }
    };
  }, [container, agentId]);
}
