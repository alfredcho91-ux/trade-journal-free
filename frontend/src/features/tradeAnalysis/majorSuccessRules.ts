import type { TradeQualityItem } from '../../types';
import { netReturnPct } from '../journal/journalReturns';
import type { AnalyzedTrade } from './tradeAnalysis';

export const MAJOR_SUCCESS_RETURN_PCT = 30;
export const MAJOR_SUCCESS_PRICE_PCT = 3;

export type MajorSuccessReasonId =
  | 'return_threshold'
  | 'price_threshold'
  | 'good_entry'
  | 'trend_aligned'
  | 'with_trend'
  | 'good_exit'
  | 'early_exit';

export interface MajorSuccessCase {
  trade: AnalyzedTrade;
  quality: TradeQualityItem | null;
  netReturnPct: number | null;
  priceReturnPct: number | null;
  netProfitUsdt: number;
  captureRatioPct: number | null;
  reasons: MajorSuccessReasonId[];
}

export interface MajorSuccessSummary {
  cases: MajorSuccessCase[];
  totalProfitUsdt: number;
  grossProfitSharePct: number | null;
  averageNetReturnPct: number | null;
  averagePriceReturnPct: number | null;
  averageCaptureRatioPct: number | null;
  goodEntryCount: number;
  alignedTrendCount: number;
  withTrendCount: number;
  earlyExitCount: number;
  dominantSymbol: { id: string; count: number } | null;
  dominantDirection: { id: string; count: number } | null;
  dominantRegime: { id: string; count: number } | null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function mode(values: Array<string | null | undefined>): { id: string; count: number } | null {
  const counts = new Map<string, number>();
  values.forEach((value) => {
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  });
  const sorted = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  return sorted[0] ? { id: sorted[0][0], count: sorted[0][1] } : null;
}

function closedAt(trade: AnalyzedTrade): number {
  const timestamp = trade.entry.datetime ? new Date(trade.entry.datetime).getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function tradePriceReturnPct(trade: AnalyzedTrade): number | null {
  const entryPrice = finite(trade.entry.entry_price);
  const exitPrice = finite(trade.entry.exit_price);
  if (entryPrice != null && entryPrice > 0 && exitPrice != null) {
    const direction = trade.entry.direction === 'Short' ? -1 : 1;
    return ((exitPrice - entryPrice) / entryPrice) * direction * 100;
  }
  return finite(trade.excursion?.realized_move_pct) ?? finite(trade.entry.pnl_pct);
}

function captureRatio(quality: TradeQualityItem | null): number | null {
  return finite((quality?.exit_quality as { capture_ratio_pct?: number | null } | undefined)?.capture_ratio_pct);
}

export function isMajorSuccess(trade: AnalyzedTrade): boolean {
  const pnl = finite(trade.entry.realized_pnl);
  if (pnl == null || pnl <= 0) return false;
  const returnPct = netReturnPct(trade.entry);
  const priceReturnPct = tradePriceReturnPct(trade);
  return (
    (returnPct != null && returnPct >= MAJOR_SUCCESS_RETURN_PCT)
    || (priceReturnPct != null && priceReturnPct >= MAJOR_SUCCESS_PRICE_PCT)
  );
}

export function majorSuccessCases(
  trades: AnalyzedTrade[],
  qualityItems: TradeQualityItem[],
): MajorSuccessCase[] {
  const qualityById = new Map(qualityItems.map((item) => [item.journal_id, item]));
  return trades.flatMap((trade) => {
    if (!isMajorSuccess(trade)) return [];
    const pnl = finite(trade.entry.realized_pnl) as number;
    const returnPct = netReturnPct(trade.entry);
    const priceReturnPct = tradePriceReturnPct(trade);
    const quality = trade.entry.id == null ? null : qualityById.get(trade.entry.id) || null;
    const reasons: MajorSuccessReasonId[] = [];
    if (returnPct != null && returnPct >= MAJOR_SUCCESS_RETURN_PCT) reasons.push('return_threshold');
    if (priceReturnPct != null && priceReturnPct >= MAJOR_SUCCESS_PRICE_PCT) reasons.push('price_threshold');
    if (quality?.quality_class?.startsWith('good_entry')) reasons.push('good_entry');
    if (quality?.market_regime.alignment === 'aligned') reasons.push('trend_aligned');
    if (quality?.trade_alignment === 'with_trend') reasons.push('with_trend');
    if (quality?.quality_class === 'good_entry_good_exit') reasons.push('good_exit');
    if (quality?.quality_class === 'good_entry_early_exit') reasons.push('early_exit');
    return [{
      trade,
      quality,
      netReturnPct: returnPct,
      priceReturnPct,
      netProfitUsdt: pnl,
      captureRatioPct: captureRatio(quality),
      reasons,
    }];
  }).sort((left, right) => {
    const timeDifference = closedAt(right.trade) - closedAt(left.trade);
    if (timeDifference !== 0) return timeDifference;
    return (right.trade.entry.id || 0) - (left.trade.entry.id || 0);
  });
}

export function summarizeMajorSuccesses(
  trades: AnalyzedTrade[],
  qualityItems: TradeQualityItem[],
): MajorSuccessSummary {
  const cases = majorSuccessCases(trades, qualityItems);
  const grossProfit = trades.reduce((sum, trade) => {
    const pnl = finite(trade.entry.realized_pnl);
    return pnl != null && pnl > 0 ? sum + pnl : sum;
  }, 0);
  const totalProfitUsdt = cases.reduce((sum, item) => sum + item.netProfitUsdt, 0);
  const marginReturns = cases.flatMap((item) => item.netReturnPct ?? []);
  const priceReturns = cases.flatMap((item) => item.priceReturnPct ?? []);
  const captureRatios = cases.flatMap((item) => item.captureRatioPct ?? []);
  return {
    cases,
    totalProfitUsdt,
    grossProfitSharePct: grossProfit > 0 ? totalProfitUsdt / grossProfit * 100 : null,
    averageNetReturnPct: mean(marginReturns),
    averagePriceReturnPct: mean(priceReturns),
    averageCaptureRatioPct: mean(captureRatios),
    goodEntryCount: cases.filter((item) => item.reasons.includes('good_entry')).length,
    alignedTrendCount: cases.filter((item) => item.reasons.includes('trend_aligned')).length,
    withTrendCount: cases.filter((item) => item.reasons.includes('with_trend')).length,
    earlyExitCount: cases.filter((item) => item.reasons.includes('early_exit')).length,
    dominantSymbol: mode(cases.map((item) => item.trade.entry.symbol)),
    dominantDirection: mode(cases.map((item) => item.trade.entry.direction)),
    dominantRegime: mode(cases.map((item) => item.quality?.market_regime.id)),
  };
}

