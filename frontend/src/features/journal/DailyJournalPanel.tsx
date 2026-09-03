import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, Save } from 'lucide-react';

import { getDailyJournal, saveDailyJournal } from '../../api/journal';
import type { DailyJournalEntry, DailyJournalUpdatePayload } from '../../types';
import {
  dailyJournalDraftFromEntry,
  hasDailyJournalChanges,
  isValidLocalDate,
  localToday,
  serializeDailyJournalChanges,
  shiftLocalDate,
  type DailyJournalDraft,
} from './dailyJournalForm';
import { journalQueryKeys } from './journalQueryKeys';
import UnsavedChangesDialog from './UnsavedChangesDialog';

interface DailySaveRequest {
  tradeDate: string;
  payload: DailyJournalUpdatePayload;
  revision: number;
}

function TextAreaField({ label, value, maxLength = 5000, rows = 4, onChange }: {
  label: string;
  value: string;
  maxLength?: number;
  rows?: number;
  onChange: (value: string) => void;
}) {
  return <label className="block text-xs text-dark-400">{label}
    <textarea value={value} maxLength={maxLength} rows={rows} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full resize-y border border-dark-700 bg-dark-950 px-3 py-2 text-sm leading-5 text-white" />
  </label>;
}

export default function DailyJournalPanel({ isKo, onDirtyChange, resetRevision = 0 }: {
  isKo: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  resetRevision?: number;
}) {
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(() => localToday());
  const [initial, setInitial] = useState<DailyJournalDraft>(() => dailyJournalDraftFromEntry(null));
  const [draft, setDraft] = useState<DailyJournalDraft>(() => dailyJournalDraftFromEntry(null));
  const [hydratedDate, setHydratedDate] = useState<string | null>(null);
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const initialRef = useRef(initial);
  const selectedDateRef = useRef(selectedDate);
  const intentRevisionRef = useRef(0);
  const appliedQueryRef = useRef<{
    tradeDate: string;
    dataUpdatedAt: number;
    data: DailyJournalEntry | null | undefined;
  } | null>(null);

  const dateQuery = useQuery({
    queryKey: journalQueryKeys.dailyDate(selectedDate),
    queryFn: ({ signal }) => getDailyJournal(selectedDate, signal),
    enabled: isValidLocalDate(selectedDate),
    retry: false,
  });

  const payload = useMemo(() => serializeDailyJournalChanges(initial, draft), [draft, initial]);
  const isDirty = hasDailyJournalChanges(initial, draft);

  useEffect(() => {
    if (!dateQuery.isSuccess || dateQuery.isFetching) return;
    const isNewDate = hydratedDate !== selectedDate;
    const hasNewRemoteVersion = appliedQueryRef.current?.tradeDate !== selectedDate
      || appliedQueryRef.current.dataUpdatedAt !== dateQuery.dataUpdatedAt
      || appliedQueryRef.current.data !== dateQuery.data;
    if (!isNewDate && (!hasNewRemoteVersion || isDirty)) return;
    const next = dailyJournalDraftFromEntry(dateQuery.data);
    appliedQueryRef.current = {
      tradeDate: selectedDate,
      dataUpdatedAt: dateQuery.dataUpdatedAt,
      data: dateQuery.data,
    };
    setInitial(next);
    setDraft(next);
    setHydratedDate(selectedDate);
    setSaved(false);
  }, [dateQuery.data, dateQuery.dataUpdatedAt, dateQuery.isFetching, dateQuery.isSuccess, hydratedDate, isDirty, selectedDate]);

  useEffect(() => onDirtyChange?.(isDirty), [isDirty, onDirtyChange]);
  useEffect(() => {
    initialRef.current = initial;
  }, [initial]);
  useEffect(() => {
    if (resetRevision === 0) return;
    intentRevisionRef.current += 1;
    setDraft(initialRef.current);
    setSaved(false);
  }, [resetRevision]);

  const updateField = <K extends keyof DailyJournalDraft>(key: K, value: DailyJournalDraft[K]) => {
    intentRevisionRef.current += 1;
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const saveMutation = useMutation({
    onMutate: async (request: DailySaveRequest) => {
      await queryClient.cancelQueries({
        queryKey: journalQueryKeys.dailyDate(request.tradeDate),
        exact: true,
      });
    },
    mutationFn: (request: DailySaveRequest) => saveDailyJournal(request.tradeDate, request.payload),
    onSuccess: async (record: DailyJournalEntry, request) => {
      const queryKey = journalQueryKeys.dailyDate(request.tradeDate);
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData<DailyJournalEntry | null>(queryKey, record);
      const canonicalRecord = queryClient.getQueryData<DailyJournalEntry | null>(queryKey) ?? record;
      const canonicalState = queryClient.getQueryState<DailyJournalEntry | null>(queryKey);
      void queryClient.invalidateQueries({ queryKey: journalQueryKeys.daily, refetchType: 'none' });
      if (selectedDateRef.current !== request.tradeDate) return;
      appliedQueryRef.current = {
        tradeDate: request.tradeDate,
        dataUpdatedAt: canonicalState?.dataUpdatedAt ?? Date.now(),
        data: canonicalRecord,
      };
      const next = dailyJournalDraftFromEntry(canonicalRecord);
      setInitial(next);
      if (intentRevisionRef.current === request.revision) {
        setDraft(next);
        setSaved(true);
      } else {
        setSaved(false);
      }
    },
  });

  const applyDate = (nextDate: string) => {
    if (!isValidLocalDate(nextDate)) return;
    selectedDateRef.current = nextDate;
    intentRevisionRef.current += 1;
    setSelectedDate(nextDate);
    setSaved(false);
  };
  const requestDate = (nextDate: string) => {
    if (!isValidLocalDate(nextDate)) return;
    if (nextDate === selectedDate) return;
    if (isDirty) setPendingDate(nextDate);
    else applyDate(nextDate);
  };
  const requestShiftedDate = (days: number) => {
    const nextDate = shiftLocalDate(selectedDate, days);
    if (nextDate != null) requestDate(nextDate);
  };
  const saveCurrentDraft = () => {
    if (!isValidLocalDate(selectedDate)) return;
    saveMutation.mutate({
      tradeDate: selectedDate,
      payload,
      revision: intentRevisionRef.current,
    });
  };
  const keepEditing = useCallback(() => setPendingDate(null), []);
  const discardAndMove = useCallback(() => {
    if (pendingDate == null) return;
    setDraft(initial);
    applyDate(pendingDate);
    setPendingDate(null);
  }, [initial, pendingDate]);

  return <section className="space-y-4" aria-label={isKo ? '데일리 저널' : 'Daily Journal'}>
    <div className="flex flex-wrap items-center justify-between gap-3 border border-dark-700 bg-dark-900/35 p-3">
      <div>
        <h2 className="text-base font-semibold text-white">{isKo ? '하루 계획과 복기' : 'Daily plan and review'}</h2>
        <p className="mt-1 text-[11px] text-dark-500">{isKo ? '한 날짜의 사전 계획과 사후 복기를 같은 기록에 저장합니다.' : 'Keep pre-session planning and post-session review in one date-keyed record.'}</p>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" aria-label={isKo ? '이전 날짜' : 'Previous date'} onClick={() => requestShiftedDate(-1)} className="border border-dark-700 p-2 text-dark-300"><ChevronLeft className="h-4 w-4" /></button>
        <label className="sr-only" htmlFor="daily-journal-date">{isKo ? '저널 날짜' : 'Journal date'}</label>
        <input id="daily-journal-date" type="date" value={selectedDate} onChange={(event) => requestDate(event.target.value)} className="border border-dark-700 bg-dark-950 px-2 py-1.5 font-mono text-sm text-white" />
        <button type="button" aria-label={isKo ? '다음 날짜' : 'Next date'} onClick={() => requestShiftedDate(1)} className="border border-dark-700 p-2 text-dark-300"><ChevronRight className="h-4 w-4" /></button>
        <button type="button" onClick={() => requestDate(localToday())} className="ml-1 inline-flex items-center gap-1 border border-dark-700 px-2.5 py-2 text-xs text-dark-300"><CalendarDays className="h-3.5 w-3.5" />{isKo ? '오늘' : 'Today'}</button>
      </div>
    </div>

    {dateQuery.isLoading || (hydratedDate !== selectedDate && !dateQuery.isError) ? <div className="border border-dark-700 py-12 text-center text-sm text-dark-400">{isKo ? '데일리 저널을 불러오는 중...' : 'Loading daily journal...'}</div> : dateQuery.isError ? <div className="flex items-center justify-center gap-3 border border-bear/30 py-10 text-sm text-bear"><span>{isKo ? '데일리 저널을 불러오지 못했습니다.' : 'Could not load the daily journal.'}</span><button type="button" onClick={() => void dateQuery.refetch()} className="inline-flex items-center gap-1 border border-bear/40 px-2 py-1 text-xs"><RefreshCw className="h-3 w-3" />{isKo ? '재시도' : 'Retry'}</button></div> : <>
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="space-y-4 border border-dark-700 bg-dark-900/30 p-4">
          <div><h3 className="text-sm font-semibold text-primary-200">{isKo ? '세션 전' : 'PRE-SESSION'}</h3><p className="mt-1 text-[10px] text-dark-500">{isKo ? '시장 관점, 손실 한도와 실행 계획' : 'Bias, risk limits, and execution plan'}</p></div>
          <label className="block text-xs text-dark-400">{isKo ? '시장 관점' : 'Market bias'}
            <input value={draft.market_bias} maxLength={160} onChange={(event) => updateField('market_bias', event.target.value)} className="mt-1 w-full border border-dark-700 bg-dark-950 px-3 py-2 text-sm text-white" />
          </label>
          <TextAreaField label={isKo ? '세션 계획' : 'Session plan'} value={draft.session_plan} onChange={(value) => updateField('session_plan', value)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-dark-400">{isKo ? '일일 최대 손실' : 'Max daily loss'}
              <input aria-label={isKo ? '일일 최대 손실' : 'Max daily loss'} type="number" min="0.01" step="0.01" value={draft.max_daily_loss} onChange={(event) => updateField('max_daily_loss', event.target.value)} className="mt-1 w-full border border-dark-700 bg-dark-950 px-3 py-2 font-mono text-sm text-white" />
            </label>
            <label className="text-xs text-dark-400">{isKo ? '최대 거래 횟수' : 'Max trade count'}
              <input aria-label={isKo ? '최대 거래 횟수' : 'Max trade count'} type="number" min="1" step="1" value={draft.max_trade_count} onChange={(event) => updateField('max_trade_count', event.target.value)} className="mt-1 w-full border border-dark-700 bg-dark-950 px-3 py-2 font-mono text-sm text-white" />
            </label>
          </div>
          <TextAreaField label={isKo ? '세션 전 메모' : 'Pre-session notes'} value={draft.pre_session_notes} onChange={(value) => updateField('pre_session_notes', value)} />
        </section>

        <section className="space-y-4 border border-dark-700 bg-dark-900/30 p-4">
          <div><h3 className="text-sm font-semibold text-amber-200">{isKo ? '세션 후' : 'POST-SESSION'}</h3><p className="mt-1 text-[10px] text-dark-500">{isKo ? '결과, 잘한 점과 다음 개선점' : 'Outcome, lessons, and next focus'}</p></div>
          <TextAreaField label={isKo ? '세션 후 메모' : 'Post-session notes'} value={draft.post_session_notes} onChange={(value) => updateField('post_session_notes', value)} />
          <TextAreaField label={isKo ? '잘한 점' : 'What went well'} value={draft.what_went_well} onChange={(value) => updateField('what_went_well', value)} />
          <TextAreaField label={isKo ? '아쉬운 점' : 'What went wrong'} value={draft.what_went_wrong} onChange={(value) => updateField('what_went_wrong', value)} />
          <TextAreaField label={isKo ? '다음 집중 과제' : 'Next focus'} value={draft.next_focus} maxLength={2000} rows={3} onChange={(value) => updateField('next_focus', value)} />
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-3 border border-dark-700 bg-dark-900/30 p-3" aria-live="polite">
        <button type="button" onClick={saveCurrentDraft} disabled={!isDirty || saveMutation.isPending} className="inline-flex items-center gap-2 border border-primary-400/50 bg-primary-500/15 px-3 py-2 text-xs font-medium text-primary-100 disabled:opacity-50"><Save className="h-3.5 w-3.5" />{saveMutation.isPending ? (isKo ? '저장 중' : 'Saving') : (isKo ? '데일리 저널 저장' : 'Save daily journal')}</button>
        {saved && <span className="text-xs text-bull">{isKo ? '저장됨' : 'Saved'}</span>}
        {saveMutation.isError && <span className="text-xs text-bear">{isKo ? '저장하지 못했습니다. 입력 내용을 유지했습니다.' : 'Could not save. Your edits are still here.'}</span>}
        {!isDirty && !saved && <span className="text-[10px] text-dark-500">{isKo ? '변경 사항 없음' : 'No changes'}</span>}
      </div>
    </>}

    {pendingDate && <UnsavedChangesDialog isKo={isKo} onKeepEditing={keepEditing} onDiscard={discardAndMove} />}
  </section>;
}
