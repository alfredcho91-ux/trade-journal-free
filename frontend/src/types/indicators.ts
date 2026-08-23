export type AnchoredVwapZone =
  | 'center'
  | 'upper_expansion'
  | 'strong_upper'
  | 'extreme_upper'
  | 'lower_expansion'
  | 'strong_lower'
  | 'extreme_lower';

export interface AnchoredVwapDeviation {
  anchor: 'month';
  length: number;
  sample_count: number;
  source: 'HLC3';
  vwap: number;
  standard_deviation: number;
  current_price: number;
  sigma: number | null;
  zone: AnchoredVwapZone;
  bands: Record<string, number>;
}
