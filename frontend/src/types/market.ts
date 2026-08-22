// 시장 데이터 타입

export interface MarketPrice {
  last: number;
  percentage: number;
  high: number;
  low: number;
  volume: number;
}

export interface FearGreedIndex {
  value: string;
  value_classification: string;
  timestamp: string;
}

export interface OHLCV {
  open_dt: string;
  open_time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  RSI?: number;
  SMA_main?: number;
  SMA_1?: number;
  SMA_2?: number;
  BB_Up?: number;
  BB_Low?: number;
  BB_Mid?: number;
  ADX?: number;
  Regime?: string;
  MACD?: number;
  MACD_signal?: number;
  MACD_hist?: number;
}

export interface VPVROHLCVCandle {
  open_time: number;
  open_time_iso: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  close_time: number;
  quote_volume: number;
  trade_count: number;
  taker_buy_base_volume: number;
  taker_buy_quote_volume: number;
}

export interface VPVRSourceData {
  source: 'binance';
  symbol: string;
  interval: string;
  requested_candles: number;
  count: number;
  candles: VPVROHLCVCandle[];
}

export interface VPVRPriceBin {
  price_low: number;
  price_high: number;
  volume: number;
  buy_volume: number;
  sell_volume: number;
  delta: number;
  volume_pct: number;
  is_poc: boolean;
  is_value_area: boolean;
  is_current: boolean;
}

export interface VPVRData {
  source: 'binance';
  symbol: string;
  interval: string;
  requested_candles: number;
  candle_count: number;
  bin_count: number;
  price_low: number;
  price_high: number;
  current_price: number;
  vwap: number | null;
  total_quote_volume: number;
  poc_price_low: number;
  poc_price_high: number;
  value_area_low: number;
  value_area_high: number;
  value_area_pct: number;
  price_range: number | null;
  allocation_method: 'candle_range_proportional';
  bins: VPVRPriceBin[];
}

export interface IndicatorSeriesData {
  t: string[];
  v: number[];
}

export interface TradeReportVWAPData {
  current_price: number;
  current_rsi: number | null;
  vwaps: Array<{
    anchor: 'day' | 'week' | 'month' | 'quarter' | 'year';
    value: number | null;
  }>;
  rolling_vwaps: Array<{
    window: number;
    value: number | null;
  }>;
  vwap_deviation?: {
    anchor: 'month';
    length: number;
    source: string;
    vwap: number;
    standard_deviation: number;
    current_price: number;
    sigma: number | null;
    zone: string;
    bands: Record<string, number>;
  } | null;
  projections: {
    rsi_30: number | null;
    rsi_70: number | null;
  };
}

export interface TradeReportData {
  source: string;
  symbol: string;
  interval: string;
  count: number;
  profile_as_of: string | null;
  candles: OHLCV[];
  series: Record<string, IndicatorSeriesData>;
  latest: Record<string, number | null> | null;
  vpvr: VPVRData | null;
  vwaps: TradeReportVWAPData | null;
}

export interface SRLevel {
  price: number;
  touches: number;
  kind: 'support' | 'resistance' | 'pivot';
  timeframe: string;
  source: string;
  label?: string;
}

export interface MarketContext {
  last_time: string;
  last_close: number;
  regime: string;
  adx: number;
  rsi: number;
}
