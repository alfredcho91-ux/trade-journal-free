import type {
  JournalEntry,
  TradeExcursion,
  TradeIndicatorTimeframeSnapshot,
} from '../../types';
import { resolvePositionEntryTime, type EntryTimeConfidence } from '../../utils/positionReview';
import { isClosedPosition } from '../journal/journalEntries';
import { feeImpact, fundingImpact, netReturnPct } from '../journal/journalReturns';

export const ANALYSIS_TIMEFRAMES = ['1h', '2h', '4h', '1d'] as const;
export type AnalysisTimeframe = (typeof ANALYSIS_TIMEFRAMES)[number];
export const RETURN_RANGE_IDS = ['all', 'lt1', '1to5', '5to10', 'gte10'] as const;
export type ReturnRangeId = (typeof RETURN_RANGE_IDS)[number];

export interface AnalyzedTrade {
  entry: JournalEntry;
  entryDatetime: string | null;
  entryTimeConfidence: EntryTimeConfidence;
  entrySnapshot: JournalEntry['indicator_snapshot'] | null;
  holdingMinutes: number | null;
  excursion: TradeExcursion | null;
}
export interface PerformanceSummary {
  count: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  averageWin: number | null;
  averageLoss: number | null;
  profitFactor: number | null;
  averageHoldingMinutes: number | null;
  feeImpact: number;
  fundingImpact: number;
  averageMfePct: number | null;
  averageMaePct: number | null;
}

export interface IndicatorComparison {
  id: string;
  label: string;
  winAverage: number | null;
  lossAverage: number | null;
  difference: number | null;
  effectScore: number;
  winCount: number;
  lossCount: number;
}

export interface IndicatorAverage {
  id: string;
  label: string;
  average: number | null;
  count: number;
}

export interface ConditionComparison {
  id: string;
  label: string;
  winFrequency: number;
  lossFrequency: number;
  difference: number;
  winCount: number;
  lossCount: number;
}

export interface ReturnRangeBreakdown {
  id: Exclude<ReturnRangeId, 'all'>;
  profitCount: number;
  lossCount: number;
  profitPnl: number;
  lossPnl: number;
  averageProfitReturn: number | null;
  averageLossReturn: number | null;
}

type MetricDefinition = {
  id: string;
  label: string;
  value: (snapshot: TradeIndicatorTimeframeSnapshot) => number | null;
};

