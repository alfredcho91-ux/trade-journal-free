import type { TradeQualityItem } from '../../types';
import type { AnalyzedTrade } from '../tradeAnalysis/tradeAnalysis';

const MIN_SAMPLE_SIZE = 5;
const DOMINANT_SHARE = 0.6;

export interface TradeStyleSummary {
  traits: string[];
  text: string;
  analyzedCount: number;
  insufficientData: boolean;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function share(count: number, total: number): number {
  return total ? count / total : 0;
}

function holdingTrait(minutes: number | null, isKo: boolean): string | null {
  if (minutes == null) return null;
  if (minutes <= 30) return isKo ? '스캘핑' : 'Scalping';
  if (minutes <= 8 * 60) return isKo ? '데이트레이딩' : 'Day trading';
  if (minutes <= 2 * 24 * 60) return isKo ? '단기 스윙' : 'Short swing';
  if (minutes <= 7 * 24 * 60) return isKo ? '스윙' : 'Swing';
  return isKo ? '포지션형' : 'Position trading';
}

function entryTrait(trades: AnalyzedTrade[], isKo: boolean): string {
  const signals = trades.flatMap((trade) => {
    const snapshot = trade.entrySnapshot?.timeframes?.['4h'];
    if (!snapshot || snapshot.status !== 'complete') return [];
    const values = [snapshot.rsi, snapshot.stoch_rsi?.k, snapshot.slow_stochastic?.['5-3-3']?.k]
      .filter((value): value is number => value != null && Number.isFinite(value));
    if (!values.length) return [];
    const histogram = snapshot.macd?.histogram;
    return [{
      oversold: values.some((value) => value <= 20) || (snapshot.rsi != null && snapshot.rsi <= 40),
      overbought: values.some((value) => value >= 80) || (snapshot.rsi != null && snapshot.rsi >= 60),
      momentum: histogram != null && Number.isFinite(histogram)
        && ((trade.entry.direction === 'Long' && histogram > 0) || (trade.entry.direction === 'Short' && histogram < 0)),
    }];
  });
  if (signals.length < MIN_SAMPLE_SIZE) return isKo ? '뚜렷한 진입 특성 없음' : 'No clear entry trait';
  const oversold = share(signals.filter((signal) => signal.oversold).length, signals.length);
  const overbought = share(signals.filter((signal) => signal.overbought).length, signals.length);
  const momentum = share(signals.filter((signal) => signal.momentum).length, signals.length);
  if (oversold >= DOMINANT_SHARE && oversold >= overbought + 0.15) return isKo ? '과매도 선호' : 'Oversold preference';
  if (overbought >= DOMINANT_SHARE && overbought >= oversold + 0.15) return isKo ? '과매수 선호' : 'Overbought preference';
  if (momentum >= DOMINANT_SHARE) return isKo ? '모멘텀 추종' : 'Momentum following';
  return isKo ? '뚜렷한 진입 특성 없음' : 'No clear entry trait';
}

function exitTrait(qualities: TradeQualityItem[], isKo: boolean): string {
  const classified = qualities.filter((item) => ['good_entry_early_exit', 'good_entry_late_exit', 'good_entry_good_exit'].includes(item.quality_class));
  if (classified.length < MIN_SAMPLE_SIZE) return isKo ? '청산 성향 불명확' : 'Exit tendency unclear';
  const early = share(classified.filter((item) => item.quality_class === 'good_entry_early_exit').length, classified.length);
  const late = share(classified.filter((item) => item.quality_class === 'good_entry_late_exit').length, classified.length);
  const appropriate = share(classified.filter((item) => item.quality_class === 'good_entry_good_exit').length, classified.length);
  if (early >= 0.35 && early >= late + 0.15) return isKo ? '다소 이른 청산' : 'Somewhat early exits';
  if (late >= 0.35 && late >= early + 0.15) return isKo ? '다소 늦은 청산' : 'Somewhat late exits';
  if (appropriate >= 0.5) return isKo ? '적정 청산' : 'Appropriate exits';
  return isKo ? '청산 성향 불명확' : 'Exit tendency unclear';
}

export function summarizeTradeStyle(trades: AnalyzedTrade[], qualityItems: TradeQualityItem[], isKo: boolean): TradeStyleSummary {
  if (trades.length < MIN_SAMPLE_SIZE) {
    return {
      traits: [],
      text: isKo ? '매매 스타일 분석할 거래가 더 필요합니다' : 'Trading style needs more completed trades to analyze',
      analyzedCount: trades.length,
      insufficientData: true,
    };
  }
  const qualityById = new Map(qualityItems.map((item) => [item.journal_id, item]));
  const qualities = trades.flatMap((trade) => trade.entry.id == null ? [] : qualityById.get(trade.entry.id) || []);
  const alignments = qualities.filter((item) => item.trade_alignment === 'with_trend' || item.trade_alignment === 'counter_trend');
  const withTrend = share(alignments.filter((item) => item.trade_alignment === 'with_trend').length, alignments.length);
  const counterTrend = share(alignments.filter((item) => item.trade_alignment === 'counter_trend').length, alignments.length);
  const mainTrait = alignments.length >= MIN_SAMPLE_SIZE && counterTrend >= DOMINANT_SHARE
    ? (isKo ? '역추세 평균회귀형' : 'Counter-trend mean reversion')
    : alignments.length >= MIN_SAMPLE_SIZE && withTrend >= DOMINANT_SHARE
      ? (isKo ? '추세추종형' : 'Trend following')
      : (isKo ? '혼합형' : 'Mixed');
  const holdingMinutes = trades.flatMap((trade) => trade.holdingMinutes != null && Number.isFinite(trade.holdingMinutes) ? [trade.holdingMinutes] : []);
  const traits = [
    mainTrait,
    holdingMinutes.length >= MIN_SAMPLE_SIZE ? holdingTrait(median(holdingMinutes), isKo) : null,
    entryTrait(trades, isKo),
    exitTrait(qualities, isKo),
  ].filter((trait): trait is string => trait != null).slice(0, 4);
  return {
    traits,
    text: `${isKo ? '매매 스타일' : 'Trading style'}  ${traits.join(' · ')}`,
    analyzedCount: trades.length,
    insufficientData: false,
  };
}
