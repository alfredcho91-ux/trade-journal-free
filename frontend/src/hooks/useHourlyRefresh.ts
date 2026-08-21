import { useCallback, useEffect, useRef } from 'react';

export function hourStartTimestamp(now = new Date()): number {
  const hourStart = new Date(now);
  hourStart.setMinutes(0, 0, 0);
  return hourStart.getTime();
}

export function millisecondsUntilNextHour(now = new Date()): number {
  const nextHour = new Date(now);
  nextHour.setMinutes(0, 0, 0);
  nextHour.setHours(now.getHours() + 1);
  return nextHour.getTime() - now.getTime();
}

export function useHourlyRefresh(onRefresh: () => void, enabled = true): () => void {
  const refreshRef = useRef(onRefresh);
  const lastRefreshHourRef = useRef(hourStartTimestamp());

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  const refreshNow = useCallback(() => {
    lastRefreshHourRef.current = hourStartTimestamp();
    refreshRef.current();
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;

    let timeoutId: number;

    const scheduleNextRefresh = () => {
      timeoutId = window.setTimeout(() => {
        refreshNow();
        scheduleNextRefresh();
      }, millisecondsUntilNextHour());
    };

    const refreshWhenVisible = () => {
      if (
        document.visibilityState === 'visible'
        && hourStartTimestamp() > lastRefreshHourRef.current
      ) {
        window.clearTimeout(timeoutId);
        refreshNow();
        scheduleNextRefresh();
      }
    };

    scheduleNextRefresh();
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [enabled, refreshNow]);

  return refreshNow;
}
