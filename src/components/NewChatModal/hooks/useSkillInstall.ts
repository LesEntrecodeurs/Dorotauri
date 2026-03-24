import { useState, useEffect, useRef, useCallback } from 'react';
import { isTauri } from '@/hooks/useTauri';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { TERMINAL_THEME, TERMINAL_CONFIG } from '@/components/AgentTerminalDialog/constants';
import type { Skill } from '@/lib/skills-database';

export interface SkillInstallState {
  showInstallTerminal: boolean;
  installingSkill: { name: string; repo: string } | null;
  installComplete: boolean;
  installExitCode: number | null;
  terminalRef: React.RefObject<HTMLDivElement | null>;
  handleInstallSkill: (skill: Skill) => void;
  closeInstallTerminal: () => void;
}

export function useSkillInstall(onRefreshSkills?: () => void): SkillInstallState {
  const [showInstallTerminal, setShowInstallTerminal] = useState(false);
  const [installingSkill, setInstallingSkill] = useState<{ name: string; repo: string } | null>(null);
  const [installComplete, setInstallComplete] = useState(false);
  const [installExitCode, setInstallExitCode] = useState<number | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<import('xterm').Terminal | null>(null);
  const ptyIdRef = useRef<string | null>(null);

  // Initialize xterm when install terminal opens
  useEffect(() => {
    if (!showInstallTerminal || !terminalRef.current || xtermRef.current) return;

    const initTerminal = async () => {
      const { Terminal } = await import('xterm');
      const { FitAddon } = await import('xterm-addon-fit');

      const term = new Terminal({
        theme: TERMINAL_THEME,
        ...TERMINAL_CONFIG,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalRef.current!);
      fitAddon.fit();

      xtermRef.current = term;

      // Handle user input
      term.onData((data) => {
        if (ptyIdRef.current && isTauri()) {
          invoke('pty_write', { ptyId: ptyIdRef.current, data }).catch(() => {});
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
      if (xtermRef.current) {
        xtermRef.current.dispose();
        xtermRef.current = null;
      }
      setTerminalReady(false);
    };
  }, [showInstallTerminal]);

  // Start PTY after terminal is ready
  useEffect(() => {
    if (!terminalReady || !installingSkill || !isTauri()) return;

    const startPty = async () => {
      try {
        const fullRepo = `${installingSkill.repo}/${installingSkill.name}`;
        const ptyId = await invoke<string>('pty_create', {});
        ptyIdRef.current = ptyId;
        // Run the skill install command
        await invoke('pty_write', { ptyId, data: `claude mcp add-from-claude-code ${fullRepo}\n` });
      } catch (err) {
        console.error('Failed to start installation:', err);
        setShowInstallTerminal(false);
        setInstallingSkill(null);
      }
    };

    startPty();
  }, [terminalReady, installingSkill]);

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
        if (exit_code === 0 && onRefreshSkills) {
          onRefreshSkills();
        }
      }
    }).then(fn => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, [onRefreshSkills]);

  const handleInstallSkill = useCallback((skill: Skill) => {
    setInstallingSkill({ name: skill.name, repo: skill.repo });
    setInstallComplete(false);
    setInstallExitCode(null);
    ptyIdRef.current = null;
    setShowInstallTerminal(true);
  }, []);

  const closeInstallTerminal = useCallback(() => {
    if (ptyIdRef.current && !installComplete && isTauri()) {
      invoke('pty_kill', { ptyId: ptyIdRef.current }).catch(() => {});
    }
    setShowInstallTerminal(false);
    setInstallingSkill(null);
    ptyIdRef.current = null;
    if (xtermRef.current) {
      xtermRef.current.dispose();
      xtermRef.current = null;
    }
  }, [installComplete]);

  return {
    showInstallTerminal,
    installingSkill,
    installComplete,
    installExitCode,
    terminalRef,
    handleInstallSkill,
    closeInstallTerminal,
  };
}
