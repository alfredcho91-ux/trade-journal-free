import { useEffect } from 'react';
import { useIsMutating } from '@tanstack/react-query';
import { useLanguage } from '../../store/useStore';

export default function DesktopLifecycle() {
  const pending = useIsMutating();
  const isKo = useLanguage() === 'ko';

  useEffect(() => {
    const check = (event: Event) => {
      if (pending > 0) {
        event.preventDefault();
        window.alert(isKo ? '작업이 진행 중입니다. 완료 후 종료하세요.' : 'An operation is in progress. Wait for it to finish before closing.');
        return;
      }
      const leave = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(leave);
      if (leave.defaultPrevented && !window.confirm(isKo
        ? '저장하지 않은 변경사항이 있습니다. 변경사항을 버리고 종료할까요?'
        : 'You have unsaved changes. Discard them and close?')) event.preventDefault();
    };
    window.addEventListener('app-desktop-close-check', check);
    return () => window.removeEventListener('app-desktop-close-check', check);
  }, [pending, isKo]);
  return null;
}
