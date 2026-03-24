import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@/hooks/useTauri';
import type { GenerativeZone } from '@/types/world';

const LOCAL_STORAGE_KEY = 'pokaimon-zones';

function loadLocalZones(): GenerativeZone[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalZones(zones: GenerativeZone[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(zones));
  } catch {
    // localStorage full or unavailable
  }
}

export function useWorldZones() {
  const [zones, setZones] = useState<GenerativeZone[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);
  const inTauri = isTauri();

  useEffect(() => {
    mountedRef.current = true;

    if (inTauri) {
      // Tauri mode: load via invoke
      async function loadZones() {
        try {
          const result = await invoke<{ zones: GenerativeZone[]; error?: string }>('world_list_zones');
          if (result?.zones && mountedRef.current) {
            setZones(result.zones as GenerativeZone[]);
          }
        } catch {
          // Rust commands not implemented yet — return empty
        } finally {
          if (mountedRef.current) setIsLoading(false);
        }
      }

      loadZones();

      // Subscribe to live updates
      const unlistenFns: (() => void)[] = [];

      listen<GenerativeZone>('world:zone_updated', (event) => {
        if (!mountedRef.current) return;
        const z = event.payload as GenerativeZone;
        setZones(prev => {
          const idx = prev.findIndex(p => p.id === z.id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = z;
            return updated;
          }
          return [...prev, z];
        });
      }).then(fn => unlistenFns.push(fn));

      listen<{ id: string }>('world:zone_deleted', (event) => {
        if (!mountedRef.current) return;
        setZones(prev => prev.filter(z => z.id !== event.payload.id));
      }).then(fn => unlistenFns.push(fn));

      return () => {
        mountedRef.current = false;
        unlistenFns.forEach(fn => fn());
      };
    } else {
      // Web mode: load from localStorage
      setZones(loadLocalZones());
      setIsLoading(false);

      return () => {
        mountedRef.current = false;
      };
    }
  }, [inTauri]);

  // Add a zone (web mode: persist to localStorage)
  const addZone = useCallback((zone: GenerativeZone) => {
    setZones(prev => {
      const idx = prev.findIndex(z => z.id === zone.id);
      let updated: GenerativeZone[];
      if (idx >= 0) {
        updated = [...prev];
        updated[idx] = zone;
      } else {
        updated = [...prev, zone];
      }
      if (!inTauri) saveLocalZones(updated);
      return updated;
    });
  }, [inTauri]);

  // Delete a zone (web mode)
  const deleteZone = useCallback((zoneId: string) => {
    if (inTauri) {
      invoke('world_delete_zone', { zoneId }).catch(() => {});
    } else {
      setZones(prev => {
        const updated = prev.filter(z => z.id !== zoneId);
        saveLocalZones(updated);
        return updated;
      });
    }
  }, [inTauri]);

  return { zones, isLoading, addZone, deleteZone };
}
