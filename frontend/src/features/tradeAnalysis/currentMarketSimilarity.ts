import type {
  CurrentMarketTrendState,
  JournalCurrentMarketData,
  TradeIndicatorTimeframeSnapshot,
  TradeQualityItem,
} from '../../types';
import type { AnalyzedTrade } from './tradeAnalysis';
import { anchoredVwapSigma, tradeNetReturnPct } from './tradeAnalysis';

const INDICATOR_TIMEFRAME_WEIGHTS: Record<string, number> = {
  '1h': 0.15,
  '2h': 0.2,
  '4h': 0.4,
  '1d': 0.25,
};
const TREND_TIMEFRAME_WEIGHTS: Record<string, number> = {
  '1w': 0.25,
  '1d': 0.35,
  '4h': 0.4,
};

const REQUIRED_INDICATOR_TIMEFRAMES = Object.keys(INDICATOR_TIMEFRAME_WEIGHTS);
const REQUIRED_TREND_TIMEFRAMES = Object.keys(TREND_TIMEFRAME_WEIGHTS);
const MIN_INDICATOR_METRICS = 24;

export const MIN_CURRENT_MARKET_SIMILARITY_PCT = 65;

export interface SimilarTradeRow {
  trade: AnalyzedTrade;
  qualityItem: TradeQualityItem | null;
  similarityPct: number;
  trendSimilarityPct: number | null;
  indicatorSimilarityPct: number;
  matchedIndicatorMetrics: number;
  matchedIndicatorTimeframes: number;
  outcome: 'win' | 'loss' | 'breakeven';
  directionAlignment: 'with_trend' | 'counter_trend' | 'neutral';
  netReturnPct: number | null;
  mfePct: number | null;
  postExitPotentialPct: number | null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function closeness(left: number | null, right: number | null, scale: number): number | null {
  if (left == null || right == null) return null;
  return Math.max(0, 1 - Math.abs(left - right) / scale);
}

function relativeDistance(value: unknown, reference: unknown): number | null {
  const safeValue = finite(value);
  const safeReference = finite(reference);
  if (safeValue == null || safeReference == null || safeReference === 0) return null;
  return ((safeValue - safeReference) / safeReference) * 100;
}

function normalizedMacdHistogram(snapshot: TradeIndicatorTimeframeSnapshot): number | null {
  const close = finite(snapshot.close);
  const histogram = finite(snapshot.macd?.histogram);
  return close == null || close === 0 || histogram == null ? null : (histogram / close) * 100;
}

function indicatorFrameSimilarity(
  current: TradeIndicatorTimeframeSnapshot,
  historical: TradeIndicatorTimeframeSnapshot,
): { score: number; metricCount: number } | null {
  if (current.status !== 'complete' || historical.status !== 'complete') return null;

  const parts = [
    { score: closeness(finite(current.rsi), finite(historical.rsi), 30), weight: 0.15 },
    { score: closeness(finite(current.stoch_rsi?.k), finite(historical.stoch_rsi?.k), 40), weight: 0.15 },
    { score: closeness(finite(current.slow_stochastic?.['5-3-3']?.k), finite(historical.slow_stochastic?.['5-3-3']?.k), 40), weight: 0.2 / 3 },
    { score: closeness(finite(current.slow_stochastic?.['10-6-6']?.k), finite(historical.slow_stochastic?.['10-6-6']?.k), 40), weight: 0.2 / 3 },
    { score: closeness(finite(current.slow_stochastic?.['20-12-12']?.k), finite(historical.slow_stochastic?.['20-12-12']?.k), 40), weight: 0.2 / 3 },
    { score: closeness(normalizedMacdHistogram(current), normalizedMacdHistogram(historical), 0.5), weight: 0.2 },
    { score: closeness(anchoredVwapSigma(current), anchoredVwapSigma(historical), 2), weight: 0.15 },
    { score: closeness(
      relativeDistance(current.close, current.vpvr?.poc_mid),
      relativeDistance(historical.close, historical.vpvr?.poc_mid),
      6,
    ), weight: 0.15 },
  ].filter((part): part is { score: number; weight: number } => part.score != null);

  if (parts.length === 0) return null;
  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  return {
    score: parts.reduce((sum, part) => sum + part.score * part.weight, 0) / totalWeight,
    metricCount: parts.length,
  };
}

function indicatorSimilarity(
  current: JournalCurrentMarketData['indicator_snapshot'],
  historical: AnalyzedTrade['entrySnapshot'],
): { score: number; metricCount: number; timeframeCount: number } | null {
  if (!historical?.timeframes || !current.timeframes) return null;
  let weightedScore = 0;
  let availableWeight = 0;
  let metricCount = 0;
  let timeframeCount = 0;

  for (const [timeframe, weight] of Object.entries(INDICATOR_TIMEFRAME_WEIGHTS)) {
    const currentFrame = current.timeframes[timeframe];
    const historicalFrame = historical.timeframes[timeframe];
    if (!currentFrame || !historicalFrame) continue;
    const result = indicatorFrameSimilarity(currentFrame, historicalFrame);
    if (!result) continue;
    weightedScore += result.score * weight;
    availableWeight += weight;
    metricCount += result.metricCount;
    timeframeCount += 1;
  }

  return availableWeight > 0 ? { score: weightedScore / availableWeight, metricCount, timeframeCount } : null;
}

function categoricalSimilarity(current: unknown, historical: unknown, sidewaysPartial = false): number | null {
  if (typeof current !== 'string' || typeof historical !== 'string') return null;
  if (current === historical) return 1;
  if (sidewaysPartial && (current === 'sideways' || historical === 'sideways')) return 0.35;
  return 0;
}

function trendStateSimilarity(current: CurrentMarketTrendState, historicalValue: unknown): number | null {
  const historical = record(historicalValue);
  if (current.status !== 'complete' || historical?.status !== 'complete') return null;
  const historicalMacd = record(historical.macd);
  const parts = [
    { score: categoricalSimilarity(current.direction, historical.direction, true), weight: 0.6 },
    { score: categoricalSimilarity(current.ema_alignment, historical.ema_alignment), weight: 0.2 },
    { score: categoricalSimilarity(current.macd?.direction, historicalMacd?.direction), weight: 0.2 },
  ].filter((part): part is { score: number; weight: number } => part.score != null);
  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  return totalWeight > 0
    ? parts.reduce((sum, part) => sum + part.score * part.weight, 0) / totalWeight
    : null;
}

function trendSimilarity(
  current: JournalCurrentMarketData['trend_states'],
  historical: TradeQualityItem['trend_states'],
): { score: number; timeframeCount: number } | null {
  let weightedScore = 0;
  let availableWeight = 0;
  let timeframeCount = 0;
  for (const [timeframe, weight] of Object.entries(TREND_TIMEFRAME_WEIGHTS)) {
    const score = trendStateSimilarity(current[timeframe], historical[timeframe]);
    if (score == null) continue;
    weightedScore += score * weight;
    availableWeight += weight;
    timeframeCount += 1;
  }
  return availableWeight > 0 ? { score: weightedScore / availableWeight, timeframeCount } : null;
}

function normalizedSymbol(value: string | null | undefined): string {
  return (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function exitMetric(item: TradeQualityItem | null, key: string): number | null {
  return finite(record(item?.exit_quality)?.[key]);
}

function closedAt(trade: AnalyzedTrade): number {
  const timestamp = trade.entry.datetime ? new Date(trade.entry.datetime).getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function buildCurrentMarketSimilarities(
  current: JournalCurrentMarketData,
  trades: AnalyzedTrade[],
  qualityItems: TradeQualityItem[],
): SimilarTradeRow[] {
  const qualityById = new Map(qualityItems.map((item) => [item.journal_id, item]));
  const currentSymbol = normalizedSymbol(current.symbol);

  return trades.flatMap((trade) => {
    if (normalizedSymbol(trade.entry.symbol) !== currentSymbol) return [];
    if (trade.entryTimeConfidence !== 'confirmed') return [];
    const indicator = indicatorSimilarity(current.indicator_snapshot, trade.entrySnapshot);
    if (
      !indicator
      || indicator.timeframeCount !== REQUIRED_INDICATOR_TIMEFRAMES.length
      || indicator.metricCount < MIN_INDICATOR_METRICS
    ) return [];
    const qualityItem = trade.entry.id == null ? null : qualityById.get(trade.entry.id) || null;
    if (!qualityItem) return [];
    const trend = trendSimilarity(current.trend_states, qualityItem.trend_states);
    if (!trend || trend.timeframeCount !== REQUIRED_TREND_TIMEFRAMES.length) return [];
    const pnl = finite(trade.entry.realized_pnl);
    if (pnl == null) return [];
    const similarity = trend.score * 0.45 + indicator.score * 0.55;
    const marketBias = current.market_regime.trade_bias;
    const directionAlignment: SimilarTradeRow['directionAlignment'] = marketBias === 'neutral'
      ? 'neutral'
      : (trade.entry.direction === 'Long' && marketBias === 'up')
        || (trade.entry.direction === 'Short' && marketBias === 'down')
        ? 'with_trend'
        : 'counter_trend';

    const outcome: SimilarTradeRow['outcome'] = pnl == null || pnl === 0
      ? 'breakeven'
      : pnl > 0 ? 'win' : 'loss';

    return [{
      trade,
      qualityItem,
      similarityPct: similarity * 100,
      trendSimilarityPct: trend.score * 100,
      indicatorSimilarityPct: indicator.score * 100,
      matchedIndicatorMetrics: indicator.metricCount,
      matchedIndicatorTimeframes: indicator.timeframeCount,
      outcome,
      directionAlignment,
      netReturnPct: tradeNetReturnPct(trade),
      mfePct: finite(trade.excursion?.mfe_pct),
      postExitPotentialPct: exitMetric(qualityItem, 'additional_profit_potential_pct'),
    }];
  }).sort((left, right) => {
    const timeDifference = closedAt(right.trade) - closedAt(left.trade);
    if (timeDifference !== 0) return timeDifference;
    return (right.trade.entry.id || 0) - (left.trade.entry.id || 0);
  });
}

export function selectCurrentMarketSimilarities(
  rows: SimilarTradeRow[],
  limit = 10,
): SimilarTradeRow[] {
  return rows
    .filter((row) => row.similarityPct >= MIN_CURRENT_MARKET_SIMILARITY_PCT)
    .slice(0, limit);
}

export function trendDirectionLabel(states: Record<string, unknown>): string {
  const arrow = (value: unknown) => {
    const direction = record(value)?.direction;
    return direction === 'up' ? '↑' : direction === 'down' ? '↓' : direction === 'sideways' ? '→' : '?';
  };
  return `W ${arrow(states['1w'])} · D ${arrow(states['1d'])} · 4H ${arrow(states['4h'])}`;
}
