import type { OHLCV } from '../types';

export function isOHLCV(value: unknown): value is OHLCV {
  if (value == null || typeof value !== 'object') return false;

  const row = value as Record<string, unknown>;
  const numericFields = ['open_time', 'open', 'high', 'low', 'close', 'volume'];

  return (
    typeof row.open_dt === 'string' &&
    numericFields.every((field) => typeof row[field] === 'number' && Number.isFinite(row[field]))
  );
}

export function getCompletedCandles(candles: OHLCV[], limit: number): OHLCV[] {
  return candles.slice(0, -1).slice(-limit);
}
