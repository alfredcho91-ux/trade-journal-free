import { describe, expect, it } from 'vitest';
import type { TradeQualityItem } from '../../types';
import type { AnalyzedTrade } from '../tradeAnalysis/tradeAnalysis';
import { summarizeTradeStyle } from './tradeStyleSummary';

function trades(count: number, overrides: Partial<AnalyzedTrade> = {}): AnalyzedTrade[] {
  return Array.from({ length: count }, (_, index) => ({
    entry: { id: index + 1, direction: index % 2 === 0 ? 'Long' : 'Short' },
    entryDatetime: '2026-08-01T00:00:00Z', entryTimeConfidence: 'confirmed', holdingMinutes: 360, excursion: null,
    entrySnapshot: { event_type: 'fill', reference: 'last_completed_candle_before_fill', timeframes: { '4h': {
      status: 'complete', rsi: 30, stoch_rsi: { k: 10 }, slow_stochastic: { '5-3-3': { k: 10 } }, macd: { histogram: index % 2 === 0 ? 1 : -1 },
    } } },
    ...overrides,
  }));
}

function qualities(count: number, overrides: Partial<TradeQualityItem> = {}): TradeQualityItem[] {
  return Array.from({ length: count }, (_, index) => ({
    journal_id: index + 1, holding_minutes: 360, quality_class: 'good_entry_early_exit', trend_states: {},
    market_regime: { id: 'mixed', alignment: 'aligned', trade_bias: 'up' }, trade_alignment: 'counter_trend', exit_quality: {}, ...overrides,
  }));
}

describe('trade style summary', () => {
  it('requires a minimum sample', () => {
    expect(summarizeTradeStyle([], [], true).text).toBe('매매 스타일 분석할 거래가 더 필요합니다');
    expect(summarizeTradeStyle(trades(4), qualities(4), true).insufficientData).toBe(true);
  });

  it('classifies a consistent counter-trend oversold day-trading period', () => {
    expect(summarizeTradeStyle(trades(6), qualities(6), true).text)
      .toBe('매매 스타일  역추세 평균회귀형 · 데이트레이딩 · 과매도 선호 · 다소 이른 청산');
  });

  it('classifies trend following and a longer holding period', () => {
    const result = summarizeTradeStyle(trades(6, { holdingMinutes: 2_000 }), qualities(6, { trade_alignment: 'with_trend', quality_class: 'good_entry_good_exit' }), true);
    expect(result.traits).toContain('추세추종형');
    expect(result.traits).toContain('단기 스윙');
    expect(result.traits).toContain('적정 청산');
  });

  it('keeps mixed and unclear labels when neither side dominates', () => {
    const result = summarizeTradeStyle(trades(6), qualities(6).map((item, index) => ({ ...item,
      trade_alignment: index % 2 === 0 ? 'with_trend' : 'counter_trend',
      quality_class: index % 3 === 0 ? 'good_entry_good_exit' : index % 3 === 1 ? 'good_entry_late_exit' : 'good_entry_early_exit',
    })), true);
    expect(result.traits[0]).toBe('혼합형');
    expect(result.traits).toContain('청산 성향 불명확');
  });
});
