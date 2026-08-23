import type { TradeQualityItem } from '../../types';
import { netReturnPct } from '../journal/journalReturns';
import type { AnalyzedTrade } from './tradeAnalysis';

export const MAJOR_FAILURE_RETURN_PCT = -30;
export const MAJOR_FAILURE_LOSS_USDT = -200;

export type MajorFailureReasonId =
  | 'loss_rate_threshold'
  | 'loss_amount_threshold'
  | 'poor_entry'
  | 'regime_conflict'
  | 'counter_trend'
  | 'leverage_amplified'
  | 'late_recovery'
  | 'risk_basis_missing';

export interface MajorFailureCase {
  trade: AnalyzedTrade;
  quality: TradeQualityItem | null;
  netReturnPct: number | null;
  netLossUsdt: number;
  reasons: MajorFailureReasonId[];
  tenBarReturnPct: number | null;
}

export interface MajorFailureSummary {
  cases: MajorFailureCase[];
  totalLossUsdt: number;
  grossLossSharePct: number | null;
  averageNetReturnPct: number | null;
  poorEntryCount: number;
  conflictCount: number;
  leverageAmplifiedCount: number;
  lateRecoveryCount: number;
  dominantSymbol: { id: string; count: number } | null;
  dominantDirection: { id: string; count: number } | null;
  dominantRegime: { id: string; count: number } | null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mode(values: Array<string | null | undefined>): { id: string; count: number } | null {
  const counts = new Map<string, number>();
  values.forEach((value) => {
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  });
  const sorted = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  return sorted[0] ? { id: sorted[0][0], count: sorted[0][1] } : null;
}

function tenBarReturn(quality: TradeQualityItem | null): number | null {
  const exitQuality = quality?.exit_quality as {
    hold_results?: Record<string, { available?: boolean; return_pct?: number | null }>;
    actual_return_pct?: number | null;
  } | undefined;
  const result = exitQuality?.hold_results?.['10'];
  return result?.available ? finite(result.return_pct) : null;
}

function closedAt(trade: AnalyzedTrade): number {
  const timestamp = trade.entry.datetime ? new Date(trade.entry.datetime).getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function isMajorFailure(trade: AnalyzedTrade): boolean {
  const pnl = finite(trade.entry.realized_pnl);
  if (pnl == null || pnl >= 0) return false;
  const returnPct = netReturnPct(trade.entry);
  return pnl <= MAJOR_FAILURE_LOSS_USDT || (returnPct != null && returnPct <= MAJOR_FAILURE_RETURN_PCT);
}

export function majorFailureCases(
  trades: AnalyzedTrade[],
  qualityItems: TradeQualityItem[],
): MajorFailureCase[] {
  const qualityById = new Map(qualityItems.map((item) => [item.journal_id, item]));
  return trades.flatMap((trade) => {
    if (!isMajorFailure(trade)) return [];
    const pnl = finite(trade.entry.realized_pnl) as number;
    const returnPct = netReturnPct(trade.entry);
    const quality = trade.entry.id == null ? null : qualityById.get(trade.entry.id) || null;
    const reasons: MajorFailureReasonId[] = [];
    if (returnPct != null && returnPct <= MAJOR_FAILURE_RETURN_PCT) reasons.push('loss_rate_threshold');
    if (pnl <= MAJOR_FAILURE_LOSS_USDT) reasons.push('loss_amount_threshold');
    if (quality?.quality_class === 'poor_entry') reasons.push('poor_entry');
    if (quality?.market_regime.alignment === 'conflict') reasons.push('regime_conflict');
    if (quality?.trade_alignment === 'counter_trend') reasons.push('counter_trend');
    if ((trade.entry.leverage || 0) >= 5) reasons.push('leverage_amplified');
    const tenBar = tenBarReturn(quality);
    const actualPriceReturn = finite(trade.excursion?.realized_move_pct);
    if (tenBar != null && actualPriceReturn != null && tenBar - actualPriceReturn >= 0.5) reasons.push('late_recovery');
    if (finite(trade.entry.r_multiple) == null) reasons.push('risk_basis_missing');
    return [{
      trade,
      quality,
      netReturnPct: returnPct,
      netLossUsdt: pnl,
      reasons,
      tenBarReturnPct: tenBar,
    }];
  }).sort((left, right) => {
    const timeDifference = closedAt(right.trade) - closedAt(left.trade);
    if (timeDifference !== 0) return timeDifference;
    return (right.trade.entry.id || 0) - (left.trade.entry.id || 0);
  });
}

export function summarizeMajorFailures(
  trades: AnalyzedTrade[],
  qualityItems: TradeQualityItem[],
): MajorFailureSummary {
  const cases = majorFailureCases(trades, qualityItems);
  const grossLoss = Math.abs(trades.reduce((sum, trade) => {
    const pnl = finite(trade.entry.realized_pnl);
    return pnl != null && pnl < 0 ? sum + pnl : sum;
  }, 0));
  const totalLossUsdt = cases.reduce((sum, item) => sum + item.netLossUsdt, 0);
  const returns = cases.flatMap((item) => item.netReturnPct ?? []);
  return {
    cases,
    totalLossUsdt,
    grossLossSharePct: grossLoss > 0 ? Math.abs(totalLossUsdt) / grossLoss * 100 : null,
    averageNetReturnPct: returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null,
    poorEntryCount: cases.filter((item) => item.reasons.includes('poor_entry')).length,
    conflictCount: cases.filter((item) => item.reasons.includes('regime_conflict')).length,
    leverageAmplifiedCount: cases.filter((item) => item.reasons.includes('leverage_amplified')).length,
    lateRecoveryCount: cases.filter((item) => item.reasons.includes('late_recovery')).length,
    dominantSymbol: mode(cases.map((item) => item.trade.entry.symbol)),
    dominantDirection: mode(cases.map((item) => item.trade.entry.direction)),
    dominantRegime: mode(cases.map((item) => item.quality?.market_regime.id)),
  };
}
