import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@/hooks/useTauri';
import type { SshHostGroup } from '@/types/ssh';

export function useHostGroups() {
  const [groups, setGroups] = useState<SshHostGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const result = await invoke<{ groups: SshHostGroup[] }>('ssh_list_host_groups');
      if (mountedRef.current) {
        setGroups(result.groups);
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

  const createGroup = useCallback(async (name: string, color?: string) => {
    await invoke('ssh_create_host_group', { name, color: color ?? null });
    await refresh();
  }, [refresh]);

  const updateGroup = useCallback(async (id: string, name: string, color: string) => {
    await invoke('ssh_update_host_group', { id, name, color });
    await refresh();
  }, [refresh]);

  const deleteGroup = useCallback(async (id: string) => {
    await invoke('ssh_delete_host_group', { id });
    await refresh();
  }, [refresh]);

  const moveHostToGroup = useCallback(async (hostId: string, groupId: string | null) => {
    await invoke('ssh_move_host_to_group', { hostId, groupId });
    await refresh();
  }, [refresh]);

  return {
    groups, loading, error,
    createGroup, updateGroup, deleteGroup,
    moveHostToGroup, refresh,
  };
}
