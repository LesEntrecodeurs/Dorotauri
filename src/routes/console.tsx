import { useParams } from 'react-router'
import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import type { Agent } from '@/types/agent'
import { getTerminalTheme, TERMINAL_CONFIG } from '@/components/AgentTerminalDialog/constants'
import '../globals.css'

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-green-400',
  waiting: 'bg-yellow-400',
  inactive: 'bg-gray-400',
  completed: 'bg-blue-400',
  error: 'bg-red-400',
  dormant: 'bg-zinc-500',
}

export default function Console() {
  const { agentId } = useParams()
  const terminalRef = useRef<HTMLDivElement>(null)
  const [agentName, setAgentName] = useState('')
  const [agentStatus, setAgentStatus] = useState<string>('inactive')

  const handleRedock = async () => {
    try {
      const currentWindow = getCurrentWebviewWindow()
      await invoke('window_dock', { windowId: currentWindow.label })
    } catch (err) {
      console.error('Failed to re-dock window:', err)
    }
  }

  useEffect(() => {
    if (!agentId || !terminalRef.current) return

    let cancelled = false
    let cleanup: (() => void) | undefined

    const init = async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('xterm'),
        import('xterm-addon-fit'),
      ])
      await import('xterm/css/xterm.css')

      if (cancelled || !terminalRef.current) return

      const term = new Terminal({
        theme: getTerminalTheme('dark'),
        fontSize: TERMINAL_CONFIG.fontSize || 13,
        fontFamily: TERMINAL_CONFIG.fontFamily,
        cursorBlink: true,
        cursorStyle: 'block',
        scrollback: 10000,
        convertEol: true,
        allowProposedApi: true,
      })

      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      term.open(terminalRef.current)

      setTimeout(() => {
        if (!cancelled) { fitAddon.fit(); term.focus(); }
      }, 50)

      // Get agent info to find ptyId
      let agent: Agent | null = null
      try {
        agent = await invoke<Agent | null>('agent_get', { id: agentId })
        if (agent) {
          if (agent.name) setAgentName(agent.name)
          setAgentStatus(agent.processState)
        }
      } catch {}

      // Look up existing PTY for this agent (shared with hub)
      const cwd = agent?.cwd || '/home'
      let ptyId: string
      let isShared = false
      try {
        const existing = await invoke<string | null>('pty_lookup', { key: agentId })
        if (existing) {
          ptyId = existing
          isShared = true
        } else {
          const { cols, rows } = term
          ptyId = await invoke<string>('pty_create', { cwd, cols, rows })
          await invoke('pty_register', { key: agentId, ptyId })
        }
      } catch (err) {
        term.write(`\x1b[31mFailed to create PTY: ${err}\x1b[0m\r\n`)
        cleanup = () => term.dispose()
        return
      }

      // Subscribe to output from this PTY
      let unlistenOutput: (() => void) | undefined
      let unlistenStatus: (() => void) | undefined
      let disposed = false

      listen<{ agent_id: string; pty_id: string; data: number[] }>('agent:output', (event) => {
        if ((event.payload.agent_id === ptyId || event.payload.pty_id === ptyId) && !disposed) {
          term.write(new Uint8Array(event.payload.data))
        }
      }).then(fn => { unlistenOutput = fn })

      listen<{ id: string; status: string }>('agent:status', (event) => {
        if (event.payload.id === agentId) {
          setAgentStatus(event.payload.status)
        }
      }).then(fn => { unlistenStatus = fn })

      // Forward input to PTY
      term.onData((data) => {
        if (/^(\x1b\[\?[\d;]*c|\d+;\d+c)+$/.test(data)) return
        invoke('pty_write', { ptyId, data }).catch(() => {})
      })

      // Resize
      const resizeObserver = new ResizeObserver(() => {
        if (disposed) return
        try {
          fitAddon.fit()
          invoke('pty_resize', { ptyId, cols: term.cols, rows: term.rows }).catch(() => {})
        } catch {}
      })
      resizeObserver.observe(terminalRef.current!)

      cleanup = () => {
        disposed = true
        resizeObserver.disconnect()
        unlistenOutput?.()
        unlistenStatus?.()
        if (!isShared) {
          invoke('pty_kill', { ptyId }).catch(() => {})
        }
        term.dispose()
      }
    }

    init()
    return () => { cancelled = true; cleanup?.() }
  }, [agentId])

  const statusColor = STATUS_COLORS[agentStatus] || STATUS_COLORS.inactive

  return (
    <div className="h-screen flex flex-col bg-[#1A1726]">
      <div className="h-10 flex items-center justify-between px-4 bg-[#16162a] border-b border-gray-800 shrink-0" data-tauri-drag-region>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${statusColor}`} />
          <span className="text-sm text-gray-300">
            {agentName || `Agent ${agentId?.slice(0, 8) ?? ''}`}
          </span>
          <span className="text-xs text-gray-500 capitalize">{agentStatus}</span>
        </div>
        <button
          onClick={handleRedock}
          className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-white/10 transition-colors"
        >
          Re-dock
        </button>
      </div>
      <div ref={terminalRef} className="flex-1 min-h-0" />
    </div>
  )
}
