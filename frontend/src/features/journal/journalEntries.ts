import type { JournalEntry } from '../../types';

export function isClosedPosition(entry: JournalEntry): boolean {
  return entry.source === 'deepcoin_position';
}
