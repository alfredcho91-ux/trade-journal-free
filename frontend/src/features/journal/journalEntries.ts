import type { JournalEntry } from '../../types';

export function isClosedPosition(entry: JournalEntry): boolean {
  return Boolean(entry.source?.endsWith('_position'));
}
