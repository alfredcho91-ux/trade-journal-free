import { describe, expect, it } from 'vitest';

import {
  buildJournalPeriod,
  dateBoundaryTimestamp,
  isJournalEntryWithinPeriod,
  lookbackDaysFromStart,
  millisecondsUntilNextLocalDay,
  toDateInputValue,
} from './journalPeriod';

describe('journal periods', () => {
  const today = new Date(2026, 7, 8, 12, 0, 0);

  it('builds inclusive 7, 30, and 90 day presets', () => {
    expect(buildJournalPeriod(7, today)).toEqual({ start: '2026-08-02', end: '2026-08-08' });
    expect(buildJournalPeriod(30, today)).toEqual({ start: '2026-07-10', end: '2026-08-08' });
    expect(buildJournalPeriod(90, today)).toEqual({ start: '2026-05-11', end: '2026-08-08' });
  });

  it('includes both date boundaries and excludes adjacent timestamps', () => {
    const period = { start: '2026-08-02', end: '2026-08-08' };
    const start = dateBoundaryTimestamp(period.start) as number;
    const end = dateBoundaryTimestamp(period.end, true) as number;

    expect(isJournalEntryWithinPeriod({ datetime: new Date(start).toISOString() }, period)).toBe(true);
    expect(isJournalEntryWithinPeriod({ datetime: new Date(end).toISOString() }, period)).toBe(true);
    expect(isJournalEntryWithinPeriod({ datetime: new Date(start - 1).toISOString() }, period)).toBe(false);
    expect(isJournalEntryWithinPeriod({ datetime: new Date(end + 1).toISOString() }, period)).toBe(false);
  });

  it('uses the same local calendar date for display and filtering', () => {
    const instant = new Date('2026-08-07T00:06:55Z');
    const localDate = toDateInputValue(instant);

    expect(isJournalEntryWithinPeriod({ datetime: instant.toISOString() }, { start: localDate, end: localDate })).toBe(true);
  });

  it('calculates Deepcoin lookback days inclusively from the selected start', () => {
    expect(lookbackDaysFromStart('2026-08-02', today)).toBe(7);
    expect(lookbackDaysFromStart('2026-07-10', today)).toBe(30);
    expect(lookbackDaysFromStart('2026-05-11', today)).toBe(90);
    expect(lookbackDaysFromStart('2026-05-10', today)).toBe(91);
  });

  it('schedules daily refresh just after the next local midnight', () => {
    const now = new Date(2026, 7, 8, 23, 59, 55);

    expect(millisecondsUntilNextLocalDay(now)).toBe(10_000);
  });
});
