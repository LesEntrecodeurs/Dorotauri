import { useState, useCallback, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/hooks/useTauri'
import type { SftpHost } from '@/types/sftp-host'

export function useSftpHosts() {
  const [hosts, setHosts] = useState<SftpHost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const refresh = useCallback(async () => {
    if (!isTauri()) return
    try {
      const result = await invoke<{ hosts: SftpHost[] }>('sftp_list_hosts')
      if (mountedRef.current) {
        setHosts(result.hosts)
        setError(null)
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    ;(async () => {
      await refresh()
      if (mountedRef.current) setLoading(false)
    })()
    return () => { mountedRef.current = false }
  }, [refresh])

  const createHost = useCallback(async (data: {
    name: string; hostname: string; port?: number; username: string;
    authType: string; password?: string | null; keyPath?: string | null;
  }) => {
    await invoke('sftp_create_host', {
      name: data.name,
      hostname: data.hostname,
      port: data.port ?? 22,
      username: data.username,
      authType: data.authType,
      password: data.password ?? null,
      keyPath: data.keyPath ?? null,
    })
    await refresh()
  }, [refresh])

  const updateHost = useCallback(async (id: string, data: {
    name: string; hostname: string; port?: number; username: string;
    authType: string; password?: string | null; keyPath?: string | null;
  }) => {
    await invoke('sftp_update_host', {
      id,
      name: data.name,
      hostname: data.hostname,
      port: data.port ?? 22,
      username: data.username,
      authType: data.authType,
      password: data.password ?? null,
      keyPath: data.keyPath ?? null,
    })
    await refresh()
  }, [refresh])

  const deleteHost = useCallback(async (id: string) => {
    await invoke('sftp_delete_host', { id })
    await refresh()
  }, [refresh])

  const openSftp = useCallback(async (host: SftpHost) => {
    const label = `${host.name} — ${host.username}@${host.hostname}`
    await invoke('sftp_open_window', { hostId: host.id, label })
  }, [])

  return {
    hosts, loading, error,
    createHost, updateHost, deleteHost,
    openSftp, refresh,
  }
}
