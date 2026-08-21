import { describe, expect, it } from 'vitest';
import type { OHLCV } from '../types';
import { getCompletedCandles, isOHLCV } from './ohlcv';

function createCandle(index: number): OHLCV {
  return {
    open_dt: `2026-08-03T${String(index).padStart(2, '0')}:00:00Z`,
    open_time: index,
    open: index + 1,
    high: index + 2,
    low: index,
    close: index + 1.5,
    volume: index + 10,
  };
}

describe('OHLCV validation', () => {
  it('accepts a complete numeric candle', () => {
    expect(isOHLCV(createCandle(1))).toBe(true);
  });

  it('rejects a candle with invalid price data', () => {
    expect(isOHLCV({ ...createCandle(1), close: '101.5' })).toBe(false);
  });
});

describe('getCompletedCandles', () => {
  it('removes the in-progress last candle', () => {
    const candles = Array.from({ length: 201 }, (_, index) => createCandle(index));
    const result = getCompletedCandles(candles, 200);

    expect(result).toHaveLength(200);
    expect(result[0].open_time).toBe(0);
    expect(result[result.length - 1]?.open_time).toBe(199);
  });

  it('keeps only the requested recent completed candles', () => {
    const candles = Array.from({ length: 301 }, (_, index) => createCandle(index));
    const result = getCompletedCandles(candles, 200);

    expect(result).toHaveLength(200);
    expect(result[0].open_time).toBe(100);
    expect(result[result.length - 1]?.open_time).toBe(299);
  });
});
