import { useParams, useSearchParams } from 'react-router'
import { useEffect, useCallback, useState } from 'react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useSftp } from '@/hooks/useSftp'
import { FilePane, type FileEntry } from '@/components/sftp/FilePane'
import { TransferQueue } from '@/components/sftp/TransferQueue'
import {
  RefreshCw, FolderPlus, Wifi, WifiOff, Loader2,
  ArrowRightLeft, Upload, Download,
} from 'lucide-react'
import '../globals.css'

export default function SftpBrowser() {
  const { hostId } = useParams()
  const [searchParams] = useSearchParams()
  const label = searchParams.get('label') || 'SFTP'

  const sftp = useSftp(hostId || '')

  const [selectedLocal, setSelectedLocal] = useState<Set<string>>(new Set())
  const [selectedRemote, setSelectedRemote] = useState<Set<string>>(new Set())
  const [mkdirSide, setMkdirSide] = useState<'local' | 'remote' | null>(null)
  const [mkdirName, setMkdirName] = useState('')

  // Connect on mount
  useEffect(() => {
    if (hostId) sftp.connect()
    return () => { sftp.disconnect() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId])

  const handleClose = async () => {
    await sftp.disconnect()
    try { await getCurrentWebviewWindow().close() } catch {}
  }

  const handleSelectLocal = useCallback((entry: { path: string }) => {
    setSelectedLocal(prev => {
      const next = new Set(prev)
      if (next.has(entry.path)) next.delete(entry.path)
      else next.add(entry.path)
      return next
    })
  }, [])

  const handleSelectRemote = useCallback((entry: { path: string }) => {
    setSelectedRemote(prev => {
      const next = new Set(prev)
      if (next.has(entry.path)) next.delete(entry.path)
      else next.add(entry.path)
      return next
    })
  }, [])

  const handleUploadSelected = useCallback(() => {
    const entries = sftp.localEntries.filter(e => selectedLocal.has(e.path) && !e.isDir)
    entries.forEach(e => sftp.upload(e.path, e.name))
    setSelectedLocal(new Set())
  }, [sftp, selectedLocal])

  const handleDownloadSelected = useCallback(() => {
    const entries = sftp.remoteEntries.filter(e => selectedRemote.has(e.path) && !e.isDir)
    entries.forEach(e => sftp.download(e.path, e.name))
    setSelectedRemote(new Set())
  }, [sftp, selectedRemote])

  const handleTransferLocal = useCallback((entry: FileEntry) => {
    if (!entry.isDir) sftp.upload(entry.path, entry.name)
  }, [sftp])

  const handleTransferRemote = useCallback((entry: FileEntry) => {
    if (!entry.isDir) sftp.download(entry.path, entry.name)
  }, [sftp])

  const handleMkdir = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mkdirSide && mkdirName.trim()) {
      try {
        await sftp.mkdir(mkdirName.trim(), mkdirSide)
      } catch (err) {
        console.error('mkdir failed:', err)
      }
    }
    setMkdirSide(null)
    setMkdirName('')
  }

  const statusConfig = {
    disconnected: { dot: 'bg-gray-400', text: 'Disconnected' },
    connecting:   { dot: 'bg-yellow-400 animate-pulse', text: 'Connecting...' },
    connected:    { dot: 'bg-green-400', text: 'Connected' },
    error:        { dot: 'bg-red-400', text: 'Error' },
  }[sftp.connectionStatus]

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Title bar */}
      <div className="h-10 flex items-center justify-between px-4 bg-muted/30 border-b border-border shrink-0" data-tauri-drag-region>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${statusConfig.dot}`} />
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-muted-foreground">{statusConfig.text}</span>
        </div>
        <div className="flex items-center gap-1">
          {sftp.connectionStatus === 'error' && (
            <button
              onClick={() => sftp.connect()}
              className="text-xs text-primary hover:text-primary/80 px-2 py-1 rounded hover:bg-primary/10 transition-colors flex items-center gap-1"
            >
              <Wifi className="w-3 h-3" /> Reconnect
            </button>
          )}
          <button
            onClick={handleClose}
            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      {/* Connection error */}
      {sftp.connectionError && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-xs text-red-400">
          {sftp.connectionError}
        </div>
      )}

      {/* Connecting state */}
      {sftp.connectionStatus === 'connecting' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Connecting to {label}...</span>
          </div>
        </div>
      )}

      {/* Disconnected state */}
      {sftp.connectionStatus === 'disconnected' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <WifiOff className="w-6 h-6 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Disconnected</span>
          </div>
        </div>
      )}

      {/* Connected: dual pane file browser */}
      {sftp.connectionStatus === 'connected' && (
        <>
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border shrink-0">
            <button
              onClick={() => { sftp.navigateRemote(sftp.remotePath); sftp.navigateLocal(sftp.localPath) }}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors flex items-center gap-1"
              title="Refresh both panes"
            >
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>

            <div className="w-px h-4 bg-border" />

            <button
              onClick={() => { setMkdirSide('remote'); setMkdirName('') }}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors flex items-center gap-1"
              title="Create remote directory"
            >
              <FolderPlus className="w-3 h-3" /> New Folder
            </button>

            <div className="flex-1" />

            {/* Upload selected */}
            {selectedLocal.size > 0 && (
              <button
                onClick={handleUploadSelected}
                className="text-xs text-primary px-2 py-1 rounded bg-primary/10 hover:bg-primary/20 transition-colors flex items-center gap-1"
              >
                <Upload className="w-3 h-3" /> Upload {selectedLocal.size} file{selectedLocal.size > 1 ? 's' : ''}
              </button>
            )}

            {/* Download selected */}
            {selectedRemote.size > 0 && (
              <button
                onClick={handleDownloadSelected}
                className="text-xs text-green-400 px-2 py-1 rounded bg-green-400/10 hover:bg-green-400/20 transition-colors flex items-center gap-1"
              >
                <Download className="w-3 h-3" /> Download {selectedRemote.size} file{selectedRemote.size > 1 ? 's' : ''}
              </button>
            )}
          </div>

          {/* Mkdir dialog */}
          {mkdirSide && (
            <div className="px-3 py-2 border-b border-border bg-muted/20">
              <form onSubmit={handleMkdir} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">New folder name ({mkdirSide}):</span>
                <input
                  autoFocus
                  value={mkdirName}
                  onChange={e => setMkdirName(e.target.value)}
                  className="flex-1 bg-background border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="folder-name"
                />
                <button type="submit" className="text-xs text-primary px-2 py-1 rounded hover:bg-primary/10">Create</button>
                <button type="button" onClick={() => setMkdirSide(null)} className="text-xs text-muted-foreground px-2 py-1 rounded hover:bg-muted">Cancel</button>
              </form>
            </div>
          )}

          {/* Dual pane */}
          <div className="flex-1 flex gap-1 p-2 min-h-0">
            <div className="flex-1 min-w-0">
              <FilePane
                title="Local"
                entries={sftp.localEntries as FileEntry[]}
                currentPath={sftp.localPath}
                loading={sftp.localLoading}
                onNavigate={sftp.navigateLocal}
                onSelect={handleSelectLocal}
                selectedPaths={selectedLocal}
                onTransfer={handleTransferLocal}
                side="local"
              />
            </div>

            {/* Center transfer arrows */}
            <div className="flex flex-col items-center justify-center gap-2 px-1 shrink-0">
              <ArrowRightLeft className="w-4 h-4 text-muted-foreground/50" />
            </div>

            <div className="flex-1 min-w-0">
              <FilePane
                title="Remote"
                entries={sftp.remoteEntries as FileEntry[]}
                currentPath={sftp.remotePath}
                loading={sftp.remoteLoading}
                onNavigate={sftp.navigateRemote}
                onSelect={handleSelectRemote}
                selectedPaths={selectedRemote}
                onTransfer={handleTransferRemote}
                side="remote"
              />
            </div>
          </div>

          {/* Transfer queue */}
          <TransferQueue transfers={sftp.transfers} onClear={sftp.clearCompletedTransfers} />
        </>
      )}
    </div>
  )
}
