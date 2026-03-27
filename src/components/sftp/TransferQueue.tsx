import { ArrowUpCircle, ArrowDownCircle, CheckCircle2, XCircle, Trash2 } from 'lucide-react'
import type { Transfer } from '@/types/sftp'

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

interface TransferQueueProps {
  transfers: Transfer[]
  onClear: () => void
}

export function TransferQueue({ transfers, onClear }: TransferQueueProps) {
  if (transfers.length === 0) return null

  const active = transfers.filter(t => t.status === 'transferring' || t.status === 'pending')
  const done = transfers.filter(t => t.status === 'completed' || t.status === 'error')

  return (
    <div className="border-t border-border bg-card shrink-0">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
        <span className="text-xs font-medium text-muted-foreground">
          Transfers {active.length > 0 && `(${active.length} active)`}
        </span>
        {done.length > 0 && (
          <button
            onClick={onClear}
            className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" /> Clear
          </button>
        )}
      </div>
      <div className="max-h-32 overflow-y-auto">
        {transfers.map(t => (
          <div key={t.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
            {t.direction === 'upload'
              ? <ArrowUpCircle className="w-3.5 h-3.5 shrink-0 text-blue-400" />
              : <ArrowDownCircle className="w-3.5 h-3.5 shrink-0 text-green-400" />}
            <span className="truncate flex-1 min-w-0">{t.fileName}</span>
            {t.status === 'transferring' && (
              <div className="w-24 shrink-0">
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${t.percent}%` }} />
                </div>
              </div>
            )}
            {t.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-green-400" />}
            {t.status === 'error' && (
              <span className="flex items-center gap-1 text-red-400" title={t.error}>
                <XCircle className="w-3.5 h-3.5 shrink-0" />
              </span>
            )}
            {t.totalBytes > 0 && (
              <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                {formatSize(t.bytesTransferred)}/{formatSize(t.totalBytes)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