function finite(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function relativeDistance(value: number | null | undefined, reference: number | null | undefined): number | null {
  const safeValue = finite(value);
  const safeReference = finite(reference);
  if (safeValue == null || safeReference == null || safeReference === 0) return null;
  return ((safeValue - safeReference) / safeReference) * 100;
}

export function anchoredVwapSigma(snapshot: TradeIndicatorTimeframeSnapshot): number | null {
  return finite(snapshot.anchored_vwap?.sigma);
}

export const INDICATOR_METRICS: MetricDefinition[] = [
  { id: 'rsi', label: 'RSI', value: (snapshot) => finite(snapshot.rsi) },
  { id: 'stoch_rsi', label: 'Stoch RSI K', value: (snapshot) => finite(snapshot.stoch_rsi?.k) },
  { id: 'stoch_5', label: 'Slow Stoch 5-3-3 K', value: (snapshot) => finite(snapshot.slow_stochastic?.['5-3-3']?.k) },
  { id: 'stoch_10', label: 'Slow Stoch 10-6-6 K', value: (snapshot) => finite(snapshot.slow_stochastic?.['10-6-6']?.k) },
  { id: 'stoch_20', label: 'Slow Stoch 20-12-12 K', value: (snapshot) => finite(snapshot.slow_stochastic?.['20-12-12']?.k) },
  { id: 'macd_hist', label: 'MACD Hist', value: (snapshot) => finite(snapshot.macd?.histogram) },
  { id: 'vwap_sigma', label: '월간 VWAP 위치 (σ)', value: anchoredVwapSigma },
  { id: 'vpvr_poc_distance', label: 'VPVR POC 대비 가격', value: (snapshot) => relativeDistance(snapshot.close, snapshot.vpvr?.poc_mid) },
];

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function standardDeviation(values: number[]): number {
  const average = mean(values);
  if (average == null || values.length < 2) return 0;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

export function returnRangeIdFor(value: number): Exclude<ReturnRangeId, 'all'> {
  const magnitude = Math.abs(value);
  if (magnitude < 1) return 'lt1';
  if (magnitude < 5) return '1to5';
  if (magnitude < 10) return '5to10';
  return 'gte10';
}

export function tradeNetReturnPct(trade: AnalyzedTrade): number | null {
  return netReturnPct(trade.entry);
}

export function filterTradesByReturnRange(
  trades: AnalyzedTrade[],
  range: ReturnRangeId,
): AnalyzedTrade[] {
  if (range === 'all') return trades;
  return trades.filter((trade) => {
    const value = tradeNetReturnPct(trade);
    return value != null && returnRangeIdFor(value) === range;
  });
}

export function returnRangeBreakdown(trades: AnalyzedTrade[]): ReturnRangeBreakdown[] {
  return (RETURN_RANGE_IDS.filter((id) => id !== 'all') as Array<Exclude<ReturnRangeId, 'all'>>)
    .map((id) => {
      const rows = trades.flatMap((trade) => {
        const returnPct = tradeNetReturnPct(trade);
        const pnl = finite(trade.entry.realized_pnl);
        return returnPct == null || pnl == null || returnRangeIdFor(returnPct) !== id
          ? []
          : [{ returnPct, pnl }];
      });
      const profits = rows.filter((row) => row.pnl > 0);
      const losses = rows.filter((row) => row.pnl < 0);
      return {
        id,
        profitCount: profits.length,
        lossCount: losses.length,
        profitPnl: profits.reduce((sum, row) => sum + row.pnl, 0),
        lossPnl: losses.reduce((sum, row) => sum + row.pnl, 0),
        averageProfitReturn: mean(profits.map((row) => row.returnPct)),
        averageLossReturn: mean(losses.map((row) => row.returnPct)),
      };
    });
}

function snapshotAt(trade: AnalyzedTrade, timeframe: AnalysisTimeframe): TradeIndicatorTimeframeSnapshot | null {
  const snapshot = trade.entrySnapshot?.timeframes?.[timeframe];
  return snapshot?.status === 'complete' ? snapshot : null;
}

export function buildAnalyzedTrades(entries: JournalEntry[], excursions: TradeExcursion[] = []): AnalyzedTrade[] {
  const excursionMap = new Map(excursions.map((item) => [item.journal_id, item]));
  return entries.filter(isClosedPosition).map((entry) => {
    const resolution = resolvePositionEntryTime(entry, entries);
    const entryMs = resolution.datetime ? new Date(resolution.datetime).getTime() : Number.NaN;
    const exitMs = entry.datetime ? new Date(entry.datetime).getTime() : Number.NaN;
    const holdingMinutes = Number.isFinite(entryMs) && Number.isFinite(exitMs) && exitMs >= entryMs
      ? (exitMs - entryMs) / 60_000
      : null;
    const snapshot = resolution.matchedEntry?.indicator_snapshot || null;
    const isEntrySnapshot = Boolean(
      snapshot &&
      (snapshot.event_type === 'fill' || snapshot.reference?.includes('_fill')),
    );
    return {
      entry,
      entryDatetime: resolution.datetime,
      entryTimeConfidence: resolution.confidence,
      entrySnapshot: isEntrySnapshot ? snapshot : null,
      holdingMinutes,
      excursion: entry.id == null ? null : excursionMap.get(entry.id) || null,
    };
  });
}

export function performanceSummary(trades: AnalyzedTrade[]): PerformanceSummary {
  const pnl = trades.flatMap((trade) => finite(trade.entry.realized_pnl) ?? []);
  const wins = pnl.filter((value) => value > 0);
  const losses = pnl.filter((value) => value < 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const holding = trades.flatMap((trade) => finite(trade.holdingMinutes) ?? []);
  const mfe = trades.flatMap((trade) => finite(trade.excursion?.mfe_pct) ?? []);
  const mae = trades.flatMap((trade) => finite(trade.excursion?.mae_pct) ?? []);
  return {
    count: pnl.length,
    wins: wins.length,
    losses: losses.length,
    winRate: pnl.length > 0 ? (wins.length / pnl.length) * 100 : 0,
    netPnl: pnl.reduce((sum, value) => sum + value, 0),
    averageWin: mean(wins),
    averageLoss: mean(losses),
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null,
    averageHoldingMinutes: mean(holding),
    feeImpact: feeImpact(trades.map((trade) => trade.entry)),
    fundingImpact: fundingImpact(trades.map((trade) => trade.entry)),
    averageMfePct: mean(mfe),
    averageMaePct: mean(mae),
  };
}

export function indicatorComparisons(
  trades: AnalyzedTrade[],
  timeframe: AnalysisTimeframe,
): IndicatorComparison[] {
  return INDICATOR_METRICS.map((metric) => {
    const valuesFor = (isWin: boolean) => trades.flatMap((trade) => {
      const pnl = finite(trade.entry.realized_pnl);
      const snapshot = snapshotAt(trade, timeframe);
      if (pnl == null || !snapshot || (pnl > 0) !== isWin || pnl === 0) return [];
      return metric.value(snapshot) ?? [];
    });
    const winValues = valuesFor(true);
    const lossValues = valuesFor(false);
    const winAverage = mean(winValues);
    const lossAverage = mean(lossValues);
    const difference = winAverage != null && lossAverage != null ? winAverage - lossAverage : null;
    const deviation = standardDeviation([...winValues, ...lossValues]);
    return {
      id: metric.id,
      label: metric.label,
      winAverage,
      lossAverage,
      difference,
      effectScore: difference == null ? 0 : Math.abs(difference) / Math.max(deviation, 1e-9),
      winCount: winValues.length,
      lossCount: lossValues.length,
    };
  }).sort((a, b) => b.effectScore - a.effectScore);
}

export function indicatorAverages(
  trades: AnalyzedTrade[],
  timeframe: AnalysisTimeframe,
): IndicatorAverage[] {
  return INDICATOR_METRICS.map((metric) => {
    const values = trades.flatMap((trade) => {
      const snapshot = snapshotAt(trade, timeframe);
      return snapshot ? metric.value(snapshot) ?? [] : [];
    });
    return {
      id: metric.id,
      label: metric.label,
      average: mean(values),
      count: values.length,
    };
  });
}

type ConditionDefinition = {
  id: string;
  label: string;
  test: (snapshot: TradeIndicatorTimeframeSnapshot) => boolean | null;
};

function below(value: number | null | undefined, threshold: number): boolean | null {
  const safe = finite(value);
  return safe == null ? null : safe <= threshold;
}

function above(value: number | null | undefined, threshold: number): boolean | null {
  const safe = finite(value);
  return safe == null ? null : safe >= threshold;
}

const CONDITIONS: ConditionDefinition[] = [
  { id: 'rsi_low', label: 'RSI 40 이하', test: (snapshot) => below(snapshot.rsi, 40) },
  { id: 'rsi_high', label: 'RSI 60 이상', test: (snapshot) => above(snapshot.rsi, 60) },
  { id: 'stoch_rsi_low', label: 'Stoch RSI 20 이하', test: (snapshot) => below(snapshot.stoch_rsi?.k, 20) },
  { id: 'stoch_rsi_high', label: 'Stoch RSI 80 이상', test: (snapshot) => above(snapshot.stoch_rsi?.k, 80) },
  { id: 'stoch_5_low', label: 'Slow Stoch 5-3-3 20 이하', test: (snapshot) => below(snapshot.slow_stochastic?.['5-3-3']?.k, 20) },
  { id: 'stoch_5_high', label: 'Slow Stoch 5-3-3 80 이상', test: (snapshot) => above(snapshot.slow_stochastic?.['5-3-3']?.k, 80) },
  { id: 'stoch_10_low', label: 'Slow Stoch 10-6-6 20 이하', test: (snapshot) => below(snapshot.slow_stochastic?.['10-6-6']?.k, 20) },
  { id: 'stoch_10_high', label: 'Slow Stoch 10-6-6 80 이상', test: (snapshot) => above(snapshot.slow_stochastic?.['10-6-6']?.k, 80) },
  { id: 'stoch_20_low', label: 'Slow Stoch 20-12-12 20 이하', test: (snapshot) => below(snapshot.slow_stochastic?.['20-12-12']?.k, 20) },
  { id: 'stoch_20_high', label: 'Slow Stoch 20-12-12 80 이상', test: (snapshot) => above(snapshot.slow_stochastic?.['20-12-12']?.k, 80) },
  { id: 'macd_positive', label: 'MACD Hist 양수', test: (snapshot) => above(snapshot.macd?.histogram, 0) },
  { id: 'macd_negative', label: 'MACD Hist 음수', test: (snapshot) => {
    const value = finite(snapshot.macd?.histogram);
    return value == null ? null : value < 0;
  } },
  { id: 'above_vwap', label: '월간 VWAP 중심 위', test: (snapshot) => {
    const sigma = anchoredVwapSigma(snapshot);
    return sigma == null ? null : sigma >= 0;
  } },
  { id: 'below_vwap', label: '월간 VWAP 중심 아래', test: (snapshot) => {
    const sigma = anchoredVwapSigma(snapshot);
    return sigma == null ? null : sigma < 0;
  } },
  { id: 'inside_value_area', label: '가격이 VPVR Value Area 내부', test: (snapshot) => {
    const close = finite(snapshot.close);
    const low = finite(snapshot.vpvr?.value_area_low);
    const high = finite(snapshot.vpvr?.value_area_high);
    return close == null || low == null || high == null ? null : close >= low && close <= high;
  } },
];

export function conditionComparisons(
  trades: AnalyzedTrade[],
  timeframe: AnalysisTimeframe,
): ConditionComparison[] {
  return CONDITIONS.flatMap((condition) => {
    const summarize = (isWin: boolean) => {
      let available = 0;
      let matched = 0;
      for (const trade of trades) {
        const pnl = finite(trade.entry.realized_pnl);
        const snapshot = snapshotAt(trade, timeframe);
        if (pnl == null || pnl === 0 || !snapshot || (pnl > 0) !== isWin) continue;
        const result = condition.test(snapshot);
        if (result == null) continue;
        available += 1;
        if (result) matched += 1;
      }
      return { available, matched, frequency: available > 0 ? (matched / available) * 100 : 0 };
    };
    const win = summarize(true);
    const loss = summarize(false);
    if (win.available === 0 || loss.available === 0) return [];
    return [{
      id: condition.id,
      label: condition.label,
      winFrequency: win.frequency,
      lossFrequency: loss.frequency,
      difference: win.frequency - loss.frequency,
      winCount: win.available,
      lossCount: loss.available,
    }];
  }).sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
}

export function filterTradesByCondition(
  trades: AnalyzedTrade[],
  timeframe: AnalysisTimeframe,
  conditionId: string,
): AnalyzedTrade[] {
  const condition = CONDITIONS.find((item) => item.id === conditionId);
  if (!condition) return [];
  return trades.filter((trade) => {
    const snapshot = snapshotAt(trade, timeframe);
    return snapshot != null && condition.test(snapshot) === true;
  });
}

export function groupPerformance(
  trades: AnalyzedTrade[],
  key: (trade: AnalyzedTrade) => string,
): Array<{ label: string; summary: PerformanceSummary }> {
  const groups = new Map<string, AnalyzedTrade[]>();
  for (const trade of trades) {
    const label = key(trade) || '-';
    groups.set(label, [...(groups.get(label) || []), trade]);
  }
  return [...groups.entries()]
    .map(([label, grouped]) => ({ label, summary: performanceSummary(grouped) }))
    .sort((a, b) => b.summary.netPnl - a.summary.netPnl);
}
