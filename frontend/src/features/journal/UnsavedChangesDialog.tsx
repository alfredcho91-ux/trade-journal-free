import { useDialogFocus } from '../../hooks/useDialogFocus';

export default function UnsavedChangesDialog({ isKo, onKeepEditing, onDiscard }: {
  isKo: boolean;
  onKeepEditing: () => void;
  onDiscard: () => void;
}) {
  const dialogRef = useDialogFocus(onKeepEditing);

  return <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="unsaved-journal-title">
    <div className="w-full max-w-sm rounded-xl border border-dark-700 bg-dark-900 p-5 shadow-md">
      <h2 id="unsaved-journal-title" className="text-base font-semibold text-white">{isKo ? '저장하지 않은 변경 사항' : 'Unsaved changes'}</h2>
      <p className="mt-2 text-sm leading-5 text-dark-300">{isKo ? '이동하면 현재 입력 내용이 사라집니다.' : 'Your current edits will be lost if you continue.'}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button data-dialog-initial-focus type="button" onClick={onKeepEditing} className="btn-secondary">{isKo ? '계속 편집' : 'Keep editing'}</button>
        <button type="button" onClick={onDiscard} className="btn-danger">{isKo ? '변경 버리기' : 'Discard changes'}</button>
      </div>
    </div>
  </div>;
}
