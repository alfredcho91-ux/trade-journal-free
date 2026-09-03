import type { DailyJournalEntry, DailyJournalUpdatePayload } from '../../types';

export interface DailyJournalDraft {
  market_bias: string;
  session_plan: string;
  max_daily_loss: string;
  max_trade_count: string;
  pre_session_notes: string;
  post_session_notes: string;
  what_went_well: string;
  what_went_wrong: string;
  next_focus: string;
}

export function emptyDailyJournalDraft(): DailyJournalDraft {
  return {
    market_bias: '',
    session_plan: '',
    max_daily_loss: '',
    max_trade_count: '',
    pre_session_notes: '',
    post_session_notes: '',
    what_went_well: '',
    what_went_wrong: '',
    next_focus: '',
  };
}

export function dailyJournalDraftFromEntry(entry: DailyJournalEntry | null | undefined): DailyJournalDraft {
  if (!entry) return emptyDailyJournalDraft();
  return {
    market_bias: entry.market_bias || '',
    session_plan: entry.session_plan || '',
    max_daily_loss: entry.max_daily_loss?.toString() || '',
    max_trade_count: entry.max_trade_count?.toString() || '',
    pre_session_notes: entry.pre_session_notes || '',
    post_session_notes: entry.post_session_notes || '',
    what_went_well: entry.what_went_well || '',
    what_went_wrong: entry.what_went_wrong || '',
    next_focus: entry.next_focus || '',
  };
}

function nullableText(value: string): string | null {
  return value.trim() || null;
}

function nullableNumber(value: string): number | null {
  return value.trim() ? Number(value) : null;
}

export function serializeDailyJournalChanges(
  initial: DailyJournalDraft,
  current: DailyJournalDraft,
): DailyJournalUpdatePayload {
  const payload: DailyJournalUpdatePayload = {};
  const textFields = [
    'market_bias',
    'session_plan',
    'pre_session_notes',
    'post_session_notes',
    'what_went_well',
    'what_went_wrong',
    'next_focus',
  ] as const;
  for (const field of textFields) {
    const before = nullableText(initial[field]);
    const after = nullableText(current[field]);
    if (before !== after) payload[field] = after;
  }
  const beforeLoss = nullableNumber(initial.max_daily_loss);
  const afterLoss = nullableNumber(current.max_daily_loss);
  if (beforeLoss !== afterLoss) payload.max_daily_loss = afterLoss;
  const beforeCount = nullableNumber(initial.max_trade_count);
  const afterCount = nullableNumber(current.max_trade_count);
  if (beforeCount !== afterCount) payload.max_trade_count = afterCount;
  return payload;
}

export function hasDailyJournalChanges(initial: DailyJournalDraft, current: DailyJournalDraft): boolean {
  return Object.keys(serializeDailyJournalChanges(initial, current)).length > 0;
}

export function formatLocalDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function localToday(now = new Date()): string {
  return formatLocalDate(now);
}

export function isValidLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const candidate = new Date(year, month - 1, day, 12, 0, 0, 0);
  return candidate.getFullYear() === year
    && candidate.getMonth() === month - 1
    && candidate.getDate() === day;
}

export function shiftLocalDate(value: string, days: number): string | null {
  if (!isValidLocalDate(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const localNoon = new Date(year, month - 1, day, 12, 0, 0, 0);
  localNoon.setDate(localNoon.getDate() + days);
  return formatLocalDate(localNoon);
}
