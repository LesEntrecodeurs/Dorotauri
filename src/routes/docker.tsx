import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useDocker } from '@/hooks/useDocker';
import { useXtermTerminal } from '@/hooks/useXtermTerminal';
import { isTauri } from '@/hooks/useTauri';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import type { DockerContainer, ContainerStats, ContainerDetail, DockerImage, DockerVolume, DockerNetwork } from '@/types/docker';
import ServiceMap from '@/components/Docker/ServiceMap';
import {
  Container, Play, Square, RotateCcw, RefreshCw, Search, Loader2, AlertTriangle,
  ChevronDown, ChevronRight, FolderOpen, Box, FileText, Terminal as TerminalIcon,
  X, Trash2, Cpu, MemoryStick, Info, Download, HardDrive, Network, Eraser, GitBranch,
} from 'lucide-react';

// ── Helpers ─────────────────────────────────────────────────────────────────

function stateColor(state: string) {
  switch (state) {
    case 'running': return { dot: 'bg-green-500', bg: 'bg-green-500/15', text: 'text-green-500' };
    case 'exited': return { dot: 'bg-red-500', bg: 'bg-red-500/15', text: 'text-red-500' };
    case 'paused': return { dot: 'bg-yellow-500', bg: 'bg-yellow-500/15', text: 'text-yellow-500' };
    default: return { dot: 'bg-gray-500', bg: 'bg-gray-500/15', text: 'text-gray-500' };
  }
}

function parsePercent(s: string): number { return parseFloat(s.replace('%', '')) || 0; }
function percColor(v: number): string { return v > 80 ? 'bg-red-500' : v > 50 ? 'bg-orange-500' : 'bg-green-500'; }

const DARK_THEME = {
  background: '#0a0a1a', foreground: '#e4e4e7', cursor: '#a78bfa', cursorAccent: '#0a0a1a',
  selectionBackground: '#a78bfa44',
  black: '#1e1e2e', red: '#f87171', green: '#4ade80', yellow: '#facc15',
  blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#e4e4e7',
  brightBlack: '#71717a', brightRed: '#fca5a5', brightGreen: '#86efac', brightYellow: '#fde68a',
  brightBlue: '#93c5fd', brightMagenta: '#d8b4fe', brightCyan: '#67e8f9', brightWhite: '#ffffff',
};

interface ProjectGroup { name: string; containers: DockerContainer[]; runningCount: number; configFile: string | null; }
interface TerminalPanel { type: 'logs' | 'shell' | 'compose-up' | 'compose-down' | 'pull'; label: string; ptyId: string; interactive: boolean; }
type DockerTab = 'containers' | 'images' | 'volumes' | 'disk' | 'map';

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

// ── Port Links ──────────────────────────────────────────────────────────────

function PortLinks({ ports }: { ports: string }) {
  // Parse ports like "0.0.0.0:5432->5432/tcp, 0.0.0.0:15433->80/tcp"
  const links = ports.split(',').map(p => p.trim()).filter(Boolean).map(p => {
    const match = p.match(/(?:[\d.]+:)?(\d+)->(\d+)/);
    if (match) return { host: match[1], container: match[2], raw: p };
    return { host: null, container: null, raw: p };
  });

  if (links.length === 0) return null;

  return (
    <>
      <span className="text-border">|</span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {links.map((link, i) => link.host ? (
          <button key={i} onClick={(e) => { e.stopPropagation(); window.open(`http://localhost:${link.host}`, '_blank'); }}
            className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer" title={`Open localhost:${link.host}`}>
            :{link.host}
          </button>
        ) : (
          <span key={i}>{link.raw}</span>
        ))}
      </div>
    </>
  );
}

// ── Container Row ───────────────────────────────────────────────────────────

