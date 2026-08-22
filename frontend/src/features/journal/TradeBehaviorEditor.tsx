import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Save } from 'lucide-react';

import { updateJournalBehavior } from '../../api/journal';
import type { JournalEntry } from '../../types';

function tagsFromInput(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}
function numberOrNull(value: string): number | null {
  const number = Number(value);
  return value.trim() && Number.isFinite(number) && number > 0 ? number : null;
}

export default function TradeBehaviorEditor({
  entry,
  isKo,
  onUpdated,
}: {
  entry: JournalEntry;
  isKo: boolean;
  onUpdated?: () => void;
}) {
  const [stopPct, setStopPct] = useState(entry.planned_stop_pct?.toString() || '');
  const [targetPct, setTargetPct] = useState(entry.planned_target_pct?.toString() || '');
  const [reason, setReason] = useState(entry.planned_entry_reason || '');
  const [setups, setSetups] = useState((entry.setup_tags || []).join(', '));
  const [mistakes, setMistakes] = useState((entry.mistake_tags || []).join(', '));

  useEffect(() => {
    setStopPct(entry.planned_stop_pct?.toString() || '');
    setTargetPct(entry.planned_target_pct?.toString() || '');
    setReason(entry.planned_entry_reason || '');
    setSetups((entry.setup_tags || []).join(', '));
    setMistakes((entry.mistake_tags || []).join(', '));
  }, [entry]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (entry.id == null) throw new Error('Journal id is unavailable');
      return updateJournalBehavior(entry.id, {
        planned_stop_pct: numberOrNull(stopPct),
        planned_target_pct: numberOrNull(targetPct),
        planned_entry_reason: reason.trim() || null,
        setup_tags: tagsFromInput(setups),
        mistake_tags: tagsFromInput(mistakes),
      });
    },
    onSuccess: () => onUpdated?.(),
  });

  const plannedRr = (() => {
    const stop = numberOrNull(stopPct);
    const target = numberOrNull(targetPct);
    return stop && target ? target / stop : null;
  })();

  return (
    <section className="mb-5 border border-dark-700 bg-dark-900/35 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">{isKo ? '계획·실수 기록' : 'Plan and Mistake Notes'}</h3>
          <p className="mt-1 text-[11px] text-dark-500">
            {isKo ? '계획은 저장 시각도 함께 남습니다. 종료 뒤 입력한 계획은 분석에서 사후 기록으로 표시됩니다.' : 'The saved time is retained. Plans entered after exit are marked as post-exit notes.'}
          </p>
        </div>
        {entry.plan_recorded_at && (
          <span className="text-[10px] text-dark-500">
            {isKo ? '최근 저장' : 'Last saved'} {new Date(entry.plan_recorded_at).toLocaleString()}
          </span>
        )}
      </div>

      {entry.id == null ? (
        <div className="mt-3 text-xs text-dark-500">{isKo ? '저장된 거래만 편집할 수 있습니다.' : 'Only saved journal trades can be edited.'}</div>
      ) : (
        <>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <label className="text-xs text-dark-400">
              {isKo ? '계획 손절률 (가격 기준 %)' : 'Planned stop (% price)'}
              <input value={stopPct} min="0" step="0.1" type="number" onChange={(event) => setStopPct(event.target.value)} className="mt-1 w-full border border-dark-700 bg-dark-950 px-2.5 py-2 font-mono text-sm text-white" />
            </label>
            <label className="text-xs text-dark-400">
              {isKo ? '계획 목표수익률 (가격 기준 %)' : 'Planned target (% price)'}
              <input value={targetPct} min="0" step="0.1" type="number" onChange={(event) => setTargetPct(event.target.value)} className="mt-1 w-full border border-dark-700 bg-dark-950 px-2.5 py-2 font-mono text-sm text-white" />
            </label>
            <div className="border border-dark-800 bg-dark-950/50 px-3 py-2 text-xs">
              <div className="text-dark-500">{isKo ? '계획 손익비' : 'Planned RR'}</div>
              <div className="mt-1 font-mono text-base text-primary-200">{plannedRr == null ? '-' : `1 : ${plannedRr.toFixed(2)}`}</div>
            </div>
          </div>
          <label className="mt-3 block text-xs text-dark-400">
            {isKo ? '계획 진입 근거' : 'Planned entry rationale'}
            <input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full border border-dark-700 bg-dark-950 px-2.5 py-2 text-sm text-white" />
          </label>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs text-dark-400">
              {isKo ? 'Setup 태그' : 'Setup tags'}
              <input value={setups} onChange={(event) => setSetups(event.target.value)} placeholder={isKo ? '추세추종, VPVR 지지' : 'Trend follow, VPVR support'} className="mt-1 w-full border border-dark-700 bg-dark-950 px-2.5 py-2 text-sm text-white" />
            </label>
            <label className="text-xs text-dark-400">
              {isKo ? 'Mistake 태그' : 'Mistake tags'}
              <input value={mistakes} onChange={(event) => setMistakes(event.target.value)} placeholder={isKo ? '조기청산, 늦은 손절' : 'Early exit, late stop'} className="mt-1 w-full border border-dark-700 bg-dark-950 px-2.5 py-2 text-sm text-white" />
            </label>
          </div>
          <div className="mt-1 text-[10px] text-dark-600">{isKo ? '태그는 쉼표로 구분합니다.' : 'Separate tags with commas.'}</div>
          {saveMutation.isError && <div className="mt-2 text-xs text-bear">{isKo ? '저장하지 못했습니다. 다시 시도해 주세요.' : 'Could not save the notes. Please try again.'}</div>}
          <button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="mt-3 inline-flex items-center gap-2 border border-primary-400/50 bg-primary-500/15 px-3 py-2 text-xs font-medium text-primary-100 disabled:opacity-50">
            <Save className="h-3.5 w-3.5" />
            {saveMutation.isPending ? (isKo ? '저장 중' : 'Saving') : (isKo ? '계획·태그 저장' : 'Save plan and tags')}
          </button>
        </>
      )}
    </section>
  );
}
