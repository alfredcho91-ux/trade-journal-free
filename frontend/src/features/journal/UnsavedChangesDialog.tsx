import { useEffect, useRef } from 'react';

export default function UnsavedChangesDialog({ isKo, onKeepEditing, onDiscard }: {
  isKo: boolean;
  onKeepEditing: () => void;
  onDiscard: () => void;
}) {
  const keepButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keepButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onKeepEditing();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeepEditing]);

  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="unsaved-journal-title">
    <div className="w-full max-w-sm border border-dark-600 bg-dark-900 p-5 shadow-2xl">
      <h2 id="unsaved-journal-title" className="text-base font-semibold text-white">{isKo ? '저장하지 않은 변경 사항' : 'Unsaved changes'}</h2>
      <p className="mt-2 text-sm leading-5 text-dark-300">{isKo ? '이동하면 현재 입력 내용이 사라집니다.' : 'Your current edits will be lost if you continue.'}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button ref={keepButtonRef} type="button" onClick={onKeepEditing} className="border border-dark-600 px-3 py-2 text-xs text-dark-200">{isKo ? '계속 편집' : 'Keep editing'}</button>
        <button type="button" onClick={onDiscard} className="border border-bear/60 bg-bear/15 px-3 py-2 text-xs text-bear">{isKo ? '변경 버리기' : 'Discard changes'}</button>
      </div>
    </div>
  </div>;
}
