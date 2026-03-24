import { useNotifications } from '@/hooks/useNotifications'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ArrowRight } from 'lucide-react'

export default function NotificationToast() {
  const { undismissed, dismiss, navigateToAgent } = useNotifications()
  const latest = undismissed[0] // show most recent

  if (!latest) return null

  const typeColors = {
    complete: 'bg-green-500',
    error: 'bg-red-500',
    waiting: 'bg-orange-500',
  }

  return (
    <AnimatePresence>
      <motion.div
        key={latest.agentId + latest.timestamp}
        initial={{ opacity: 0, y: 50, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20 }}
        className="fixed bottom-4 right-4 z-50 max-w-sm bg-card border border-border rounded-lg shadow-lg overflow-hidden"
      >
        <div className="flex items-start gap-3 p-3">
          <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${typeColors[latest.type] || 'bg-gray-500'}`} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{latest.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{latest.body}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => navigateToAgent(latest.agentId)}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              title="Go to agent"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => dismiss(latest.agentId)}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
