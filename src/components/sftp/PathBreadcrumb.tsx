import { useState } from 'react'
import { ChevronRight } from 'lucide-react'

interface PathBreadcrumbProps {
  path: string
  onNavigate: (path: string) => void
  separator?: string
}

export function PathBreadcrumb({ path, onNavigate, separator = '/' }: PathBreadcrumbProps) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(path)

  const segments = path.split(separator).filter(Boolean)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setEditing(false)
    if (editValue.trim()) {
      onNavigate(editValue.trim())
    }
  }

  if (editing) {
    return (
      <form onSubmit={handleSubmit} className="flex-1 min-w-0">
        <input
          autoFocus
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={() => { setEditing(false); setEditValue(path) }}
          className="w-full bg-background border border-border rounded px-2 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </form>
    )
  }

  return (
    <div
      className="flex items-center gap-0.5 min-w-0 flex-1 text-xs cursor-pointer overflow-hidden"
      onDoubleClick={() => { setEditing(true); setEditValue(path) }}
      title="Double-click to edit path"
    >
      <button
        onClick={() => onNavigate('/')}
        className="shrink-0 px-1 py-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
      >
        /
      </button>
      {segments.map((segment, i) => {
        const fullPath = separator + segments.slice(0, i + 1).join(separator)
        return (
          <span key={fullPath} className="flex items-center gap-0.5 min-w-0">
            <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground/50" />
            <button
              onClick={() => onNavigate(fullPath)}
              className="truncate px-1 py-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors max-w-[120px]"
              title={segment}
            >
              {segment}
            </button>
          </span>
        )
      })}
    </div>
  )
}
