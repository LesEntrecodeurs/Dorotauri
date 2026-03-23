import { useState } from 'react'

interface AgentNotification {
  agentId: string
  type: 'complete' | 'error' | 'waiting'
  timestamp: number
  dismissed: boolean
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<AgentNotification[]>([])

  const dismiss = (agentId: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.agentId === agentId ? { ...n, dismissed: true } : n))
    )
  }

  return { notifications, dismiss }
}
