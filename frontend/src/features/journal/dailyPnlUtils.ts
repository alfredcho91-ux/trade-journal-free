import type { JournalEntry } from '../../types';

export type DailyPnl = {
  pnl: number;
  tradeCount: number;
};

export function dailyPnlByCloseDate(entries: JournalEntry[]): Record<string, DailyPnl> {
  return entries.reduce<Record<string, DailyPnl>>((result, entry) => {
    if (!entry.datetime || entry.realized_pnl == null || !Number.isFinite(entry.realized_pnl)) return result;
    const closedAt = new Date(entry.datetime);
    if (!Number.isFinite(closedAt.getTime())) return result;
    const dateKey = `${closedAt.getFullYear()}-${String(closedAt.getMonth() + 1).padStart(2, '0')}-${String(closedAt.getDate()).padStart(2, '0')}`;
    const current = result[dateKey] || { pnl: 0, tradeCount: 0 };
    current.pnl += entry.realized_pnl;
    current.tradeCount += 1;
    result[dateKey] = current;
    return result;
  }, {});
}

export function monthlyPnlByCloseMonth(entries: JournalEntry[]): Record<string, DailyPnl> {
  return Object.entries(dailyPnlByCloseDate(entries)).reduce<Record<string, DailyPnl>>((result, [dateKey, daily]) => {
    const monthKey = dateKey.slice(0, 7);
    const current = result[monthKey] || { pnl: 0, tradeCount: 0 };
    current.pnl += daily.pnl;
    current.tradeCount += daily.tradeCount;
    result[monthKey] = current;
    return result;
  }, {});
}
