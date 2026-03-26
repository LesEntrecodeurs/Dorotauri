import { useParams, useSearchParams } from 'react-router'
import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { getTerminalTheme, TERMINAL_CONFIG } from '@/components/AgentTerminalDialog/constants'
import '../globals.css'

export default function SshTerminal() {
  const { ptyId } = useParams()
  const [searchParams] = useSearchParams()
  const label = searchParams.get('label') || 'SSH'
  const password = searchParams.get('pw') || ''
  const terminalRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error' | 'disconnected'>('connecting')

  const handleClose = async () => {
    try {
      if (ptyId) await invoke('pty_kill', { ptyId })
      const win = getCurrentWebviewWindow()
      await win.close()
    } catch {}
  }

  useEffect(() => {
    if (!ptyId || !terminalRef.current) return

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

      // Subscribe to PTY output
      let unlistenOutput: (() => void) | undefined
      let disposed = false
      let outputBuf = ''
      let passwordSent = false
      let statusLocked = false

      const ERROR_PATTERNS = ['permission denied', 'connection refused', 'connection timed out',
        'no route to host', 'host key verification failed', 'could not resolve hostname',
        'network is unreachable', 'connection reset by peer']

      listen<{ agent_id: string; pty_id: string; data: number[] }>('agent:output', (event) => {
        if (disposed || event.payload.pty_id !== ptyId) return
        const bytes = new Uint8Array(event.payload.data)
        term.write(bytes)

        // Status detection + password auto-fill
        const text = new TextDecoder().decode(bytes)
        const lower = text.toLowerCase()

        if (password && !passwordSent) {
          if (lower.includes('password:') || lower.includes('password for')) {
            passwordSent = true
            setTimeout(() => invoke('pty_write', { ptyId, data: password + '\n' }).catch(() => {}), 50)
          }
        }

        if (!statusLocked) {
          outputBuf += lower
          if (ERROR_PATTERNS.some(p => outputBuf.includes(p))) {
            setStatus('error'); statusLocked = true
          } else if (outputBuf.includes('last login') || outputBuf.includes('welcome to') || outputBuf.includes('linux ')) {
            setStatus('connected'); statusLocked = true
          }
        }
      }).then(fn => { unlistenOutput = fn })

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
        invoke('pty_kill', { ptyId }).catch(() => {})
        term.dispose()
      }
    }

    init()
    return () => { cancelled = true; cleanup?.() }
  }, [ptyId, password])

  const statusCfg = {
    connecting:   { dot: 'bg-yellow-400 animate-pulse', text: 'Connecting...' },
    connected:    { dot: 'bg-green-400', text: 'Connected' },
    error:        { dot: 'bg-red-400', text: 'Error' },
    disconnected: { dot: 'bg-gray-400', text: 'Disconnected' },
  }[status]

  return (
    <div className="h-screen flex flex-col bg-[#1A1726]">
      <div className="h-10 flex items-center justify-between px-4 bg-[#16162a] border-b border-gray-800 shrink-0" data-tauri-drag-region>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${statusCfg.dot}`} />
          <span className="text-sm text-gray-300">{label}</span>
          <span className="text-xs text-gray-500">{statusCfg.text}</span>
        </div>
        <button
          onClick={handleClose}
          className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-white/10 transition-colors"
        >
          Close
        </button>
      </div>
      <div ref={terminalRef} className="flex-1 min-h-0" />
    </div>
  )
}
