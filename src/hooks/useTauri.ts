import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useEffect, useCallback } from 'react'

// Typed invoke wrapper
export function useTauriCommand<T>(command: string) {
  return useCallback(
    (args?: Record<string, unknown>) => invoke<T>(command, args),
    [command]
  )
}

// Event listener hook
export function useTauriEvent<T>(event: string, handler: (payload: T) => void) {
  useEffect(() => {
    let unlisten: UnlistenFn | undefined

    listen<T>(event, (e) => handler(e.payload)).then((fn) => {
      unlisten = fn
    })

    return () => {
      unlisten?.()
    }
  }, [event, handler])
}

// Check if running in Tauri
export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
