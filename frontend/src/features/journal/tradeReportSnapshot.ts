import type { TradeIndicatorTimeframeSnapshot } from '../../types';

export type SnapshotIndicatorDefinition = {
  id: string;
  label: string;
  group: string;
  hasData: (snapshot: TradeIndicatorTimeframeSnapshot) => boolean;
};

export const SNAPSHOT_METADATA_KEYS = new Set(['status', 'reason', 'candle_close_time', 'close']);
export const KNOWN_SNAPSHOT_INDICATOR_KEYS = new Set([
  'rsi', 'macd', 'slow_stochastic', 'stoch_rsi', 'vpvr', 'anchored_vwap', 'anchored_vwaps',
]);

export function formatSnapshotNumber(
  value: number | null | undefined,
  maximumFractionDigits = 2,
): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return value.toLocaleString(undefined, { maximumFractionDigits });
}

export function humanizeIndicatorKey(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function flattenSnapshotMetrics(
  value: unknown,
  prefix = '',
): Array<{ label: string; value: string }> {
  if (value == null) return [];
  if (typeof value === 'number') {
    return [{ label: prefix || 'Value', value: Number.isFinite(value) ? formatSnapshotNumber(value, 6) : '-' }];
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return [{ label: prefix || 'Value', value: String(value) }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenSnapshotMetrics(item, prefix ? `${prefix} ${index + 1}` : String(index + 1)));
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, nestedValue]) =>
      flattenSnapshotMetrics(nestedValue, prefix ? `${prefix} · ${humanizeIndicatorKey(key)}` : humanizeIndicatorKey(key)),
    );
  }
  return [];
}
