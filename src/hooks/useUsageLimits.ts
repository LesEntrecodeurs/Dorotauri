import { useCallback } from 'react';
import { useTauriEvent, isTauri } from './useTauri';
import { useStore } from '@/store';

interface RateLimitWindow {
  used_percentage: number | null;
  resets_at: number | null;
}

interface RateLimitsEvent {
  five_hour: RateLimitWindow | null;
  seven_day: RateLimitWindow | null;
  ts: number | null;
}

/**
 * Listens to `usage:rate-limits` Tauri events emitted by the Rust watcher
 * and pushes the data into the Zustand store.
 */
export function useUsageLimits() {
  const setRateLimits = useStore((s) => s.setRateLimits);

  const handler = useCallback(
    (payload: RateLimitsEvent) => {
      const fiveHour =
        payload.five_hour?.used_percentage != null
          ? {
              usedPercentage: payload.five_hour.used_percentage,
              resetsAt: payload.five_hour.resets_at ?? 0,
            }
          : undefined;

      const sevenDay =
        payload.seven_day?.used_percentage != null
          ? {
              usedPercentage: payload.seven_day.used_percentage,
              resetsAt: payload.seven_day.resets_at ?? 0,
            }
          : undefined;

      if (fiveHour || sevenDay) {
        setRateLimits({ fiveHour, sevenDay });
      }
    },
    [setRateLimits],
  );

  if (isTauri()) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useTauriEvent<RateLimitsEvent>('usage:rate-limits', handler);
  }
}
