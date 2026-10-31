import { useEffect } from 'react';

/** Also consumed by the native window's cancelable close check. */
export function useBeforeUnloadGuard(when: boolean) {
  useEffect(() => {
    if (!when) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [when]);
}
