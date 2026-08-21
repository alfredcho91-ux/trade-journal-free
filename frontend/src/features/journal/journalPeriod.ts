import type { JournalEntry } from '../../types';

export type JournalPeriod = { start: string; end: string };

export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dateBoundaryTimestamp(value: string, endOfDay = false): number | null {
  if (!value) return null;
  const suffix = endOfDay ? 'T23:59:59.999' : 'T00:00:00.000';
  const timestamp = new Date(`${value}${suffix}`).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function buildJournalPeriod(days = 30, now = new Date()): JournalPeriod {
  const end = new Date(now);
  const start = new Date(now);
  start.setDate(start.getDate() - (days - 1));
  return { start: toDateInputValue(start), end: toDateInputValue(end) };
}

export function millisecondsUntilNextLocalDay(now = new Date()): number {
  const nextDay = new Date(now);
  nextDay.setHours(24, 0, 5, 0);
  return Math.max(1_000, nextDay.getTime() - now.getTime());
}

export function isJournalEntryWithinPeriod(entry: JournalEntry, period: JournalPeriod): boolean {
  if (!entry.datetime) return false;
  const timestamp = new Date(entry.datetime).getTime();
  const start = dateBoundaryTimestamp(period.start);
  const end = dateBoundaryTimestamp(period.end, true);
  if (!Number.isFinite(timestamp) || start == null || end == null) return false;
  return timestamp >= start && timestamp <= end;
}

export function lookbackDaysFromStart(startValue: string, today = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startValue)) return null;
  const startUtc = Date.UTC(
    Number(startValue.slice(0, 4)),
    Number(startValue.slice(5, 7)) - 1,
    Number(startValue.slice(8, 10)),
  );
  const todayValue = toDateInputValue(today);
  const todayUtc = Date.UTC(
    Number(todayValue.slice(0, 4)),
    Number(todayValue.slice(5, 7)) - 1,
    Number(todayValue.slice(8, 10)),
  );
  const days = Math.floor((todayUtc - startUtc) / 86_400_000) + 1;
  return Number.isFinite(days) ? days : null;
}
