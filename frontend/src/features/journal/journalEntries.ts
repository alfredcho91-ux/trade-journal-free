import type { JournalEntry } from '../../types';

export function isClosedPosition(entry: JournalEntry): boolean {
  return Boolean(entry.source?.endsWith('_position'));
}

export function isOngoingFill(entry: JournalEntry): boolean {
  return (entry.source === 'deepcoin' || Boolean(entry.source?.endsWith('_fill')))
    && entry.exit_price == null
    && entry.realized_pnl == null;
}
