import { useParams } from 'react-router'
import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import type { AgentStatus } from '@/types/agent'
import { TERMINAL_THEME, TERMINAL_CONFIG } from '@/components/AgentWorld/constants'
import { attachShiftEnterHandler } from '@/lib/terminal'
import '../globals.css'

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-green-400',
  waiting: 'bg-yellow-400',
  idle: 'bg-gray-400',
  completed: 'bg-blue-400',
  error: 'bg-red-400',
}

export default function Console() {
  const { agentId } = useParams()
  const terminalRef = useRef<HTMLDivElement>(null)
  const [agentName, setAgentName] = useState('')
  const [agentStatus, setAgentStatus] = useState<string>('idle')

  const handleRedock = async () => {
    try {
      const currentWindow = getCurrentWebviewWindow()
      await invoke('window_dock', { windowId: currentWindow.label })
    } catch (err) {
      console.error('Failed to re-dock window:', err)
    }
  }

  // Initialize xterm.js terminal
  useEffect(() => {
    if (!agentId || !terminalRef.current) return

    let cancelled = false
    let resizeObserver: ResizeObserver | null = null
    let unlistenOutput: (() => void) | undefined
    let unlistenError: (() => void) | undefined
    let unlistenStatus: (() => void) | undefined
    let termInstance: import('xterm').Terminal | null = null

    const init = async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('xterm'),
        import('xterm-addon-fit'),
      ])

      // Also load the CSS
      await import('xterm/css/xterm.css')

      if (cancelled || !terminalRef.current) return

      const term = new Terminal({
        theme: TERMINAL_THEME,
        fontSize: TERMINAL_CONFIG.fontSize,
        fontFamily: TERMINAL_CONFIG.fontFamily,
        cursorBlink: TERMINAL_CONFIG.cursorBlink,
        cursorStyle: TERMINAL_CONFIG.cursorStyle,
        scrollback: TERMINAL_CONFIG.scrollback,
        convertEol: TERMINAL_CONFIG.convertEol,
        allowProposedApi: true,
      })

      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      term.open(terminalRef.current)
      termInstance = term

      if (cancelled) {
        term.dispose()
        return
      }

      // Initial fit after a short delay so the container has real dimensions
      setTimeout(() => {
        if (cancelled) return
        fitAddon.fit()
        term.focus()
      }, 50)

      // Handle resize via ResizeObserver
      resizeObserver = new ResizeObserver(() => {
        if (cancelled) return
        try {
          fitAddon.fit()
          // Sync PTY dimensions
          invoke('pty_resize', {
            ptyId: agentId,
            cols: term.cols,
            rows: term.rows,
          }).catch(() => {})
        } catch {}
      })
      resizeObserver.observe(terminalRef.current)

      // Forward keyboard input to agent PTY
      // Filter out terminal query responses that xterm.js emits automatically.
      term.onData((data) => {
        if (/^(\x1b\[\?[\d;]*c|\d+;\d+c)+$/.test(data)) return
        const cleaned = data
          .replace(/\x1b\[\?[\d;]*c/g, '')     // DA response
          .replace(/\x1b\[\d+;\d+R/g, '')       // CPR response
          .replace(/\x1b\[(?:I|O)/g, '')         // Focus in/out
          .replace(/\d+;\d+c/g, '')              // Bare DA fragments
        if (!cleaned) return
        invoke('agent_send_input', { id: agentId, input: cleaned }).catch((err) => {
          console.error('Error sending input to agent:', err)
        })
      })

      // Shift+Enter handler
      attachShiftEnterHandler(term, (data) => {
        invoke('agent_send_input', { id: agentId, input: data }).catch(() => {})
      })

      // Subscribe to agent:output events
      listen<{ agent_id: string; pty_id: string; data: number[] }>('agent:output', (event) => {
        if (event.payload.agent_id === agentId && termInstance) {
          termInstance.write(new Uint8Array(event.payload.data))
        }
      }).then((fn) => { unlistenOutput = fn })

      // Subscribe to agent:error events
      listen<{ agentId: string; data: string }>('agent:error', (event) => {
        if (event.payload.agentId === agentId && termInstance) {
          termInstance.write(`\x1b[31m${event.payload.data}\x1b[0m`)
        }
      }).then((fn) => { unlistenError = fn })

      // Subscribe to agent status changes to update the title bar
      listen<{ agent_id: string; status: string }>('agent:status', (event) => {
        if (event.payload.agent_id === agentId) {
          setAgentStatus(event.payload.status)
        }
      }).then((fn) => { unlistenStatus = fn })

      // Replay buffered output from backend
      try {
        const agent = await invoke<AgentStatus | null>('agent_get', { id: agentId })
        if (cancelled) return

        if (agent) {
          if (agent.name) setAgentName(agent.name)
          setAgentStatus(agent.status)

          if (agent.output && agent.output.length > 0) {
            agent.output.forEach((line) => {
              term.write(line)
            })
            term.scrollToBottom()
          }
        }
      } catch (err) {
        console.error('Failed to fetch agent data:', err)
        if (!cancelled) {
          term.writeln(`\x1b[31mFailed to fetch agent data: ${err}\x1b[0m`)
        }
      }

      // Refit after content has been written
      setTimeout(() => {
        if (!cancelled) fitAddon.fit()
      }, 100)
    }

    init()

    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      unlistenOutput?.()
      unlistenError?.()
      unlistenStatus?.()
      if (termInstance) {
        termInstance.dispose()
        termInstance = null
      }
    }
  }, [agentId])

  const statusColor = STATUS_COLORS[agentStatus] || STATUS_COLORS.idle

  return (
    <div className="h-screen flex flex-col bg-[#1a1a2e]">
      {/* Title bar */}
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
      {/* Terminal */}
      <div ref={terminalRef} className="flex-1 min-h-0" />
    </div>
  )
}
