import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@/hooks/useTauri';
import type { DockerContainer, DockerStatus, SetupProgress } from '@/types/docker';

const POLL_INTERVAL = 5000;

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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const clearPolling = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const fetchList = useCallback(async (): Promise<DockerContainer[]> => {
    return invoke<DockerContainer[]>('docker_list_containers');
  }, []);

  const startPolling = useCallback(() => {
    clearPolling();
    intervalRef.current = setInterval(async () => {
      if (!mountedRef.current) return;
      try {
        const result = await fetchList();
        if (!mountedRef.current) return;
        setContainers(result);
        setError(null);
      } catch (err) {
        if (!mountedRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (isDaemonError(msg)) {
          clearPolling();
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
            startPolling();
          } catch (retryErr) {
            if (!mountedRef.current) return;
            setError(retryErr instanceof Error ? retryErr.message : String(retryErr));
            setDaemonState('error');
          }
        } else {
          setError(msg);
        }
      }
    }, POLL_INTERVAL);
  }, [fetchList]);

  // Full init: setup → ensure running → fetch → poll
  const initialize = useCallback(async () => {
    if (!isTauri()) {
      setDaemonState('error');
      setLoading(false);
      return;
    }

    // Check current status
    setSetupProgress({ step: 'Checking Docker...', progress: 0 });
    const st = await invoke<DockerStatus>('docker_status');
    if (!mountedRef.current) return;

    // If daemon already ready, skip everything
    if (st.daemonReady) {
      setDaemonState('ready');
      try {
        const result = await fetchList();
        if (!mountedRef.current) return;
        setContainers(result);
      } catch { /* ignore */ }
      setLoading(false);
      startPolling();
      return;
    }

    // Need setup? Download binaries
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

    // Start VM
    setDaemonState('starting');
    try {
      await invoke<string>('docker_ensure_running');
      if (!mountedRef.current) return;
      setDaemonState('ready');
      const result = await fetchList();
      if (!mountedRef.current) return;
      setContainers(result);
      setLoading(false);
      startPolling();
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setDaemonState('error');
      setLoading(false);
    }
  }, [fetchList, startPolling]);

  // Mount
  useEffect(() => {
    mountedRef.current = true;

    // Listen for setup progress events
    let unlisten: (() => void) | null = null;
    if (isTauri()) {
      listen<SetupProgress>('docker:setup-progress', (event) => {
        setSetupProgress(event.payload);
      }).then((fn) => { unlisten = fn; });
    }

    initialize();

    return () => {
      mountedRef.current = false;
      clearPolling();
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

  return {
    containers,
    loading,
    error,
    actionLoading,
    daemonState,
    setupProgress,
    startContainer,
    stopContainer,
    restartContainer,
    startProject,
    stopProject,
    refresh,
    retry,
  };
}
