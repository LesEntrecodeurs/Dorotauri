import { useState, useCallback, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './useTauri'
import type { MosaicNode } from 'react-mosaic-component'

interface SavedLayouts {
  current: MosaicNode<string> | null
  saved: Record<string, MosaicNode<string>>
}

export function useLayout() {
  const [layout, setLayout] = useState<MosaicNode<string> | null>(null)
  const [savedLayouts, setSavedLayouts] = useState<Record<string, MosaicNode<string>>>({})
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>()

  // Load layout from disk on mount
  useEffect(() => {
    if (!isTauri()) return
    loadLayouts()
  }, [])

  const loadLayouts = async () => {
    try {
      const data = await invoke<string>('layout_get')
      const parsed: SavedLayouts = JSON.parse(data)
      if (parsed.current) setLayout(parsed.current)
      if (parsed.saved) setSavedLayouts(parsed.saved)
    } catch { /* ignore — file may not exist yet */ }
  }

  // Save layout to disk (debounced 1s)
  const persistLayout = useCallback((newLayout: MosaicNode<string> | null) => {
    setLayout(newLayout)
    if (!isTauri()) return

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const layouts: SavedLayouts = {
          current: newLayout,
          saved: savedLayouts,
        }
        await invoke('layout_save', { data: JSON.stringify(layouts) })
      } catch { /* ignore */ }
    }, 1000)
  }, [savedLayouts])

  // Save current layout with a name
  const saveLayout = useCallback((name: string) => {
    if (!layout) return
    const updated = { ...savedLayouts, [name]: layout }
    setSavedLayouts(updated)
    persistToSettings(layout, updated)
  }, [layout, savedLayouts])

  // Load a named layout
  const loadLayout = useCallback((name: string) => {
    const saved = savedLayouts[name]
    if (saved) {
      setLayout(saved)
      persistToSettings(saved, savedLayouts)
    }
  }, [savedLayouts])

  // Delete a named layout
  const deleteLayout = useCallback((name: string) => {
    const updated = { ...savedLayouts }
    delete updated[name]
    setSavedLayouts(updated)
    persistToSettings(layout, updated)
  }, [layout, savedLayouts])

  // Remove a tile (for pop-out)
  const removeTile = useCallback((agentId: string) => {
    if (!layout) return
    const newLayout = removeFromMosaic(layout, agentId)
    persistLayout(newLayout)
  }, [layout, persistLayout])

  // Add a tile (for re-dock)
  const addTile = useCallback((agentId: string) => {
    if (!layout) {
      persistLayout(agentId)
      return
    }
    const newLayout: MosaicNode<string> = {
      direction: 'row',
      first: layout,
      second: agentId,
      splitPercentage: 70,
    }
    persistLayout(newLayout)
  }, [layout, persistLayout])

  return {
    layout,
    setLayout: persistLayout,
    savedLayouts,
    saveLayout,
    loadLayout,
    deleteLayout,
    addTile,
    removeTile,
  }
}

// Helper: remove a leaf from the mosaic tree
function removeFromMosaic(node: MosaicNode<string>, id: string): MosaicNode<string> | null {
  if (typeof node === 'string') {
    return node === id ? null : node
  }
  const first = removeFromMosaic(node.first, id)
  const second = removeFromMosaic(node.second, id)
  if (!first && !second) return null
  if (!first) return second
  if (!second) return first
  return { ...node, first, second }
}

async function persistToSettings(layout: MosaicNode<string> | null, saved: Record<string, MosaicNode<string>>) {
  if (!isTauri()) return
  try {
    await invoke('layout_save', {
      data: JSON.stringify({ current: layout, saved })
    })
  } catch { /* ignore */ }
}
