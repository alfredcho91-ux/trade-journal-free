import { describe, expect, it } from 'vitest';

import type { OHLCV } from '../../types';
import { buildTradePathSummary, tradePathSummaryText } from './tradePathSummary';

const START = Date.parse('2026-08-01T00:00:00Z');

function candle(offset: number, high: number, low: number): OHLCV {
  return {
    open_dt: new Date(START + offset * 300_000).toISOString(),
    open_time: START + offset * 300_000,
    open: 100,
    high,
    low,
    close: 100,
    volume: 1,
  };
}

describe('buildTradePathSummary', () => {
  it('summarizes a long rally, entry retest, and later decline in order', () => {
    const result = buildTradePathSummary({
      candles: [candle(1, 101, 100), candle(24, 102, 101), candle(48, 101, 99), candle(54, 100, 99)],
      direction: 'Long',
      entry_time: new Date(START).toISOString(),
      exit_time: new Date(START + 60 * 300_000).toISOString(),
      entry_price: 100,
      exit_price: 99.6,
      interval: '5m',
    });

    expect(result?.favorable_peak?.raw_move_pct).toBeCloseTo(2);
    expect(result?.favorable_peak?.elapsed_ms).toBe(24 * 300_000);
    expect(result?.entry_retest?.elapsed_ms).toBe(48 * 300_000);
    expect(result?.adverse_peak_after_retest?.raw_move_pct).toBeCloseTo(-1);
    expect(tradePathSummaryText(result!, true)).toContain('최대 +2% 상승');
    expect(tradePathSummaryText(result!, true)).toContain('진입가 재도달');
    expect(tradePathSummaryText(result!, true)).toContain('최대 -1% 하락');
  });

  it('reverses favorable and adverse extremes for short positions', () => {
    const result = buildTradePathSummary({
      candles: [candle(1, 100, 99), candle(12, 99, 98), candle(24, 101, 100), candle(30, 101, 100)],
      direction: 'Short',
      entry_time: new Date(START).toISOString(),
      exit_time: new Date(START + 36 * 300_000).toISOString(),
      entry_price: 100,
      exit_price: 100.5,
      interval: '5m',
    });

    expect(result?.favorable_peak?.raw_move_pct).toBeCloseTo(-2);
    expect(result?.entry_retest).not.toBeNull();
    expect(result?.adverse_peak_after_retest?.raw_move_pct).toBeCloseTo(1);
  });

  it('does not invent an entry retest from the same candle as the favorable peak', () => {
    const result = buildTradePathSummary({
      candles: [candle(1, 102, 99), candle(2, 102, 101)],
      direction: 'Long',
      entry_time: new Date(START).toISOString(),
      exit_time: new Date(START + 3 * 300_000).toISOString(),
      entry_price: 100,
      exit_price: 101,
      interval: '5m',
    });

    expect(result?.favorable_peak?.time).toBe(START + 300_000);
    expect(result?.entry_retest).toBeNull();
  });
});
