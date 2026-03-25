import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useDocker } from '@/hooks/useDocker';
import { useXtermTerminal } from '@/hooks/useXtermTerminal';
import { isTauri } from '@/hooks/useTauri';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import type { DockerContainer, ContainerStats } from '@/types/docker';
import {
  Container,
  Play,
  Square,
  RotateCcw,
  RefreshCw,
  Search,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Box,
  FileText,
  Terminal as TerminalIcon,
  X,
  Trash2,
  Cpu,
  MemoryStick,
} from 'lucide-react';

// ── Helpers ─────────────────────────────────────────────────────────────────

function stateColor(state: string) {
  switch (state) {
    case 'running':
      return { dot: 'bg-green-500', bg: 'bg-green-500/15', text: 'text-green-500' };
    case 'exited':
      return { dot: 'bg-red-500', bg: 'bg-red-500/15', text: 'text-red-500' };
    case 'paused':
      return { dot: 'bg-yellow-500', bg: 'bg-yellow-500/15', text: 'text-yellow-500' };
    default:
      return { dot: 'bg-gray-500', bg: 'bg-gray-500/15', text: 'text-gray-500' };
  }
}

function parsePercent(s: string): number {
  return parseFloat(s.replace('%', '')) || 0;
}

function percColor(v: number): string {
  if (v > 80) return 'bg-red-500';
  if (v > 50) return 'bg-orange-500';
  return 'bg-green-500';
}

const DARK_THEME = {
  background: '#0a0a1a',
  foreground: '#e4e4e7',
  cursor: '#a78bfa',
  cursorAccent: '#0a0a1a',
  selectionBackground: '#a78bfa44',
  black: '#1e1e2e', red: '#f87171', green: '#4ade80', yellow: '#facc15',
  blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#e4e4e7',
  brightBlack: '#71717a', brightRed: '#fca5a5', brightGreen: '#86efac', brightYellow: '#fde68a',
  brightBlue: '#93c5fd', brightMagenta: '#d8b4fe', brightCyan: '#67e8f9', brightWhite: '#ffffff',
};

interface ProjectGroup {
  name: string;
  containers: DockerContainer[];
  runningCount: number;
  configFile: string | null;
}

interface TerminalPanel {
  type: 'logs' | 'shell' | 'compose-up' | 'compose-down';
  label: string;
  ptyId: string;
  containerId?: string;
  interactive: boolean;
}

// ── Stats Mini Bars ─────────────────────────────────────────────────────────

function StatsBars({ stats }: { stats: ContainerStats | undefined }) {
  if (!stats) return null;
  const cpu = parsePercent(stats.cpuPerc);
  const mem = parsePercent(stats.memPerc);

  return (
    <div className="flex items-center gap-3 mt-1">
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground w-28">
        <Cpu className="w-3 h-3" />
        <div className="flex-1 bg-muted rounded-full h-1.5">
          <div className={`h-1.5 rounded-full ${percColor(cpu)} transition-all`} style={{ width: `${Math.min(cpu, 100)}%` }} />
        </div>
        <span className="w-8 text-right">{stats.cpuPerc}</span>
      </div>
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground w-36">
        <MemoryStick className="w-3 h-3" />
        <div className="flex-1 bg-muted rounded-full h-1.5">
          <div className={`h-1.5 rounded-full ${percColor(mem)} transition-all`} style={{ width: `${Math.min(mem, 100)}%` }} />
        </div>
        <span className="w-14 text-right truncate">{stats.memUsage.split('/')[0]?.trim()}</span>
      </div>
    </div>
  );
}

// ── Container Row ───────────────────────────────────────────────────────────

