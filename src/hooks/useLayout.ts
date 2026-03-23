import { useState, useCallback } from 'react'
import type { MosaicNode } from 'react-mosaic-component'

export function useLayout() {
  const [layout, setLayout] = useState<MosaicNode<string> | null>(null)

  const addTile = useCallback((agentId: string) => {
    // TODO: Phase 3 — add agent tile to mosaic
  }, [])

  const removeTile = useCallback((agentId: string) => {
    // TODO: Phase 3 — remove agent tile from mosaic
  }, [])

  return { layout, setLayout, addTile, removeTile }
}
