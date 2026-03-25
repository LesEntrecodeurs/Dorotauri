import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@/hooks/useTauri';
import type { DockerContainer } from '@/types/docker';

const POLL_INTERVAL = 5000;

export function useDocker() {
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchContainers = useCallback(async () => {
    if (!isTauri()) {
      setLoading(false);
      return;
    }
    try {
      const result = await invoke<DockerContainer[]>('docker_list_containers');
      setContainers(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const startContainer = useCallback(async (id: string) => {
    setActionLoading(id);
    try {
      await invoke('docker_start_container', { id });
      await fetchContainers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [fetchContainers]);

  const stopContainer = useCallback(async (id: string) => {
    setActionLoading(id);
    try {
      await invoke('docker_stop_container', { id });
      await fetchContainers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [fetchContainers]);

  const restartContainer = useCallback(async (id: string) => {
    setActionLoading(id);
    try {
      await invoke('docker_restart_container', { id });
      await fetchContainers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [fetchContainers]);

  useEffect(() => {
    fetchContainers();
    intervalRef.current = setInterval(fetchContainers, POLL_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchContainers]);

  const startProject = useCallback(async (projectName: string) => {
    const match = projectName === '__standalone__'
      ? (c: DockerContainer) => c.project === null
      : (c: DockerContainer) => c.project === projectName;
    const toStart = containers.filter(c => match(c) && c.state !== 'running');
    if (toStart.length === 0) return;
    setActionLoading(`project:${projectName}`);
    try {
      await Promise.all(toStart.map(c => invoke('docker_start_container', { id: c.id })));
      await fetchContainers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [containers, fetchContainers]);

  const stopProject = useCallback(async (projectName: string) => {
    const match = projectName === '__standalone__'
      ? (c: DockerContainer) => c.project === null
      : (c: DockerContainer) => c.project === projectName;
    const toStop = containers.filter(c => match(c) && c.state === 'running');
    if (toStop.length === 0) return;
    setActionLoading(`project:${projectName}`);
    try {
      await Promise.all(toStop.map(c => invoke('docker_stop_container', { id: c.id })));
      await fetchContainers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }, [containers, fetchContainers]);

  return {
    containers,
    loading,
    error,
    actionLoading,
    startContainer,
    stopContainer,
    restartContainer,
    startProject,
    stopProject,
    refresh: fetchContainers,
  };
}