function ContainerRow({
  container,
  stats,
  isActing,
  onStart,
  onStop,
  onRestart,
  onOpenLogs,
  onOpenShell,
}: {
  container: DockerContainer;
  stats: ContainerStats | undefined;
  isActing: boolean;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onOpenLogs: () => void;
  onOpenShell: () => void;
}) {
  const colors = stateColor(container.state);
  const isRunning = container.state === 'running';
  const displayName = container.service || container.names;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors"
    >
      <div className={`w-2 h-2 rounded-full shrink-0 ${colors.dot}`} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{displayName}</span>
          <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${colors.bg} ${colors.text} border-0`}>
            {container.state}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
          <span className="truncate">{container.image}</span>
          {container.ports && (
            <>
              <span className="text-border">|</span>
              <span className="truncate">{container.ports}</span>
            </>
          )}
        </div>
        {isRunning && <StatsBars stats={stats} />}
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        {isActing ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
        ) : (
          <>
            {isRunning && (
              <>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={onOpenLogs} title="Logs">
                  <FileText className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={onOpenShell} title="Shell">
                  <TerminalIcon className="w-3.5 h-3.5" />
                </Button>
              </>
            )}
            {!isRunning && (
              <Button variant="ghost" size="icon" className="h-7 w-7 text-green-500 hover:text-green-600 hover:bg-green-500/10" onClick={onStart} title="Start">
                <Play className="w-3.5 h-3.5" />
              </Button>
            )}
            {isRunning && (
              <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-500/10" onClick={onStop} title="Stop">
                <Square className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={onRestart} title="Restart">
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </>
        )}
      </div>
    </motion.div>
  );
}

// ── Project Section ─────────────────────────────────────────────────────────

function ProjectSection({
  group,
  expanded,
  onToggle,
  actionLoading,
  stats,
  onStartContainer,
  onStopContainer,
  onRestartContainer,
  onStartProject,
  onStopProject,
  onOpenLogs,
  onOpenShell,
  onComposeDown,
}: {
  group: ProjectGroup;
  expanded: boolean;
  onToggle: () => void;
  actionLoading: string | null;
  stats: Map<string, ContainerStats>;
  onStartContainer: (id: string) => void;
  onStopContainer: (id: string) => void;
  onRestartContainer: (id: string) => void;
  onStartProject: () => void;
  onStopProject: () => void;
  onOpenLogs: (id: string, name: string) => void;
  onOpenShell: (id: string, name: string) => void;
  onComposeDown: () => void;
}) {
  const allRunning = group.runningCount === group.containers.length;
  const noneRunning = group.runningCount === 0;
  const isProjectActing = actionLoading === `project:${group.name}`;
  const isStandalone = group.name === '__standalone__';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-border bg-card overflow-hidden"
    >
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors select-none"
        onClick={onToggle}
      >
        {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}

        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
          group.runningCount === group.containers.length ? 'bg-green-500' :
          group.runningCount > 0 ? 'bg-orange-500' : 'bg-gray-500'
        }`} />

        {isStandalone ? <Box className="w-4 h-4 text-muted-foreground shrink-0" /> : <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />}

        <span className="font-semibold text-sm">{isStandalone ? 'Standalone' : group.name}</span>

        <Badge variant="secondary" className="text-[10px] ml-1">
          {group.runningCount}/{group.containers.length} running
        </Badge>

        <div className="ml-auto flex items-center gap-1" onClick={e => e.stopPropagation()}>
          {isProjectActing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
          ) : (
            <>
              {!allRunning && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-green-500 hover:text-green-600 hover:bg-green-500/10" onClick={onStartProject} title="Start all">
                  <Play className="w-3.5 h-3.5" />
                </Button>
              )}
              {!noneRunning && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-500/10" onClick={onStopProject} title="Stop all">
                  <Square className="w-3.5 h-3.5" />
                </Button>
              )}
              {group.configFile && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-500/10" onClick={onComposeDown} title="Remove all (compose down)">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="border-t border-border overflow-hidden"
          >
            {group.containers.map(container => (
              <ContainerRow
                key={container.id}
                container={container}
                stats={stats.get(container.id)}
                isActing={actionLoading === container.id}
                onStart={() => onStartContainer(container.id)}
                onStop={() => onStopContainer(container.id)}
                onRestart={() => onRestartContainer(container.id)}
                onOpenLogs={() => onOpenLogs(container.id, container.service || container.names)}
                onOpenShell={() => onOpenShell(container.id, container.service || container.names)}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Docker Terminal Panel ───────────────────────────────────────────────────

function DockerTerminalPanel({
  panel,
  onClose,
}: {
  panel: TerminalPanel;
  onClose: () => void;
}) {
  const unlistenRef = useRef<(() => void) | null>(null);

  const handleData = useCallback((data: string) => {
    if (panel.interactive) {
      invoke('pty_write', { ptyId: panel.ptyId, data }).catch(() => {});
    }
  }, [panel.ptyId, panel.interactive]);

  const handleResize = useCallback((cols: number, rows: number) => {
    invoke('pty_resize', { ptyId: panel.ptyId, cols, rows }).catch(() => {});
  }, [panel.ptyId]);

  const { terminalRef, isReady, write } = useXtermTerminal(true, {
    theme: DARK_THEME,
    fontSize: 12,
    onData: panel.interactive ? handleData : undefined,
    onResize: handleResize,
  });

  // Listen for PTY output
  useEffect(() => {
    if (!isReady) return;
    let cancelled = false;

    listen<{ ptyId: string; data: number[] }>('agent:output', (event) => {
      if (cancelled) return;
      if (event.payload.ptyId === panel.ptyId) {
        const text = new TextDecoder().decode(new Uint8Array(event.payload.data));
        write(text);
      }
    }).then(fn => { unlistenRef.current = fn; });

    return () => {
      cancelled = true;
      unlistenRef.current?.();
    };
  }, [isReady, panel.ptyId, write]);

  const typeLabel = panel.type === 'logs' ? 'Logs' :
    panel.type === 'shell' ? 'Shell' :
    panel.type === 'compose-up' ? 'Compose Up' : 'Compose Down';

  return (
    <motion.div
      initial={{ height: 0 }}
      animate={{ height: '40%' }}
      exit={{ height: 0 }}
      transition={{ duration: 0.2 }}
      className="border-t border-border bg-[#0a0a1a] overflow-hidden flex flex-col"
    >
      <div className="flex items-center justify-between px-3 py-1.5 bg-secondary border-b border-border shrink-0">
        <div className="flex items-center gap-2 text-xs">
          <Badge variant="secondary" className="text-[10px]">{typeLabel}</Badge>
          <span className="text-muted-foreground">{panel.label}</span>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div ref={terminalRef} className="flex-1 min-h-0" />
    </motion.div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function DockerPage() {
  const {
    containers,
    loading,
    error,
    actionLoading,
    daemonState,
    setupProgress,
    stats,
    startContainer,
    stopContainer,
    restartContainer,
    startProject,
    stopProject,
    openLogs,
    openShell,
    composeUp,
    composeDown,
    closePty,
    refresh,
    retry,
  } = useDocker();

  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [terminalPanel, setTerminalPanel] = useState<TerminalPanel | null>(null);

  const toggleGroup = (name: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleCloseTerminal = useCallback(async () => {
    if (terminalPanel) {
      await closePty(terminalPanel.ptyId);
      setTerminalPanel(null);
    }
  }, [terminalPanel, closePty]);

  const handleOpenLogs = useCallback(async (containerId: string, name: string) => {
    if (terminalPanel) await closePty(terminalPanel.ptyId);
    const ptyId = `docker-logs-${containerId}-${Date.now()}`;
    await openLogs(containerId, ptyId);
    setTerminalPanel({ type: 'logs', label: name, ptyId, containerId, interactive: false });
  }, [terminalPanel, closePty, openLogs]);

  const handleOpenShell = useCallback(async (containerId: string, name: string) => {
    if (terminalPanel) await closePty(terminalPanel.ptyId);
    const ptyId = `docker-exec-${containerId}-${Date.now()}`;
    await openShell(containerId, ptyId);
    setTerminalPanel({ type: 'shell', label: name, ptyId, containerId, interactive: true });
  }, [terminalPanel, closePty, openShell]);

  const handleComposeUp = useCallback(async (configFile: string, projectName: string) => {
    if (terminalPanel) await closePty(terminalPanel.ptyId);
    const ptyId = `docker-compose-up-${Date.now()}`;
    await composeUp(configFile, ptyId);
    setTerminalPanel({ type: 'compose-up', label: projectName, ptyId, interactive: false });
  }, [terminalPanel, closePty, composeUp]);

  const handleComposeDown = useCallback(async (configFile: string, projectName: string) => {
    if (terminalPanel) await closePty(terminalPanel.ptyId);
    const ptyId = `docker-compose-down-${Date.now()}`;
    await composeDown(configFile, ptyId);
    setTerminalPanel({ type: 'compose-down', label: projectName, ptyId, interactive: false });
  }, [terminalPanel, closePty, composeDown]);

  const groups = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = containers.filter(c =>
      c.names.toLowerCase().includes(q) || c.image.toLowerCase().includes(q) || (c.project || '').toLowerCase().includes(q)
    );

    const map = new Map<string, DockerContainer[]>();
    for (const c of filtered) {
      const key = c.project || '__standalone__';
      const arr = map.get(key) || [];
      arr.push(c);
      map.set(key, arr);
    }

    const result: ProjectGroup[] = [];
    for (const [name, ctrs] of map) {
      const configFile = ctrs.find(c => c.configFile)?.configFile || null;
      result.push({
        name,
        containers: ctrs,
        runningCount: ctrs.filter(c => c.state === 'running').length,
        configFile,
      });
    }

    result.sort((a, b) => {
      if (a.name === '__standalone__') return 1;
      if (b.name === '__standalone__') return -1;
      return a.name.localeCompare(b.name);
    });

    return result;
  }, [containers, search]);

  if (!isTauri()) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-center">
        <div>
          <Container className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Docker management is only available in the desktop app.</p>
        </div>
      </div>
    );
  }

  if (daemonState === 'setup') {
    return (
      <div className="flex items-center justify-center h-[60vh] text-center">
        <div className="w-80">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium mb-3">Setting up Docker...</p>
          <p className="text-xs text-muted-foreground mb-3">{setupProgress.step}</p>
          <div className="w-full bg-muted rounded-full h-2">
            <div className="bg-primary h-2 rounded-full transition-all duration-500" style={{ width: `${setupProgress.progress}%` }} />
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">First time setup — downloading ~80MB</p>
        </div>
      </div>
    );
  }

  if (daemonState === 'starting') {
    return (
      <div className="flex items-center justify-center h-[60vh] text-center">
        <div>
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium">Starting Docker VM...</p>
          <p className="text-xs text-muted-foreground mt-1">This can take up to a minute</p>
        </div>
      </div>
    );
  }

  if (daemonState === 'error') {
    return (
      <div className="flex items-center justify-center h-[60vh] text-center">
        <div className="max-w-md">
          <AlertTriangle className="w-8 h-8 text-destructive/50 mx-auto mb-3" />
          <p className="text-sm font-medium mb-1">Unable to connect to Docker</p>
          <p className="text-xs text-muted-foreground mb-4">{error || 'Could not start the Docker daemon.'}</p>
          <Button variant="outline" size="sm" onClick={retry}>
            <RefreshCw className="w-4 h-4 mr-1.5" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-7rem)] lg:h-[calc(100vh-3rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold">Docker</h1>
          <p className="text-sm text-muted-foreground">
            {containers.length} container{containers.length !== 1 ? 's' : ''}
            {' \u00b7 '}
            {containers.filter(c => c.state === 'running').length} running
            {' \u00b7 '}
            {groups.filter(g => g.name !== '__standalone__').length} project{groups.filter(g => g.name !== '__standalone__').length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="w-4 h-4 mr-1.5" />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-destructive/10 text-destructive text-sm shrink-0">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="relative mb-4 shrink-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Filter by name, image, or project..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Container list */}
      <div className="flex-1 overflow-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <Container className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-sm">{search ? 'No containers match your filter.' : 'No containers found.'}</p>
          </div>
        ) : (
          <div className="grid gap-3 pb-4">
            {groups.map(group => (
              <ProjectSection
                key={group.name}
                group={group}
                expanded={expanded.has(group.name)}
                onToggle={() => toggleGroup(group.name)}
                actionLoading={actionLoading}
                stats={stats}
                onStartContainer={startContainer}
                onStopContainer={stopContainer}
                onRestartContainer={restartContainer}
                onStartProject={() => startProject(group.name)}
                onStopProject={() => stopProject(group.name)}
                onOpenLogs={handleOpenLogs}
                onOpenShell={handleOpenShell}
                onComposeDown={() => group.configFile && handleComposeDown(group.configFile, group.name)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Terminal Panel */}
      <AnimatePresence>
        {terminalPanel && (
          <DockerTerminalPanel
            key={terminalPanel.ptyId}
            panel={terminalPanel}
            onClose={handleCloseTerminal}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