function ContainerRow({ container, stats, isActing, onStart, onStop, onRestart, onOpenLogs, onOpenShell, onInspect }: {
  container: DockerContainer; stats: ContainerStats | undefined; isActing: boolean;
  onStart: () => void; onStop: () => void; onRestart: () => void;
  onOpenLogs: () => void; onOpenShell: () => void; onInspect: () => void;
}) {
  const colors = stateColor(container.state);
  const isRunning = container.state === 'running';
  const displayName = container.service || container.names;

  return (
    <motion.div layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors"
    >
      <div className={`w-2 h-2 rounded-full shrink-0 ${colors.dot}`} />
      <div className="flex-1 min-w-0 cursor-pointer" onClick={onInspect}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{displayName}</span>
          <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${colors.bg} ${colors.text} border-0`}>{container.state}</Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
          <span className="truncate">{container.image}</span>
          {container.ports && <PortLinks ports={container.ports} />}
        </div>
        {isRunning && <StatsBars stats={stats} />}
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        {isActing ? <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" /> : (
          <>
            {isRunning && (
              <>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={onOpenLogs} title="Logs"><FileText className="w-3.5 h-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={onOpenShell} title="Shell"><TerminalIcon className="w-3.5 h-3.5" /></Button>
              </>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={onInspect} title="Details"><Info className="w-3.5 h-3.5" /></Button>
            {!isRunning && <Button variant="ghost" size="icon" className="h-7 w-7 text-green-500 hover:text-green-600 hover:bg-green-500/10" onClick={onStart} title="Start"><Play className="w-3.5 h-3.5" /></Button>}
            {isRunning && <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-500/10" onClick={onStop} title="Stop"><Square className="w-3.5 h-3.5" /></Button>}
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={onRestart} title="Restart"><RotateCcw className="w-3.5 h-3.5" /></Button>
          </>
        )}
      </div>
    </motion.div>
  );
}

// ── Project Section ─────────────────────────────────────────────────────────

function ProjectSection({ group, expanded, onToggle, actionLoading, stats, onStartContainer, onStopContainer, onRestartContainer, onStartProject, onStopProject, onOpenLogs, onOpenShell, onInspect, onComposeDown }: {
  group: ProjectGroup; expanded: boolean; onToggle: () => void; actionLoading: string | null; stats: Map<string, ContainerStats>;
  onStartContainer: (id: string) => void; onStopContainer: (id: string) => void; onRestartContainer: (id: string) => void;
  onStartProject: () => void; onStopProject: () => void;
  onOpenLogs: (id: string, name: string) => void; onOpenShell: (id: string, name: string) => void;
  onInspect: (id: string) => void; onComposeDown: () => void;
}) {
  const allRunning = group.runningCount === group.containers.length;
  const noneRunning = group.runningCount === 0;
  const isProjectActing = actionLoading === `project:${group.name}`;
  const isStandalone = group.name === '__standalone__';

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors select-none" onClick={onToggle}>
        {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${allRunning ? 'bg-green-500' : group.runningCount > 0 ? 'bg-orange-500' : 'bg-gray-500'}`} />
        {isStandalone ? <Box className="w-4 h-4 text-muted-foreground shrink-0" /> : <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />}
        <span className="font-semibold text-sm">{isStandalone ? 'Standalone' : group.name}</span>
        <Badge variant="secondary" className="text-[10px] ml-1">{group.runningCount}/{group.containers.length} running</Badge>
        <div className="ml-auto flex items-center gap-1" onClick={e => e.stopPropagation()}>
          {isProjectActing ? <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" /> : (
            <>
              {!allRunning && <Button variant="ghost" size="icon" className="h-7 w-7 text-green-500 hover:text-green-600 hover:bg-green-500/10" onClick={onStartProject} title="Start all"><Play className="w-3.5 h-3.5" /></Button>}
              {!noneRunning && <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-500/10" onClick={onStopProject} title="Stop all"><Square className="w-3.5 h-3.5" /></Button>}
              {group.configFile && <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-500/10" onClick={onComposeDown} title="Remove all (compose down)"><Trash2 className="w-3.5 h-3.5" /></Button>}
            </>
          )}
        </div>
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="border-t border-border overflow-hidden">
            {group.containers.map(c => (
              <ContainerRow key={c.id} container={c} stats={stats.get(c.id)} isActing={actionLoading === c.id}
                onStart={() => onStartContainer(c.id)} onStop={() => onStopContainer(c.id)} onRestart={() => onRestartContainer(c.id)}
                onOpenLogs={() => onOpenLogs(c.id, c.service || c.names)} onOpenShell={() => onOpenShell(c.id, c.service || c.names)}
                onInspect={() => onInspect(c.id)} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Detail Panel ────────────────────────────────────────────────────────────

function DetailPanel({ detail, onClose }: { detail: ContainerDetail; onClose: () => void }) {
  const [tab, setTab] = useState<'env' | 'mounts' | 'network' | 'config'>('env');
  return (
    <motion.div initial={{ height: 0 }} animate={{ height: '40%' }} exit={{ height: 0 }} transition={{ duration: 0.2 }}
      className="border-t border-border bg-card overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 bg-secondary border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          {(['env', 'mounts', 'network', 'config'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-[11px] px-2 py-0.5 rounded ${tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {t === 'env' ? 'Env' : t === 'mounts' ? 'Mounts' : t === 'network' ? 'Network' : 'Config'}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}><X className="w-3.5 h-3.5" /></Button>
      </div>
      <div className="flex-1 overflow-auto p-3 text-xs font-mono">
        {tab === 'env' && (
          <div className="space-y-1">{detail.env.map((e, i) => {
            const [k, ...v] = e.split('=');
            return <div key={i}><span className="text-blue-400">{k}</span>=<span className="text-muted-foreground">{v.join('=')}</span></div>;
          })}</div>
        )}
        {tab === 'mounts' && (
          <div className="space-y-2">{detail.mounts.map((m, i) => (
            <div key={i} className="p-2 rounded bg-muted/50">
              <div><span className="text-muted-foreground">Source:</span> {m.source}</div>
              <div><span className="text-muted-foreground">Dest:</span> {m.destination}</div>
              {m.mode && <div><span className="text-muted-foreground">Mode:</span> {m.mode}</div>}
            </div>
          ))}{detail.mounts.length === 0 && <p className="text-muted-foreground">No mounts</p>}</div>
        )}
        {tab === 'network' && (
          <div className="space-y-2">{detail.networks.map((n, i) => (
            <div key={i} className="p-2 rounded bg-muted/50">
              <div><span className="text-muted-foreground">Network:</span> {n.name}</div>
              <div><span className="text-muted-foreground">IP:</span> {n.ipAddress || 'N/A'}</div>
            </div>
          ))}{detail.networks.length === 0 && <p className="text-muted-foreground">No networks</p>}</div>
        )}
        {tab === 'config' && (
          <div className="space-y-1">
            <div><span className="text-muted-foreground">Hostname:</span> {detail.hostname}</div>
            <div><span className="text-muted-foreground">Working Dir:</span> {detail.workingDir}</div>
            <div><span className="text-muted-foreground">Restart Policy:</span> {detail.restartPolicy}</div>
            <div><span className="text-muted-foreground">Cmd:</span> {detail.cmd.join(' ') || 'N/A'}</div>
            <div><span className="text-muted-foreground">Entrypoint:</span> {detail.entrypoint.join(' ') || 'N/A'}</div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Terminal Panel ──────────────────────────────────────────────────────────

function DockerTerminalPanel({ panel, onClose }: { panel: TerminalPanel; onClose: () => void }) {
  const unlistenRef = useRef<(() => void) | null>(null);
  const handleData = useCallback((data: string) => {
    if (panel.interactive) invoke('pty_write', { ptyId: panel.ptyId, data }).catch(() => {});
  }, [panel.ptyId, panel.interactive]);
  const handleResize = useCallback((cols: number, rows: number) => {
    invoke('pty_resize', { ptyId: panel.ptyId, cols, rows }).catch(() => {});
  }, [panel.ptyId]);
  const { terminalRef, isReady, write } = useXtermTerminal(true, {
    theme: DARK_THEME, fontSize: 12,
    onData: panel.interactive ? handleData : undefined, onResize: handleResize,
  });
  useEffect(() => {
    if (!isReady) return;
    let cancelled = false;
    listen<{ ptyId: string; data: number[] }>('agent:output', (event) => {
      if (cancelled || event.payload.ptyId !== panel.ptyId) return;
      write(new TextDecoder().decode(new Uint8Array(event.payload.data)));
    }).then(fn => { unlistenRef.current = fn; });
    return () => { cancelled = true; unlistenRef.current?.(); };
  }, [isReady, panel.ptyId, write]);

  const typeLabel = { logs: 'Logs', shell: 'Shell', 'compose-up': 'Compose Up', 'compose-down': 'Compose Down', pull: 'Pull' }[panel.type];
  return (
    <motion.div initial={{ height: 0 }} animate={{ height: '40%' }} exit={{ height: 0 }} transition={{ duration: 0.2 }}
      className="border-t border-border bg-[#0a0a1a] overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 bg-secondary border-b border-border shrink-0">
        <div className="flex items-center gap-2 text-xs">
          <Badge variant="secondary" className="text-[10px]">{typeLabel}</Badge>
          <span className="text-muted-foreground">{panel.label}</span>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}><X className="w-3.5 h-3.5" /></Button>
      </div>
      <div ref={terminalRef} className="flex-1 min-h-0" />
    </motion.div>
  );
}

// ── Images Tab ──────────────────────────────────────────────────────────────

function ImagesTab({ images, actionLoading, onRemove, onPull, onFetch }: {
  images: DockerImage[]; actionLoading: string | null;
  onRemove: (id: string) => void; onPull: (name: string) => void; onFetch: () => void;
}) {
  const [pullInput, setPullInput] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => { onFetch(); }, [onFetch]);

  const filtered = images.filter(img => {
    const q = search.toLowerCase();
    return img.repository.toLowerCase().includes(q) || img.tag.toLowerCase().includes(q);
  });

  return (
    <div className="flex-1 overflow-auto">
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Filter images..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>
        <div className="flex items-center gap-1">
          <input type="text" placeholder="Image name to pull..." value={pullInput} onChange={e => setPullInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && pullInput.trim()) { onPull(pullInput.trim()); setPullInput(''); } }}
            className="px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring w-48" />
          <Button variant="outline" size="sm" disabled={!pullInput.trim()} onClick={() => { onPull(pullInput.trim()); setPullInput(''); }}>
            <Download className="w-4 h-4 mr-1" />Pull
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
          <HardDrive className="w-8 h-8 mb-2 opacity-30" />
          <p className="text-sm">{search ? 'No images match.' : 'No images found.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(img => (
            <div key={img.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
              <HardDrive className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{img.repository}:<span className="text-muted-foreground">{img.tag}</span></div>
                <div className="text-xs text-muted-foreground">{img.size} · {img.created}</div>
              </div>
              <div className="text-[10px] text-muted-foreground font-mono">{img.id.slice(0, 12)}</div>
              {actionLoading === img.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-500/10" onClick={() => onRemove(img.id)} title="Remove">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Volumes Tab ─────────────────────────────────────────────────────────────

function VolumesTab({ volumes, networks, actionLoading, onRemoveVolume, onPrune, onFetch }: {
  volumes: DockerVolume[]; networks: DockerNetwork[]; actionLoading: string | null;
  onRemoveVolume: (name: string) => void; onPrune: () => void; onFetch: () => void;
}) {
  useEffect(() => { onFetch(); }, [onFetch]);

  return (
    <div className="flex-1 overflow-auto space-y-6">
      {/* Volumes */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2"><HardDrive className="w-4 h-4" /> Volumes ({volumes.length})</h3>
          <Button variant="outline" size="sm" onClick={onPrune}><Eraser className="w-3.5 h-3.5 mr-1" />Prune unused</Button>
        </div>
        {volumes.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No volumes</p>
        ) : (
          <div className="space-y-2">
            {volumes.map(vol => (
              <div key={vol.name} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{vol.name}</div>
                  <div className="text-xs text-muted-foreground">{vol.driver} · {vol.mountpoint}</div>
                </div>
                {actionLoading === vol.name ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-500/10" onClick={() => onRemoveVolume(vol.name)} title="Remove">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Networks */}
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-3"><Network className="w-4 h-4" /> Networks ({networks.length})</h3>
        {networks.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No networks</p>
        ) : (
          <div className="space-y-2">
            {networks.map(net => (
              <div key={net.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{net.name}</div>
                  <div className="text-xs text-muted-foreground">{net.driver} · {net.scope}</div>
                </div>
                <div className="text-[10px] text-muted-foreground font-mono">{net.id.slice(0, 12)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Disk Usage Tab ──────────────────────────────────────────────────────────

function DiskUsageTab({ onFetch, onPrune }: { onFetch: () => Promise<import('@/types/docker').DockerDiskUsage | null>; onPrune: () => Promise<void> }) {
  const [usage, setUsage] = useState<import('@/types/docker').DockerDiskUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [pruning, setPruning] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const result = await onFetch();
      setUsage(result);
      setLoading(false);
    })();
  }, [onFetch]);

  const handlePrune = async () => {
    setPruning(true);
    await onPrune();
    const result = await onFetch();
    setUsage(result);
    setPruning(false);
  };

  if (loading) return <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (!usage) return <p className="text-sm text-muted-foreground text-center py-8">Could not fetch disk usage.</p>;

  const items = [
    { label: 'Images', count: usage.imagesCount, size: usage.imagesSize, icon: HardDrive, color: 'text-blue-500' },
    { label: 'Containers', count: usage.containersCount, size: usage.containersSize, icon: Container, color: 'text-green-500' },
    { label: 'Volumes', count: usage.volumesCount, size: usage.volumesSize, icon: HardDrive, color: 'text-purple-500' },
    { label: 'Build Cache', count: null, size: usage.buildCacheSize, icon: Cpu, color: 'text-orange-500' },
  ];

  return (
    <div className="flex-1 overflow-auto">
      <div className="grid grid-cols-2 gap-3 mb-6">
        {items.map(item => (
          <div key={item.label} className="p-4 rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 mb-2">
              <item.icon className={`w-4 h-4 ${item.color}`} />
              <span className="text-sm font-medium">{item.label}</span>
            </div>
            <div className="text-2xl font-bold">{item.size || '0B'}</div>
            {item.count !== null && <div className="text-xs text-muted-foreground mt-1">{item.count} item{item.count !== 1 ? 's' : ''}</div>}
          </div>
        ))}
      </div>

      <div className="p-4 rounded-lg border border-destructive/30 bg-destructive/5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">System Prune</p>
            <p className="text-xs text-muted-foreground mt-1">Remove all unused images, containers, volumes and build cache</p>
          </div>
          <Button variant="destructive" size="sm" onClick={handlePrune} disabled={pruning}>
            {pruning ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Eraser className="w-4 h-4 mr-1.5" />}
            {pruning ? 'Cleaning...' : 'Prune All'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function DockerPage() {
  const {
    containers, loading, error, actionLoading, daemonState, setupProgress, stats,
    images, volumes, networks,
    startContainer, stopContainer, restartContainer, startProject, stopProject,
    openLogs, openShell, composeDown, closePty, inspectContainer,
    fetchImages, removeImage, pullImage, fetchVolumes, removeVolume, pruneVolumes,
    fetchDiskUsage, systemPrune,
    refresh, retry,
  } = useDocker();

  const [activeTab, setActiveTab] = useState<DockerTab>('containers');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [terminalPanel, setTerminalPanel] = useState<TerminalPanel | null>(null);
  const [detailPanel, setDetailPanel] = useState<ContainerDetail | null>(null);

  const toggleGroup = (name: string) => setExpanded(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });

  const handleCloseTerminal = useCallback(async () => { if (terminalPanel) { await closePty(terminalPanel.ptyId); setTerminalPanel(null); } }, [terminalPanel, closePty]);
  const handleCloseDetail = useCallback(() => setDetailPanel(null), []);

  const handleOpenLogs = useCallback(async (id: string, name: string) => {
    if (terminalPanel) await closePty(terminalPanel.ptyId);
    setDetailPanel(null);
    const ptyId = `docker-logs-${id}-${Date.now()}`;
    await openLogs(id, ptyId);
    setTerminalPanel({ type: 'logs', label: name, ptyId, interactive: false });
  }, [terminalPanel, closePty, openLogs]);

  const handleOpenShell = useCallback(async (id: string, name: string) => {
    if (terminalPanel) await closePty(terminalPanel.ptyId);
    setDetailPanel(null);
    const ptyId = `docker-exec-${id}-${Date.now()}`;
    await openShell(id, ptyId);
    setTerminalPanel({ type: 'shell', label: name, ptyId, interactive: true });
  }, [terminalPanel, closePty, openShell]);

  const handleInspect = useCallback(async (id: string) => {
    if (terminalPanel) { await closePty(terminalPanel.ptyId); setTerminalPanel(null); }
    const detail = await inspectContainer(id);
    setDetailPanel(detail);
  }, [terminalPanel, closePty, inspectContainer]);

  const handleComposeDown = useCallback(async (configFile: string, projectName: string) => {
    if (terminalPanel) await closePty(terminalPanel.ptyId);
    setDetailPanel(null);
    const ptyId = `docker-compose-down-${Date.now()}`;
    await composeDown(configFile, ptyId);
    setTerminalPanel({ type: 'compose-down', label: projectName, ptyId, interactive: false });
  }, [terminalPanel, closePty, composeDown]);

  const handlePullImage = useCallback(async (name: string) => {
    if (terminalPanel) await closePty(terminalPanel.ptyId);
    setDetailPanel(null);
    const ptyId = `docker-pull-${Date.now()}`;
    await pullImage(name, ptyId);
    setTerminalPanel({ type: 'pull', label: name, ptyId, interactive: false });
  }, [terminalPanel, closePty, pullImage]);

  const groups = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = containers.filter(c => c.names.toLowerCase().includes(q) || c.image.toLowerCase().includes(q) || (c.project || '').toLowerCase().includes(q));
    const map = new Map<string, DockerContainer[]>();
    for (const c of filtered) { const key = c.project || '__standalone__'; const arr = map.get(key) || []; arr.push(c); map.set(key, arr); }
    const result: ProjectGroup[] = [];
    for (const [name, ctrs] of map) {
      result.push({ name, containers: ctrs, runningCount: ctrs.filter(c => c.state === 'running').length, configFile: ctrs.find(c => c.configFile)?.configFile || null });
    }
    result.sort((a, b) => { if (a.name === '__standalone__') return 1; if (b.name === '__standalone__') return -1; return a.name.localeCompare(b.name); });
    return result;
  }, [containers, search]);

  // ── Status screens ──────────────────────────────────────────────────────
  if (!isTauri()) return <div className="flex items-center justify-center h-[60vh] text-center"><div><Container className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" /><p className="text-sm text-muted-foreground">Docker management is only available in the desktop app.</p></div></div>;

  if (daemonState === 'setup') return (
    <div className="flex items-center justify-center h-[60vh] text-center"><div className="w-80">
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto mb-3" />
      <p className="text-sm font-medium mb-3">Setting up Docker...</p>
      <p className="text-xs text-muted-foreground mb-3">{setupProgress.step}</p>
      <div className="w-full bg-muted rounded-full h-2"><div className="bg-primary h-2 rounded-full transition-all duration-500" style={{ width: `${setupProgress.progress}%` }} /></div>
      <p className="text-[11px] text-muted-foreground mt-2">First time setup — downloading ~80MB</p>
    </div></div>
  );

  if (daemonState === 'starting') return (
    <div className="flex items-center justify-center h-[60vh] text-center"><div>
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto mb-3" />
      <p className="text-sm font-medium">Starting Docker VM...</p>
      <p className="text-xs text-muted-foreground mt-1">This can take up to a minute</p>
    </div></div>
  );

  if (daemonState === 'error') return (
    <div className="flex items-center justify-center h-[60vh] text-center"><div className="max-w-md">
      <AlertTriangle className="w-8 h-8 text-destructive/50 mx-auto mb-3" />
      <p className="text-sm font-medium mb-1">Unable to connect to Docker</p>
      <p className="text-xs text-muted-foreground mb-4">{error || 'Could not start the Docker daemon.'}</p>
      <Button variant="outline" size="sm" onClick={retry}><RefreshCw className="w-4 h-4 mr-1.5" />Retry</Button>
    </div></div>
  );

  // ── Main UI ─────────────────────────────────────────────────────────────
  return (
    <div className="h-[calc(100vh-7rem)] lg:h-[calc(100vh-3rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold">Docker</h1>
          <p className="text-sm text-muted-foreground">
            {containers.length} container{containers.length !== 1 ? 's' : ''} · {containers.filter(c => c.state === 'running').length} running
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="w-4 h-4 mr-1.5" />Refresh</Button>
      </div>

      {error && <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-destructive/10 text-destructive text-sm shrink-0"><AlertTriangle className="w-4 h-4 shrink-0" />{error}</div>}

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 shrink-0">
        {([['containers', 'Containers', Container], ['images', 'Images', HardDrive], ['volumes', 'Volumes', HardDrive], ['disk', 'Disk', Cpu], ['map', 'Map', GitBranch]] as const).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setActiveTab(key as DockerTab)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${activeTab === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'containers' && (
        <>
          <div className="relative mb-4 shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input type="text" placeholder="Filter by name, image, or project..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div className="flex-1 overflow-auto min-h-0">
            {loading ? <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            : groups.length === 0 ? <div className="flex flex-col items-center justify-center h-40 text-muted-foreground"><Container className="w-8 h-8 mb-2 opacity-30" /><p className="text-sm">{search ? 'No containers match.' : 'No containers found.'}</p></div>
            : <div className="grid gap-3 pb-4">
                {groups.map(g => <ProjectSection key={g.name} group={g} expanded={expanded.has(g.name)} onToggle={() => toggleGroup(g.name)}
                  actionLoading={actionLoading} stats={stats}
                  onStartContainer={startContainer} onStopContainer={stopContainer} onRestartContainer={restartContainer}
                  onStartProject={() => startProject(g.name)} onStopProject={() => stopProject(g.name)}
                  onOpenLogs={handleOpenLogs} onOpenShell={handleOpenShell} onInspect={handleInspect}
                  onComposeDown={() => g.configFile && handleComposeDown(g.configFile, g.name)} />
                )}
              </div>
            }
          </div>
        </>
      )}

      {activeTab === 'images' && (
        <ImagesTab images={images} actionLoading={actionLoading} onRemove={removeImage} onPull={handlePullImage} onFetch={fetchImages} />
      )}

      {activeTab === 'volumes' && (
        <VolumesTab volumes={volumes} networks={networks} actionLoading={actionLoading} onRemoveVolume={removeVolume} onPrune={pruneVolumes} onFetch={fetchVolumes} />
      )}

      {activeTab === 'disk' && (
        <DiskUsageTab onFetch={fetchDiskUsage} onPrune={systemPrune} />
      )}

      {activeTab === 'map' && (
        <ServiceMap onSelectContainer={handleInspect} />
      )}

      {/* Bottom panels */}
      <AnimatePresence>
        {terminalPanel && <DockerTerminalPanel key={terminalPanel.ptyId} panel={terminalPanel} onClose={handleCloseTerminal} />}
        {detailPanel && !terminalPanel && <DetailPanel key="detail" detail={detailPanel} onClose={handleCloseDetail} />}
      </AnimatePresence>
    </div>
  );
}
