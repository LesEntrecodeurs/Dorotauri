import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@/hooks/useTauri';
import type { DockerContainer, DockerStatus, SetupProgress, ContainerStats, ContainerDetail, DockerImage, DockerVolume, DockerNetwork, DockerDiskUsage } from '@/types/docker';
import { sendNotification as _sendNotification } from '@tauri-apps/plugin-notification';

function notify(opts: { title: string; body: string }) {
  try { _sendNotification(opts); } catch { /* ignore */ }
}

const LIST_POLL_INTERVAL = 8000;
const STATS_POLL_INTERVAL = 10000;

export type DaemonState = 'setup' | 'starting' | 'ready' | 'error';

function isDaemonError(msg: string): boolean {
  return msg.includes('docker.sock') || msg.includes('daemon') || msg.includes('connect') || msg.includes('Cannot connect');
}

export function useDocker() {
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [daemonState, setDaemonState] = useState<DaemonState>('setup');
  const [setupProgress, setSetupProgress] = useState<SetupProgress>({ step: 'Checking...', progress: 0 });
  const listTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const visibleRef = useRef(true);
  const statsEnabledRef = useRef(true);
  const fetchingListRef = useRef(false);
  const fetchingStatsRef = useRef(false);

  // ── Visibility tracking ───────────────────────────────────────────────
  useEffect(() => {
    const onVisibilityChange = () => {
      visibleRef.current = document.visibilityState === 'visible';
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // ── Polling helpers (setTimeout-based, skip if previous still running) ─
  const clearListPolling = () => {
    if (listTimerRef.current) { clearTimeout(listTimerRef.current); listTimerRef.current = null; }
  };

  const clearStatsPolling = () => {
    if (statsTimerRef.current) { clearTimeout(statsTimerRef.current); statsTimerRef.current = null; }
  };

  const clearAllPolling = () => { clearListPolling(); clearStatsPolling(); };

  const fetchList = useCallback(async (): Promise<DockerContainer[]> => {
    return invoke<DockerContainer[]>('docker_list_containers');
  }, []);

  // ── Container list polling (setTimeout chain — never overlaps) ────────
  const scheduleListPoll = useCallback(() => {
    clearListPolling();
    listTimerRef.current = setTimeout(async () => {
      if (!mountedRef.current) return;
      // Skip if page hidden or already fetching
      if (!visibleRef.current || fetchingListRef.current) {
        scheduleListPoll();
        return;
      }
      fetchingListRef.current = true;
      try {
        const result = await fetchList();
        if (!mountedRef.current) return;
        setContainers(result);
        setError(null);
      } catch (err) {
        if (!mountedRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (isDaemonError(msg)) {
          clearAllPolling();
          setContainers([]);
          setDaemonState('starting');
          setError(null);
          try {
            await invoke<string>('docker_ensure_running');
            if (!mountedRef.current) return;
            const result = await fetchList();
            if (!mountedRef.current) return;
            setContainers(result);
            setDaemonState('ready');
          } catch (retryErr) {
            if (!mountedRef.current) return;
            setError(retryErr instanceof Error ? retryErr.message : String(retryErr));
            setDaemonState('error');
            return;
          }
        } else {
          setError(msg);
        }
      } finally {
        fetchingListRef.current = false;
      }
      // Schedule next poll after completion
      if (mountedRef.current) scheduleListPoll();
    }, LIST_POLL_INTERVAL);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchList]);

  // ── Stats polling (setTimeout chain — never overlaps) ─────────────────
  const [stats, setStats] = useState<Map<string, ContainerStats>>(new Map());

  const scheduleStatsPoll = useCallback(() => {
    clearStatsPolling();
    statsTimerRef.current = setTimeout(async () => {
      if (!mountedRef.current) return;
      // Skip if page hidden, stats disabled, or already fetching
      if (!visibleRef.current || !statsEnabledRef.current || fetchingStatsRef.current) {
        scheduleStatsPoll();
        return;
      }
      fetchingStatsRef.current = true;
      try {
        const result = await invoke<ContainerStats[]>('docker_container_stats');
        if (!mountedRef.current) return;
        const map = new Map<string, ContainerStats>();
        for (const s of result) map.set(s.id, s);
        setStats(map);
      } catch { /* ignore stats errors */ }
      finally { fetchingStatsRef.current = false; }
      if (mountedRef.current) scheduleStatsPoll();
    }, STATS_POLL_INTERVAL);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Control stats polling from outside ────────────────────────────────
  const setStatsEnabled = useCallback((enabled: boolean) => {
    statsEnabledRef.current = enabled;
    if (!enabled) {
      clearStatsPolling();
      setStats(new Map());
    }
  }, []);

  // ── Initialization ────────────────────────────────────────────────────
  const startAllPolling = useCallback(() => {
    scheduleListPoll();
    // Stagger stats 3s after list poll to avoid concurrent docker CLI calls
    setTimeout(() => {
      if (mountedRef.current) scheduleStatsPoll();
    }, 3000);
  }, [scheduleListPoll, scheduleStatsPoll]);

  const initialize = useCallback(async () => {
    if (!isTauri()) {
      setDaemonState('error');
      setLoading(false);
      return;
    }

    setSetupProgress({ step: 'Checking Docker...', progress: 0 });
    const st = await invoke<DockerStatus>('docker_status');
    if (!mountedRef.current) return;

    if (st.daemonReady) {
      setDaemonState('ready');
      try {
        const result = await fetchList();
        if (!mountedRef.current) return;
        setContainers(result);
      } catch { /* ignore */ }
      setLoading(false);
      startAllPolling();
      return;
    }

    if (!st.binariesInstalled && !st.colimaInstalled) {
      setDaemonState('setup');
      setSetupProgress({ step: 'Downloading Docker runtime...', progress: 5 });
      try {
        await invoke('docker_setup');
        if (!mountedRef.current) return;
      } catch (err) {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
        setDaemonState('error');
        setLoading(false);
        return;
      }
    }

    setDaemonState('starting');
    try {
      await invoke<string>('docker_ensure_running');
      if (!mountedRef.current) return;
      setDaemonState('ready');
      const result = await fetchList();
      if (!mountedRef.current) return;
      setContainers(result);
      setLoading(false);
      startAllPolling();
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setDaemonState('error');
      setLoading(false);
    }
  }, [fetchList, startAllPolling]);

  // ── Mount / unmount ───────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;

    let unlisten: (() => void) | null = null;
    if (isTauri()) {
      listen<SetupProgress>('docker:setup-progress', (event) => {
        setSetupProgress(event.payload);
      }).then((fn) => { unlisten = fn; });
    }

    initialize();

    return () => {
      mountedRef.current = false;
      clearAllPolling();
      if (unlisten) unlisten();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = useCallback(async () => {
    setError(null);
    setLoading(true);
    await initialize();
  }, [initialize]);

  const refresh = useCallback(async () => {
    try {
      const result = await fetchList();
      setContainers(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [fetchList]);

  // ── Container actions ─────────────────────────────────────────────────
  const startContainer = useCallback(async (id: string) => {
    setActionLoading(id);
    try {
      await invoke('docker_start_container', { id });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [refresh]);

  const stopContainer = useCallback(async (id: string) => {
    setActionLoading(id);
    try {
      await invoke('docker_stop_container', { id });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [refresh]);

  const restartContainer = useCallback(async (id: string) => {
    setActionLoading(id);
    try {
      await invoke('docker_restart_container', { id });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [refresh]);

  const startProject = useCallback(async (projectName: string) => {
    const match = projectName === '__standalone__'
      ? (c: DockerContainer) => c.project === null
      : (c: DockerContainer) => c.project === projectName;
    const toStart = containers.filter(c => match(c) && c.state !== 'running');
    if (toStart.length === 0) return;
    setActionLoading(`project:${projectName}`);
    try {
      await Promise.all(toStart.map(c => invoke('docker_start_container', { id: c.id })));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [containers, refresh]);

  const stopProject = useCallback(async (projectName: string) => {
    const match = projectName === '__standalone__'
      ? (c: DockerContainer) => c.project === null
      : (c: DockerContainer) => c.project === projectName;
    const toStop = containers.filter(c => match(c) && c.state === 'running');
    if (toStop.length === 0) return;
    setActionLoading(`project:${projectName}`);
    try {
      await Promise.all(toStop.map(c => invoke('docker_stop_container', { id: c.id })));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [containers, refresh]);

  // ── Terminal actions (logs, shell, compose) ───────────────────────────
  const openLogs = useCallback(async (containerId: string, ptyId: string) => {
    await invoke('docker_container_logs', { id: containerId, ptyId });
  }, []);

  const openShell = useCallback(async (containerId: string, ptyId: string) => {
    await invoke('docker_exec_shell', { id: containerId, ptyId });
  }, []);

  const composeUp = useCallback(async (configFile: string, ptyId: string) => {
    await invoke('docker_compose_up', { configFile, ptyId });
  }, []);

  const composeDown = useCallback(async (configFile: string, ptyId: string) => {
    await invoke('docker_compose_down', { configFile, ptyId });
  }, []);

  const closePty = useCallback(async (ptyId: string) => {
    try {
      await invoke('pty_kill', { ptyId });
    } catch { /* ignore */ }
  }, []);

  // ── Inspect ───────────────────────────────────────────────────────────
  const inspectContainer = useCallback(async (id: string): Promise<ContainerDetail | null> => {
    try {
      return await invoke<ContainerDetail>('docker_inspect_container', { id });
    } catch {
      return null;
    }
  }, []);

  // ── Images ────────────────────────────────────────────────────────────
  const [images, setImages] = useState<DockerImage[]>([]);

  const fetchImages = useCallback(async () => {
    try {
      const result = await invoke<DockerImage[]>('docker_list_images');
      setImages(result);
    } catch { /* ignore */ }
  }, []);

  const removeImage = useCallback(async (id: string) => {
    setActionLoading(id);
    try {
      await invoke('docker_remove_image', { id });
      await fetchImages();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [fetchImages]);

  const pullImage = useCallback(async (name: string, ptyId: string) => {
    await invoke('docker_pull_image', { name, ptyId });
  }, []);

  // ── Volumes ───────────────────────────────────────────────────────────
  const [volumes, setVolumes] = useState<DockerVolume[]>([]);
  const [networks, setNetworks] = useState<DockerNetwork[]>([]);

  const fetchVolumes = useCallback(async () => {
    try {
      const [vols, nets] = await Promise.all([
        invoke<DockerVolume[]>('docker_list_volumes'),
        invoke<DockerNetwork[]>('docker_list_networks'),
      ]);
      setVolumes(vols);
      setNetworks(nets);
    } catch { /* ignore */ }
  }, []);

  const removeVolume = useCallback(async (name: string) => {
    setActionLoading(name);
    try {
      await invoke('docker_remove_volume', { name });
      await fetchVolumes();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [fetchVolumes]);

  const pruneVolumes = useCallback(async () => {
    try {
      await invoke<string>('docker_prune_volumes');
      await fetchVolumes();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [fetchVolumes]);

  // ── Health notifications ──────────────────────────────────────────────
  const prevStatesRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (daemonState !== 'ready' || containers.length === 0) return;

    const prev = prevStatesRef.current;
    for (const c of containers) {
      const prevState = prev.get(c.id);
      if (prevState && prevState === 'running' && (c.state === 'exited' || c.state === 'restarting')) {
        notify({
          title: 'Docker Container Alert',
          body: `${c.service || c.names} has ${c.state === 'restarting' ? 'entered a restart loop' : 'stopped unexpectedly'}`,
        });
      }
    }

    const newMap = new Map<string, string>();
    for (const c of containers) newMap.set(c.id, c.state);
    prevStatesRef.current = newMap;
  }, [containers, daemonState]);

  useEffect(() => {
    if (stats.size === 0) return;
    for (const [, s] of stats) {
      const cpu = parseFloat(s.cpuPerc.replace('%', '')) || 0;
      const mem = parseFloat(s.memPerc.replace('%', '')) || 0;
      if (cpu > 90 || mem > 90) {
        const container = containers.find(c => c.id === s.id);
        const name = container?.service || container?.names || s.id;
        notify({
          title: 'Docker Resource Alert',
          body: `${name}: CPU ${s.cpuPerc}, Memory ${s.memPerc}`,
        });
        break;
      }
    }
  }, [stats, containers]);

  return {
    containers,
    loading,
    error,
    actionLoading,
    daemonState,
    setupProgress,
    stats,
    images,
    volumes,
    networks,
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
    inspectContainer,
    fetchImages,
    removeImage,
    pullImage,
    fetchVolumes,
    removeVolume,
    pruneVolumes,
    setStatsEnabled,
    fetchDiskUsage: useCallback(async (): Promise<DockerDiskUsage | null> => {
      try { return await invoke<DockerDiskUsage>('docker_disk_usage'); }
      catch { return null; }
    }, []),
    systemPrune: useCallback(async () => {
      try {
        await invoke<string>('docker_system_prune');
        await fetchImages();
        await fetchVolumes();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }, [fetchImages, fetchVolumes]),
    refresh,
    retry,
  };
}
