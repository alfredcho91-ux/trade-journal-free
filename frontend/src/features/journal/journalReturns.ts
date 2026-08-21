import type { JournalEntry } from '../../types';

export function positionNotional(entry: JournalEntry): number | null {
  const entryPrice = entry.entry_price;
  const size = entry.size;
  if (entryPrice == null || !Number.isFinite(entryPrice) || entryPrice <= 0) {
    return null;
  }

  // Deepcoin SWAP size is a contract count, whose coin multiplier differs by symbol.
  // Recover the position notional from reported gross PnL and the underlying price move.
  if (entry.source === 'deepcoin_position') {
    const exitPrice = entry.exit_price;
    const netPnl = entry.realized_pnl;
    if (
      exitPrice != null &&
      netPnl != null &&
      Number.isFinite(exitPrice) &&
      Number.isFinite(netPnl)
    ) {
      const direction = entry.direction === 'Short' ? -1 : 1;
      const priceReturn = ((exitPrice - entryPrice) / entryPrice) * direction;
      const grossPnl = netPnl + Math.abs(entry.fee || 0) - (entry.funding_fee || 0);
      if (Math.abs(priceReturn) > Number.EPSILON && Math.abs(grossPnl) > Number.EPSILON) {
        const inferredNotional = Math.abs(grossPnl / priceReturn);
        if (Number.isFinite(inferredNotional) && inferredNotional > 0) return inferredNotional;
      }
    }
    return null;
  }

  if (size == null || !Number.isFinite(size)) return null;
  const notional = Math.abs(entryPrice * size);
  return notional > 0 ? notional : null;
}

export function netReturnPct(entry: JournalEntry): number | null {
  const invested = investedAmount(entry);
  const netPnl = entry.realized_pnl;
  if (invested == null || netPnl == null || !Number.isFinite(netPnl)) return null;
  return (netPnl / invested) * 100;
}

export function investedAmount(entry: JournalEntry): number | null {
  const stored = entry.invested_amount;
  if (stored != null && Number.isFinite(stored) && stored > 0) return stored;

  const notional = positionNotional(entry);
  if (notional == null) return null;

  const leverage = entry.leverage;
  if (leverage != null && Number.isFinite(leverage) && leverage > 0) {
    return notional / leverage;
  }

  // Non-derivative entries are unleveraged unless an exchange says otherwise.
  return entry.source === 'deepcoin_position' ? null : notional;
}

export function aggregateNetReturnPct(entries: JournalEntry[]): number | null {
  let totalInvested = 0;
  let totalNetPnl = 0;
  for (const entry of entries) {
    const invested = investedAmount(entry);
    const netPnl = entry.realized_pnl;
    if (invested == null || netPnl == null || !Number.isFinite(netPnl)) continue;
    totalInvested += invested;
    totalNetPnl += netPnl;
  }
  return totalInvested > 0 ? (totalNetPnl / totalInvested) * 100 : null;
}

export function aggregateNetPnl(entries: JournalEntry[]): number {
  return entries.reduce(
    (sum, entry) =>
      entry.realized_pnl != null && Number.isFinite(entry.realized_pnl)
        ? sum + entry.realized_pnl
        : sum,
    0,
  );
}

export function feeImpact(entries: JournalEntry[]): number {
  return entries.reduce((sum, entry) => {
    const fee = entry.fee;
    return fee != null && Number.isFinite(fee) ? sum - Math.abs(fee) : sum;
  }, 0);
}

export function fundingImpact(entries: JournalEntry[]): number {
  return entries.reduce((sum, entry) => {
    const fundingFee = entry.funding_fee;
    return fundingFee != null && Number.isFinite(fundingFee) ? sum + fundingFee : sum;
  }, 0);
}

export function netCostImpact(entries: JournalEntry[]): number {
  return feeImpact(entries) + fundingImpact(entries);
}
