import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@/hooks/useTauri';
import type { SshHost } from '@/types/ssh';

export function useHosts() {
  const [hosts, setHosts] = useState<SshHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const result = await invoke<{ hosts: SshHost[] }>('ssh_list_hosts');
      if (mountedRef.current) {
        setHosts(result.hosts);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      await refresh();
      if (mountedRef.current) setLoading(false);
    })();
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const createHost = useCallback(async (data: {
    name: string; hostname: string; port?: number; username: string;
    authType: string; password?: string | null; keyPath?: string | null;
    groupId?: string | null;
  }) => {
    await invoke('ssh_create_host', {
      name: data.name,
      hostname: data.hostname,
      port: data.port ?? 22,
      username: data.username,
      authType: data.authType,
      password: data.password ?? null,
      keyPath: data.keyPath ?? null,
      groupId: data.groupId ?? null,
    });
    await refresh();
  }, [refresh]);

  const updateHost = useCallback(async (id: string, data: {
    name: string; hostname: string; port?: number; username: string;
    authType: string; password?: string | null; keyPath?: string | null;
    groupId?: string | null;
  }) => {
    await invoke('ssh_update_host', {
      id,
      name: data.name,
      hostname: data.hostname,
      port: data.port ?? 22,
      username: data.username,
      authType: data.authType,
      password: data.password ?? null,
      keyPath: data.keyPath ?? null,
      groupId: data.groupId ?? null,
    });
    await refresh();
  }, [refresh]);

  const deleteHost = useCallback(async (id: string) => {
    await invoke('ssh_delete_host', { id });
    await refresh();
  }, [refresh]);

  const connectHost = useCallback(async (hostId: string, ptyId: string): Promise<string> => {
    return await invoke<string>('ssh_connect', { hostId, ptyId });
  }, []);

  const closePty = useCallback(async (ptyId: string) => {
    try { await invoke('pty_kill', { ptyId }); } catch { /* ignore */ }
  }, []);

  return {
    hosts, loading, error,
    createHost, updateHost, deleteHost,
    connectHost, closePty, refresh,
  };
}
