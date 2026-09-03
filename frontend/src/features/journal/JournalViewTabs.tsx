import { useCallback, useState } from 'react';

import UnsavedChangesDialog from './UnsavedChangesDialog';

export type JournalView = 'trades' | 'daily';

export default function JournalViewTabs({ view, dailyDirty, isKo, onChange, onDiscardDaily }: {
  view: JournalView;
  dailyDirty: boolean;
  isKo: boolean;
  onChange: (view: JournalView) => void;
  onDiscardDaily: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const keepEditing = useCallback(() => setConfirming(false), []);
  const requestView = (next: JournalView) => {
    if (next === view) return;
    if (view === 'daily' && next === 'trades' && dailyDirty) {
      setConfirming(true);
      return;
    }
    onChange(next);
  };

  return <>
    <div className="inline-flex border border-dark-700 bg-dark-900/50 p-1" role="tablist" aria-label={isKo ? '매매 일지 보기' : 'Journal view'}>
      <button type="button" role="tab" aria-selected={view === 'trades'} onClick={() => requestView('trades')} className={`px-4 py-2 text-xs font-medium ${view === 'trades' ? 'bg-primary-500/20 text-primary-100' : 'text-dark-400'}`}>{isKo ? '거래' : 'Trades'}</button>
      <button type="button" role="tab" aria-selected={view === 'daily'} onClick={() => requestView('daily')} className={`px-4 py-2 text-xs font-medium ${view === 'daily' ? 'bg-primary-500/20 text-primary-100' : 'text-dark-400'}`}>{isKo ? '데일리 저널' : 'Daily Journal'}</button>
    </div>
    {confirming && <UnsavedChangesDialog isKo={isKo} onKeepEditing={keepEditing} onDiscard={() => {
      setConfirming(false);
      onDiscardDaily();
      onChange('trades');
    }} />}
  </>;
}
