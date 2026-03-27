import { useState, useCallback, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { SftpEntry, LocalEntry, Transfer } from '@/types/sftp'
import { v4 as uuidv4 } from 'uuid'

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface TransferProgress {
  transferId: string
  bytesTransferred: number
  totalBytes: number
  percent: number
  status: string
  error: string | null
}

export function useSftp(hostId: string) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected')
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [remoteEntries, setRemoteEntries] = useState<SftpEntry[]>([])
  const [localEntries, setLocalEntries] = useState<LocalEntry[]>([])
  const [remotePath, setRemotePath] = useState('/')
  const [localPath, setLocalPath] = useState('')
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [remoteLoading, setRemoteLoading] = useState(false)
  const [localLoading, setLocalLoading] = useState(false)
  const sessionRef = useRef<string | null>(null)

  // Listen for transfer progress events
  useEffect(() => {
    const unlisten = listen<TransferProgress>('sftp:progress', (event) => {
      const p = event.payload
      setTransfers(prev => prev.map(t =>
        t.id === p.transferId
          ? { ...t, bytesTransferred: p.bytesTransferred, totalBytes: p.totalBytes, percent: p.percent, status: p.status as Transfer['status'], error: p.error ?? undefined }
          : t
      ))
    })
    return () => { unlisten.then(fn => fn()) }
  }, [])

  const connect = useCallback(async () => {
    setConnectionStatus('connecting')
    setConnectionError(null)
    try {
      const sid = await invoke<string>('sftp_connect', { hostId })
      sessionRef.current = sid
      setSessionId(sid)
      setConnectionStatus('connected')

      // Get remote home directory
      try {
        const home = await invoke<string>('sftp_home_dir', { sessionId: sid })
        setRemotePath(home)
        const entries = await invoke<SftpEntry[]>('sftp_list_dir', { sessionId: sid, path: home })
        setRemoteEntries(entries)
      } catch {
        // Fallback to root
        const entries = await invoke<SftpEntry[]>('sftp_list_dir', { sessionId: sid, path: '/' })
        setRemoteEntries(entries)
        setRemotePath('/')
      }

      // Get local home directory
      const home = await import('@tauri-apps/api/path').then(m => m.homeDir())
      setLocalPath(home)
      const localEntries = await invoke<LocalEntry[]>('sftp_list_local_dir', { path: home })
      setLocalEntries(localEntries)
    } catch (err) {
      setConnectionStatus('error')
      setConnectionError(err instanceof Error ? err.message : String(err))
    }
  }, [hostId])

  const disconnect = useCallback(async () => {
    if (sessionRef.current) {
      try { await invoke('sftp_disconnect', { sessionId: sessionRef.current }) } catch {}
      sessionRef.current = null
      setSessionId(null)
    }
    setConnectionStatus('disconnected')
  }, [])

  const navigateRemote = useCallback(async (path: string) => {
    if (!sessionRef.current) return
    setRemoteLoading(true)
    try {
      const entries = await invoke<SftpEntry[]>('sftp_list_dir', { sessionId: sessionRef.current, path })
      setRemoteEntries(entries)
      setRemotePath(path)
    } catch (err) {
      console.error('Failed to navigate remote:', err)
    } finally {
      setRemoteLoading(false)
    }
  }, [])

  const navigateLocal = useCallback(async (path: string) => {
    setLocalLoading(true)
    try {
      const entries = await invoke<LocalEntry[]>('sftp_list_local_dir', { path })
      setLocalEntries(entries)
      setLocalPath(path)
    } catch (err) {
      console.error('Failed to navigate local:', err)
    } finally {
      setLocalLoading(false)
    }
  }, [])

  const upload = useCallback(async (localFilePath: string, fileName: string) => {
    if (!sessionRef.current) return
    const transferId = uuidv4()
    const remoteFilePath = remotePath === '/' ? `/${fileName}` : `${remotePath}/${fileName}`

    setTransfers(prev => [...prev, {
      id: transferId, fileName, direction: 'upload',
      localPath: localFilePath, remotePath: remoteFilePath,
      bytesTransferred: 0, totalBytes: 0, percent: 0, status: 'transferring',
    }])

    try {
      await invoke('sftp_upload', {
        sessionId: sessionRef.current, localPath: localFilePath,
        remotePath: remoteFilePath, transferId,
      })
      // Refresh remote listing
      await navigateRemote(remotePath)
    } catch (err) {
      setTransfers(prev => prev.map(t =>
        t.id === transferId ? { ...t, status: 'error' as const, error: String(err) } : t
      ))
    }
  }, [remotePath, navigateRemote])

  const download = useCallback(async (remoteFilePath: string, fileName: string) => {
    if (!sessionRef.current) return
    const transferId = uuidv4()
    const localFilePath = localPath.endsWith('/') ? `${localPath}${fileName}` : `${localPath}/${fileName}`

    setTransfers(prev => [...prev, {
      id: transferId, fileName, direction: 'download',
      localPath: localFilePath, remotePath: remoteFilePath,
      bytesTransferred: 0, totalBytes: 0, percent: 0, status: 'transferring',
    }])

    try {
      await invoke('sftp_download', {
        sessionId: sessionRef.current, remotePath: remoteFilePath,
        localPath: localFilePath, transferId,
      })
      // Refresh local listing
      await navigateLocal(localPath)
    } catch (err) {
      setTransfers(prev => prev.map(t =>
        t.id === transferId ? { ...t, status: 'error' as const, error: String(err) } : t
      ))
    }
  }, [localPath, navigateLocal])

  const mkdir = useCallback(async (name: string, side: 'local' | 'remote') => {
    if (side === 'remote') {
      if (!sessionRef.current) return
      const fullPath = remotePath === '/' ? `/${name}` : `${remotePath}/${name}`
      await invoke('sftp_mkdir', { sessionId: sessionRef.current, path: fullPath })
      await navigateRemote(remotePath)
    } else {
      const fullPath = localPath.endsWith('/') ? `${localPath}${name}` : `${localPath}/${name}`
      await invoke('sftp_list_local_dir', { path: localPath }) // validate path exists
      // Create local dir via a simple approach
      const { mkdir: fsMkdir } = await import('@tauri-apps/plugin-shell')
        .catch(() => ({ mkdir: null }))
      // Fallback: use invoke for local mkdir isn't available, but we can just do it from Rust
      // For now, we'll handle it client-side
      try {
        await invoke('sftp_list_local_dir', { path: fullPath })
      } catch {
        // Directory doesn't exist, we can't create it client-side easily
        // Let's add a command for this later if needed
      }
      await navigateLocal(localPath)
    }
  }, [remotePath, localPath, navigateRemote, navigateLocal])

  const deleteItem = useCallback(async (path: string, isDir: boolean, side: 'local' | 'remote') => {
    if (side === 'remote') {
      if (!sessionRef.current) return
      await invoke('sftp_delete', { sessionId: sessionRef.current, path, isDir })
      await navigateRemote(remotePath)
    }
    // Local delete would need a separate command — skip for now
  }, [remotePath, navigateRemote])

  const rename = useCallback(async (oldPath: string, newPath: string) => {
    if (!sessionRef.current) return
    await invoke('sftp_rename', { sessionId: sessionRef.current, oldPath, newPath })
    await navigateRemote(remotePath)
  }, [remotePath, navigateRemote])

  const clearCompletedTransfers = useCallback(() => {
    setTransfers(prev => prev.filter(t => t.status !== 'completed' && t.status !== 'error'))
  }, [])

  return {
    sessionId, connectionStatus, connectionError,
    remoteEntries, localEntries, remotePath, localPath,
    remoteLoading, localLoading, transfers,
    connect, disconnect,
    navigateRemote, navigateLocal,
    upload, download, mkdir, deleteItem, rename,
    clearCompletedTransfers,
  }
}
