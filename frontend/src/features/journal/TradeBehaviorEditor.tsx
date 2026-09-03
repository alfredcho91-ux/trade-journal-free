import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ChevronDown, Save } from 'lucide-react';

import { updateJournalBehavior } from '../../api/journal';
import type { JournalBehaviorUpdatePayload, JournalEntry } from '../../types';
import {
  hasTradeBehaviorChanges,
  serializeTradeBehaviorChanges,
  tradeBehaviorDraftFromEntry,
  tradeBehaviorNumberErrors,
  type BooleanDraft,
  type ScoreDraft,
  type TradeBehaviorDraft,
} from './tradeBehaviorForm';

const EMOTION_SUGGESTIONS = ['Calm', 'Confident', 'Focused', 'Anxious', 'Fearful', 'Greedy', 'Frustrated', 'Tired', 'Neutral'];

interface TradeBehaviorSaveRequest {
  entryId: number;
  payload: JournalBehaviorUpdatePayload;
  revision: number;
}

function EditorSection({ title, summary, defaultOpen = false, children }: {
  title: string;
  summary: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return <details open={defaultOpen || undefined} className="group border border-dark-700 bg-dark-950/35">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5">
      <span className="text-xs font-semibold text-white">{title}</span>
      <span className="flex items-center gap-2 text-[10px] text-dark-500">{summary}<ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" /></span>
    </summary>
    <div className="border-t border-dark-700 p-3">{children}</div>
  </details>;
}

function ScoreSelect({ value, label, isKo, onChange }: {
  value: ScoreDraft;
  label: string;
  isKo: boolean;
  onChange: (value: ScoreDraft) => void;
}) {
  return <label className="text-xs text-dark-400">{label}
    <select value={value} onChange={(event) => onChange(event.target.value as ScoreDraft)} className="mt-1 w-full border border-dark-700 bg-dark-950 px-2.5 py-2 text-sm text-white">
      <option value="">{isKo ? '미기록' : 'Not recorded'}</option>
      {[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score}</option>)}
    </select>
  </label>;
}

function BooleanSelect({ value, label, isKo, onChange }: {
  value: BooleanDraft;
  label: string;
  isKo: boolean;
  onChange: (value: BooleanDraft) => void;
}) {
  return <label className="text-xs text-dark-400">{label}
    <select value={value} onChange={(event) => onChange(event.target.value as BooleanDraft)} className="mt-1 w-full border border-dark-700 bg-dark-950 px-2.5 py-2 text-sm text-white">
      <option value="unrecorded">{isKo ? '미기록' : 'Not recorded'}</option>
      <option value="no">{isKo ? '아니오' : 'No'}</option>
      <option value="yes">{isKo ? '예' : 'Yes'}</option>
    </select>
  </label>;
}

