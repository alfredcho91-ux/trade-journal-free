import type { JournalBehaviorUpdatePayload, JournalEntry } from '../../types';

export type ScoreDraft = '' | '1' | '2' | '3' | '4' | '5';
export type BooleanDraft = 'unrecorded' | 'no' | 'yes';

export interface TradeBehaviorDraft {
  planned_stop_pct: string;
  planned_target_pct: string;
  planned_entry_reason: string;
  setup_tags: string;
  mistake_tags: string;
  emotion_before: string;
  emotion_during: string;
  emotion_after: string;
  confidence_score: ScoreDraft;
  focus_score: ScoreDraft;
  fomo: BooleanDraft;
  revenge_trade: BooleanDraft;
  notes: string;
}

function scoreDraft(value: number | null | undefined): ScoreDraft {
  return value != null && value >= 1 && value <= 5 ? String(value) as ScoreDraft : '';
}

function booleanDraft(value: boolean | null | undefined): BooleanDraft {
  return value == null ? 'unrecorded' : value ? 'yes' : 'no';
}

export function tradeBehaviorDraftFromEntry(entry: JournalEntry): TradeBehaviorDraft {
  return {
    planned_stop_pct: entry.planned_stop_pct?.toString() || '',
    planned_target_pct: entry.planned_target_pct?.toString() || '',
    planned_entry_reason: entry.planned_entry_reason || '',
    setup_tags: (entry.setup_tags || []).join(', '),
    mistake_tags: (entry.mistake_tags || []).join(', '),
    emotion_before: entry.emotion_before || '',
    emotion_during: entry.emotion_during || '',
    emotion_after: entry.emotion_after || '',
    confidence_score: scoreDraft(entry.confidence_score),
    focus_score: scoreDraft(entry.focus_score),
    fomo: booleanDraft(entry.fomo),
    revenge_trade: booleanDraft(entry.revenge_trade),
    notes: entry.notes || '',
  };
}

function nullableText(value: string): string | null {
  return value.trim() || null;
}

function nullablePlanNumber(value: string, maximum: number): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`Plan value must be greater than zero and at most ${maximum}`);
  }
  return parsed;
}

export function tradeBehaviorNumberErrors(draft: TradeBehaviorDraft): {
  planned_stop_pct?: true;
  planned_target_pct?: true;
} {
  const errors: { planned_stop_pct?: true; planned_target_pct?: true } = {};
  try {
    nullablePlanNumber(draft.planned_stop_pct, 100);
  } catch {
    errors.planned_stop_pct = true;
  }
  try {
    nullablePlanNumber(draft.planned_target_pct, 500);
  } catch {
    errors.planned_target_pct = true;
  }
  return errors;
}

export function tagsFromInput(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

function nullableScore(value: ScoreDraft): number | null {
  return value ? Number(value) : null;
}

function nullableBoolean(value: BooleanDraft): boolean | null {
  return value === 'unrecorded' ? null : value === 'yes';
}

export function serializeTradeBehaviorChanges(
  initial: TradeBehaviorDraft,
  current: TradeBehaviorDraft,
): JournalBehaviorUpdatePayload {
  const payload: JournalBehaviorUpdatePayload = {};
  const setWhenChanged = <K extends keyof JournalBehaviorUpdatePayload>(
    key: K,
    before: JournalBehaviorUpdatePayload[K],
    after: JournalBehaviorUpdatePayload[K],
  ) => {
    if (JSON.stringify(before) !== JSON.stringify(after)) payload[key] = after;
  };

  setWhenChanged('planned_stop_pct', nullablePlanNumber(initial.planned_stop_pct, 100), nullablePlanNumber(current.planned_stop_pct, 100));
  setWhenChanged('planned_target_pct', nullablePlanNumber(initial.planned_target_pct, 500), nullablePlanNumber(current.planned_target_pct, 500));
  setWhenChanged('planned_entry_reason', nullableText(initial.planned_entry_reason), nullableText(current.planned_entry_reason));
  setWhenChanged('setup_tags', tagsFromInput(initial.setup_tags), tagsFromInput(current.setup_tags));
  setWhenChanged('mistake_tags', tagsFromInput(initial.mistake_tags), tagsFromInput(current.mistake_tags));
  setWhenChanged('emotion_before', nullableText(initial.emotion_before), nullableText(current.emotion_before));
  setWhenChanged('emotion_during', nullableText(initial.emotion_during), nullableText(current.emotion_during));
  setWhenChanged('emotion_after', nullableText(initial.emotion_after), nullableText(current.emotion_after));
  setWhenChanged('confidence_score', nullableScore(initial.confidence_score), nullableScore(current.confidence_score));
  setWhenChanged('focus_score', nullableScore(initial.focus_score), nullableScore(current.focus_score));
  setWhenChanged('fomo', nullableBoolean(initial.fomo), nullableBoolean(current.fomo));
  setWhenChanged('revenge_trade', nullableBoolean(initial.revenge_trade), nullableBoolean(current.revenge_trade));
  setWhenChanged('notes', nullableText(initial.notes), nullableText(current.notes));
  return payload;
}

export function hasTradeBehaviorChanges(initial: TradeBehaviorDraft, current: TradeBehaviorDraft): boolean {
  return Object.keys(serializeTradeBehaviorChanges(initial, current)).length > 0;
}
