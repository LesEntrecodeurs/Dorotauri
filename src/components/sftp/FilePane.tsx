import { useState, useMemo } from 'react'
import { Folder, File, ArrowUp, Loader2 } from 'lucide-react'
import { PathBreadcrumb } from './PathBreadcrumb'

export interface FileEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  modified: string | null
}

type SortKey = 'name' | 'size' | 'modified'
type SortDir = 'asc' | 'desc'

interface FilePaneProps {
  title: string
  entries: FileEntry[]
  currentPath: string
  loading?: boolean
  onNavigate: (path: string) => void
  onSelect?: (entry: FileEntry) => void
  selectedPaths?: Set<string>
  onTransfer?: (entry: FileEntry) => void
  side: 'local' | 'remote'
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch {
    return '—'
  }
}

function parentPath(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/')
  parts.pop()
  return parts.length <= 1 ? '/' : parts.join('/')
}

export function FilePane({
  title, entries, currentPath, loading, onNavigate,
  onSelect, selectedPaths, onTransfer, side,
}: FilePaneProps) {
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [showHidden, setShowHidden] = useState(false)

  const filteredEntries = useMemo(() => {
    let result = showHidden ? entries : entries.filter(e => !e.name.startsWith('.'))
    result = [...result].sort((a, b) => {
      // Directories always first
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      let cmp = 0
      if (sortKey === 'name') cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      else if (sortKey === 'size') cmp = a.size - b.size
      else if (sortKey === 'modified') cmp = (a.modified || '').localeCompare(b.modified || '')
      return sortDir === 'asc' ? cmp : -cmp
    })
    return result
  }, [entries, sortKey, sortDir, showHidden])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const handleDoubleClick = (entry: FileEntry) => {
    if (entry.isDir) {
      onNavigate(entry.path)
    } else if (onTransfer) {
      onTransfer(entry)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Backspace') {
      onNavigate(parentPath(currentPath))
    }
  }

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return null
    return <span className="ml-0.5 text-[10px]">{sortDir === 'asc' ? '▲' : '▼'}</span>
  }

  return (
    <div className="flex flex-col h-full border border-border rounded-lg overflow-hidden bg-card" onKeyDown={handleKeyDown} tabIndex={0}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30 shrink-0">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</span>
        <PathBreadcrumb path={currentPath} onNavigate={onNavigate} />
        <button
          onClick={() => setShowHidden(v => !v)}
          className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${showHidden ? 'bg-primary/10 border-primary/30 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
          title="Toggle hidden files"
        >
          .*
        </button>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_80px_140px] gap-1 px-3 py-1 border-b border-border text-[10px] text-muted-foreground uppercase tracking-wider shrink-0">
        <button onClick={() => handleSort('name')} className="text-left hover:text-foreground flex items-center">Name{sortIcon('name')}</button>
        <button onClick={() => handleSort('size')} className="text-right hover:text-foreground flex items-center justify-end">Size{sortIcon('size')}</button>
        <button onClick={() => handleSort('modified')} className="text-right hover:text-foreground flex items-center justify-end">Modified{sortIcon('modified')}</button>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Go up */}
            {currentPath !== '/' && (
              <button
                onClick={() => onNavigate(parentPath(currentPath))}
                className="w-full grid grid-cols-[1fr_80px_140px] gap-1 px-3 py-1.5 hover:bg-muted/50 transition-colors text-left"
              >
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ArrowUp className="w-3.5 h-3.5" />
                  ..
                </span>
                <span />
                <span />
              </button>
            )}
            {filteredEntries.map(entry => {
              const isSelected = selectedPaths?.has(entry.path)
              return (
                <button
                  key={entry.path}
                  onClick={() => onSelect?.(entry)}
                  onDoubleClick={() => handleDoubleClick(entry)}
                  className={`w-full grid grid-cols-[1fr_80px_140px] gap-1 px-3 py-1.5 transition-colors text-left ${
                    isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50'
                  }`}
                >
                  <span className="flex items-center gap-2 text-xs truncate min-w-0">
                    {entry.isDir
                      ? <Folder className="w-3.5 h-3.5 shrink-0 text-blue-400" />
                      : <File className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
                    <span className="truncate">{entry.name}</span>
                  </span>
                  <span className="text-[11px] text-muted-foreground text-right tabular-nums">
                    {entry.isDir ? '—' : formatSize(entry.size)}
                  </span>
                  <span className="text-[11px] text-muted-foreground text-right truncate">
                    {formatDate(entry.modified)}
                  </span>
                </button>
              )
            })}
            {filteredEntries.length === 0 && !loading && (
              <div className="text-xs text-muted-foreground text-center py-8">Empty directory</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
