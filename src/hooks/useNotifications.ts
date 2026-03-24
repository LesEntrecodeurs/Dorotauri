import { useState, useCallback, useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './useTauri'

interface AgentNotification {
  agentId: string
  title: string
  body: string
  type: 'complete' | 'error' | 'waiting'
  timestamp: number
  dismissed: boolean
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<AgentNotification[]>([])

  // Listen for in-app notifications from Rust
  useEffect(() => {
    if (!isTauri()) return
    let unlisten: (() => void) | undefined

    listen<{ agent_id: string; title: string; body: string; notification_type: string }>(
      'notification:in-app',
      (event) => {
        const n: AgentNotification = {
          agentId: event.payload.agent_id,
          title: event.payload.title,
          body: event.payload.body,
          type: event.payload.notification_type as AgentNotification['type'],
          timestamp: Date.now(),
          dismissed: false,
        }
        setNotifications((prev) => [n, ...prev].slice(0, 50)) // keep last 50
      }
    ).then((fn) => { unlisten = fn })

    return () => { unlisten?.() }
  }, [])

  const dismiss = useCallback((agentId: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.agentId === agentId ? { ...n, dismissed: true } : n))
    )
  }, [])

  const dismissAll = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, dismissed: true })))
  }, [])

  const navigateToAgent = useCallback(async (agentId: string) => {
    if (isTauri()) {
      await invoke('notification_navigate', { agentId })
    }
    dismiss(agentId)
  }, [dismiss])

  const undismissed = notifications.filter((n) => !n.dismissed)

  return { notifications, undismissed, dismiss, dismissAll, navigateToAgent }
}