export default function TradeBehaviorEditor({ entry, isKo, onUpdated }: {
  entry: JournalEntry;
  isKo: boolean;
  onUpdated?: () => void;
}) {
  const [initial, setInitial] = useState<TradeBehaviorDraft>(() => tradeBehaviorDraftFromEntry(entry));
  const [draft, setDraft] = useState<TradeBehaviorDraft>(() => tradeBehaviorDraftFromEntry(entry));
  const [saved, setSaved] = useState(false);
  const intentRevisionRef = useRef(0);
  const entryIdRef = useRef(entry.id);
  entryIdRef.current = entry.id;

  useEffect(() => {
    intentRevisionRef.current += 1;
    const next = tradeBehaviorDraftFromEntry(entry);
    setInitial(next);
    setDraft(next);
    setSaved(false);
  }, [entry]);

  const updateField = <K extends keyof TradeBehaviorDraft>(key: K, value: TradeBehaviorDraft[K]) => {
    intentRevisionRef.current += 1;
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const numberErrors = useMemo(() => tradeBehaviorNumberErrors(draft), [draft]);
  const hasNumberErrors = Object.keys(numberErrors).length > 0;
  const payload = useMemo<JournalBehaviorUpdatePayload>(
    () => hasNumberErrors ? {} : serializeTradeBehaviorChanges(initial, draft),
    [draft, hasNumberErrors, initial],
  );
  const isDirty = hasNumberErrors || hasTradeBehaviorChanges(initial, draft);
  const stop = Number(draft.planned_stop_pct);
  const target = Number(draft.planned_target_pct);
  const plannedRr = stop > 0 && target > 0 ? target / stop : null;
  const emotionListId = `journal-emotions-${entry.id ?? 'draft'}`;

  const saveMutation = useMutation({
    mutationFn: (request: TradeBehaviorSaveRequest) => updateJournalBehavior(request.entryId, request.payload),
    onSuccess: (updatedEntry, request) => {
      if (entryIdRef.current !== request.entryId) return;
      const next = tradeBehaviorDraftFromEntry(updatedEntry);
      setInitial(next);
      if (intentRevisionRef.current === request.revision) {
        setDraft(next);
        setSaved(true);
      } else {
        setSaved(false);
      }
      onUpdated?.();
    },
  });
  const saveCurrentDraft = () => {
    if (entry.id == null || hasNumberErrors) return;
    saveMutation.mutate({
      entryId: entry.id,
      payload,
      revision: intentRevisionRef.current,
    });
  };

  return <section className="mb-5 border border-dark-700 bg-dark-900/35 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold text-white">{isKo ? '거래 행동 기록' : 'Trade Behavior Journal'}</h3>
        <p className="mt-1 text-[11px] text-dark-500">{isKo ? '계획, 심리, 행동과 메모를 한 곳에서 기록합니다.' : 'Capture the plan, psychology, behavior, and notes in one place.'}</p>
      </div>
      {entry.plan_recorded_at && <span className="text-[10px] text-dark-500">{isKo ? '계획 기록 시각' : 'Plan recorded'} {new Date(entry.plan_recorded_at).toLocaleString()}</span>}
    </div>

    {entry.id == null ? <div className="mt-3 text-xs text-dark-500">{isKo ? '저장된 거래만 편집할 수 있습니다.' : 'Only saved journal trades can be edited.'}</div> : <>
      <div className="mt-3 space-y-2">
        <EditorSection title={isKo ? '계획' : 'PLAN'} summary={isKo ? '손절·목표·진입 근거' : 'Stop, target, rationale'} defaultOpen>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-xs text-dark-400">{isKo ? '계획 손절률 (%)' : 'Planned stop (%)'}
              <input aria-label={isKo ? '계획 손절률' : 'Planned stop percentage'} aria-invalid={numberErrors.planned_stop_pct || undefined} aria-describedby={numberErrors.planned_stop_pct ? 'planned-stop-error' : undefined} value={draft.planned_stop_pct} min="0" max="100" step="0.1" type="number" onChange={(event) => updateField('planned_stop_pct', event.target.value)} className="mt-1 w-full border border-dark-700 bg-dark-950 px-2.5 py-2 font-mono text-sm text-white" />
              {numberErrors.planned_stop_pct && <span id="planned-stop-error" className="mt-1 block text-[10px] text-bear">{isKo ? '0보다 크고 100 이하인 숫자를 입력하세요.' : 'Enter a number greater than 0 and at most 100.'}</span>}
            </label>
            <label className="text-xs text-dark-400">{isKo ? '계획 목표수익률 (%)' : 'Planned target (%)'}
              <input aria-label={isKo ? '계획 목표수익률' : 'Planned target percentage'} aria-invalid={numberErrors.planned_target_pct || undefined} aria-describedby={numberErrors.planned_target_pct ? 'planned-target-error' : undefined} value={draft.planned_target_pct} min="0" max="500" step="0.1" type="number" onChange={(event) => updateField('planned_target_pct', event.target.value)} className="mt-1 w-full border border-dark-700 bg-dark-950 px-2.5 py-2 font-mono text-sm text-white" />
              {numberErrors.planned_target_pct && <span id="planned-target-error" className="mt-1 block text-[10px] text-bear">{isKo ? '0보다 크고 500 이하인 숫자를 입력하세요.' : 'Enter a number greater than 0 and at most 500.'}</span>}
            </label>
            <div className="border border-dark-800 bg-dark-950/50 px-3 py-2 text-xs"><div className="text-dark-500">{isKo ? '계획 손익비' : 'Planned RR'}</div><div className="mt-1 font-mono text-base text-primary-200">{plannedRr == null ? '-' : `1 : ${plannedRr.toFixed(2)}`}</div></div>
          </div>
          <label className="mt-3 block text-xs text-dark-400">{isKo ? '계획 진입 근거' : 'Planned entry rationale'}
            <input value={draft.planned_entry_reason} maxLength={500} onChange={(event) => updateField('planned_entry_reason', event.target.value)} className="mt-1 w-full border border-dark-700 bg-dark-950 px-2.5 py-2 text-sm text-white" />
          </label>
          <label className="mt-3 block text-xs text-dark-400">{isKo ? 'Setup 태그' : 'Setup tags'}
            <input value={draft.setup_tags} onChange={(event) => updateField('setup_tags', event.target.value)} placeholder={isKo ? '추세추종, VPVR 지지' : 'Trend follow, VPVR support'} className="mt-1 w-full border border-dark-700 bg-dark-950 px-2.5 py-2 text-sm text-white" />
          </label>
        </EditorSection>

        <EditorSection title={isKo ? '심리' : 'PSYCHOLOGY'} summary={isKo ? '감정·자신감·집중도' : 'Emotion, confidence, focus'}>
          <datalist id={emotionListId}>{EMOTION_SUGGESTIONS.map((emotion) => <option key={emotion} value={emotion} />)}</datalist>
          <div className="grid gap-3 md:grid-cols-3">
            {(['emotion_before', 'emotion_during', 'emotion_after'] as const).map((field, index) => <label key={field} className="text-xs text-dark-400">
              {isKo ? ['진입 전 감정', '보유 중 감정', '종료 후 감정'][index] : ['Before entry', 'During trade', 'After exit'][index]}
              <input value={draft[field]} list={emotionListId} maxLength={80} onChange={(event) => updateField(field, event.target.value)} className="mt-1 w-full border border-dark-700 bg-dark-950 px-2.5 py-2 text-sm text-white" />
            </label>)}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <ScoreSelect value={draft.confidence_score} label={isKo ? '자신감 점수' : 'Confidence score'} isKo={isKo} onChange={(value) => updateField('confidence_score', value)} />
            <ScoreSelect value={draft.focus_score} label={isKo ? '집중도 점수' : 'Focus score'} isKo={isKo} onChange={(value) => updateField('focus_score', value)} />
          </div>
          {entry.emotion && <p className="mt-3 text-[10px] text-dark-500">{isKo ? '기존 감정 기록' : 'Legacy emotion'}: {entry.emotion}</p>}
        </EditorSection>

        <EditorSection title={isKo ? '행동' : 'BEHAVIOR'} summary={isKo ? 'FOMO·복수매매·실수' : 'FOMO, revenge, mistakes'}>
          <div className="grid gap-3 md:grid-cols-2">
            <BooleanSelect value={draft.fomo} label="FOMO" isKo={isKo} onChange={(value) => updateField('fomo', value)} />
            <BooleanSelect value={draft.revenge_trade} label={isKo ? '복수 매매' : 'Revenge trade'} isKo={isKo} onChange={(value) => updateField('revenge_trade', value)} />
          </div>
          <label className="mt-3 block text-xs text-dark-400">{isKo ? 'Mistake 태그' : 'Mistake tags'}
            <input value={draft.mistake_tags} onChange={(event) => updateField('mistake_tags', event.target.value)} placeholder={isKo ? '조기청산, 늦은 손절' : 'Early exit, late stop'} className="mt-1 w-full border border-dark-700 bg-dark-950 px-2.5 py-2 text-sm text-white" />
          </label>
          {entry.mistakes && <p className="mt-3 text-[10px] text-dark-500">{isKo ? '기존 실수 기록' : 'Legacy mistakes'}: {entry.mistakes}</p>}
        </EditorSection>

        <EditorSection title={isKo ? '메모' : 'NOTES'} summary={isKo ? '자유 기록' : 'Free-form notes'}>
          <label className="block text-xs text-dark-400">{isKo ? '거래 메모' : 'Trade notes'}
            <textarea value={draft.notes} rows={5} onChange={(event) => updateField('notes', event.target.value)} className="mt-1 w-full resize-y border border-dark-700 bg-dark-950 px-2.5 py-2 text-sm text-white" />
          </label>
        </EditorSection>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3" aria-live="polite">
        <button type="button" onClick={saveCurrentDraft} disabled={saveMutation.isPending || !isDirty || hasNumberErrors} className="inline-flex items-center gap-2 border border-primary-400/50 bg-primary-500/15 px-3 py-2 text-xs font-medium text-primary-100 disabled:opacity-50">
          <Save className="h-3.5 w-3.5" />
          {saveMutation.isPending ? (isKo ? '저장 중' : 'Saving') : (isKo ? '행동 기록 저장' : 'Save behavior journal')}
        </button>
        {saved && <span className="text-xs text-bull">{isKo ? '저장됨' : 'Saved'}</span>}
        {saveMutation.isError && <span className="text-xs text-bear">{isKo ? '저장하지 못했습니다. 다시 시도해 주세요.' : 'Could not save. Please try again.'}</span>}
        {!isDirty && !saved && <span className="text-[10px] text-dark-500">{isKo ? '변경 사항 없음' : 'No changes'}</span>}
      </div>
    </>}
  </section>;
}
