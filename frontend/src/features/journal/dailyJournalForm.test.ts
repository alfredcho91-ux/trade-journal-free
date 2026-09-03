import { describe, expect, it } from 'vitest';

import {
  dailyJournalDraftFromEntry,
  isValidLocalDate,
  localToday,
  serializeDailyJournalChanges,
  shiftLocalDate,
} from './dailyJournalForm';

describe('daily journal form', () => {
  it('omits untouched fields and sends only edited values', () => {
    const initial = dailyJournalDraftFromEntry(null);
    expect(serializeDailyJournalChanges(initial, { ...initial })).toEqual({});
    expect(serializeDailyJournalChanges(initial, { ...initial, market_bias: 'Bullish' })).toEqual({ market_bias: 'Bullish' });
  });

  it('uses explicit null when a recorded field is cleared', () => {
    const initial = dailyJournalDraftFromEntry({
      id: 1,
      trade_date: '2026-09-03',
      market_bias: 'Neutral',
      session_plan: null,
      max_daily_loss: 100,
      max_trade_count: 2,
      pre_session_notes: null,
      post_session_notes: null,
      what_went_well: null,
      what_went_wrong: null,
      next_focus: null,
      created_at: 'created',
      updated_at: 'updated',
    });
    expect(serializeDailyJournalChanges(initial, { ...initial, market_bias: '', max_daily_loss: '' })).toEqual({
      market_bias: null,
      max_daily_loss: null,
    });
  });

  it('moves dates using local calendar components, including leap-day boundaries', () => {
    expect(shiftLocalDate('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftLocalDate('2024-02-29', 1)).toBe('2024-03-01');
    expect(shiftLocalDate('2026-01-01', -1)).toBe('2025-12-31');
    expect(localToday(new Date(2026, 8, 3, 0, 5))).toBe('2026-09-03');
  });

  it('rejects empty, malformed, and impossible local dates before date arithmetic', () => {
    expect(isValidLocalDate('2026-09-03')).toBe(true);
    expect(isValidLocalDate('')).toBe(false);
    expect(isValidLocalDate('2026-9-3')).toBe(false);
    expect(isValidLocalDate('2026-02-30')).toBe(false);
    expect(shiftLocalDate('', 1)).toBeNull();
    expect(shiftLocalDate('2026-02-30', -1)).toBeNull();
  });
});
