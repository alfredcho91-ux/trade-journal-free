import type { JournalEntry } from '../../types';

export const ENTRY_REASON_FIELDS = [
  { indicatorKey: 'entry_reason_1_indicator', detailKey: 'entry_reason_1', step: 1 },
  { indicatorKey: 'entry_reason_2_indicator', detailKey: 'entry_reason_2', step: 2 },
  { indicatorKey: 'entry_reason_3_indicator', detailKey: 'entry_reason_3', step: 3 },
] as const;

export type EntryReasonIndicatorKey = (typeof ENTRY_REASON_FIELDS)[number]['indicatorKey'];
export type EntryReasonDetailKey = (typeof ENTRY_REASON_FIELDS)[number]['detailKey'];

export function formatEntryReason(
  entry: JournalEntry,
  indicatorKey: EntryReasonIndicatorKey,
  detailKey: EntryReasonDetailKey,
): string | null {
  const indicator = entry[indicatorKey]?.trim();
  const detail = entry[detailKey]?.trim();
  if (indicator && detail) return `${indicator}: ${detail}`;
  return indicator || detail || null;
}
