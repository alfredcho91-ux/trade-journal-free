// 매매 일지 타입
import type { AnchoredVwapDeviation } from './indicators';

export interface TradeIndicatorPair {
  k?: number | null;
  d?: number | null;
  cross?: 'golden' | 'dead' | 'none';
}

export interface TradeIndicatorTimeframeSnapshot {
  status?: 'complete' | 'unavailable';
  reason?: string;
  candle_close_time?: string;
  close?: number | null;
  rsi?: number | null;
  macd?: {
    line?: number | null;
    signal?: number | null;
    histogram?: number | null;
    cross?: 'golden' | 'dead' | 'none';
  };
  slow_stochastic?: Record<string, TradeIndicatorPair>;
  stoch_rsi?: TradeIndicatorPair;
  vpvr?: {
    purpose?: 'volume_profile';
    candles?: number;
    bin_count?: number;
    poc_low?: number | null;
    poc_high?: number | null;
    poc_mid?: number | null;
    value_area_low?: number | null;
    value_area_high?: number | null;
    vwap?: number | null;
  };
  anchored_vwap?: AnchoredVwapDeviation | null;
}

export interface TradeIndicatorSnapshot {
  version?: number;
  market_source?: string;
  market_source_fallback?: boolean;
  reference?: string;
  event_type?: 'fill' | 'position_entry' | 'position_close' | 'current_market';
  event_time?: string;
  fill_time?: string;
  timeframes?: Record<string, TradeIndicatorTimeframeSnapshot>;
  anchored_vwaps?: Partial<Record<'day' | 'week' | 'month', AnchoredVwapDeviation>>;
}

export interface CurrentMarketTrendState {
  status?: 'complete' | 'unavailable';
  direction?: 'up' | 'down' | 'sideways';
  strength?: 'strong' | 'moderate' | 'weak' | 'unknown';
  trend_score?: number | null;
  ema_alignment?: 'bullish' | 'bearish' | 'mixed';
  macd?: {
    direction?: 'bullish' | 'bearish';
    momentum?: 'strengthening' | 'weakening' | 'unknown';
  };
}

export interface JournalCurrentMarketData {
  symbol: string;
  as_of: string;
  indicator_snapshot: TradeIndicatorSnapshot;
  trend_states: Record<string, CurrentMarketTrendState>;
  market_regime: {
    id: string;
    alignment: string;
    trade_bias: 'up' | 'down' | 'neutral';
  };
  warnings: string[];
}

export interface TradeExcursion {
  journal_id: number;
  mfe_pct: number;
  mae_pct: number;
  realized_move_pct: number;
  capture_pct?: number | null;
  interval?: '1m' | '15m';
  candle_count: number;
}

export interface JournalExcursionData {
  interval: '15m';
  short_trade_interval?: '1m';
  items: TradeExcursion[];
  warnings: string[];
}

export interface TradeQualityPerformance {
  trade_count: number;
  win_rate_pct?: number | null;
  average_r?: number | null;
  r_sample_count: number;
  average_pnl?: number | null;
  profit_factor?: number | null;
  average_mfe_pct?: number | null;
  average_mae_pct?: number | null;
  average_holding_minutes?: number | null;
  early_exit_ratio_pct?: number | null;
  late_exit_ratio_pct?: number | null;
  average_capture_ratio_pct?: number | null;
  sample_quality: 'low' | 'medium' | 'high';
}

export interface TradeQualityHoldAggregate {
  available_count: number;
  average_return_pct?: number | null;
  average_r?: number | null;
  r_sample_count: number;
}

export interface TradeQualityStrategyAggregate {
  triggered_count: number;
  eligible_count: number;
  trigger_rate_pct?: number | null;
  average_return_pct?: number | null;
  average_r?: number | null;
  r_sample_count: number;
}

export interface TradeQualityBestExit {
  type: 'hold' | 'strategy';
  id: string;
  average_return_pct?: number | null;
  average_r?: number | null;
  available_count?: number;
  triggered_count?: number;
}

export interface TradeQualityRegime extends TradeQualityPerformance {
  id: string;
  alignment: string;
  trade_bias: string;
  hold_results: Record<string, TradeQualityHoldAggregate>;
  best_exit_method?: TradeQualityBestExit | null;
}

export interface TradeQualityGroup extends TradeQualityPerformance {
  id: string;
}

export interface TradeQualitySummary {
  trade_count: number;
  total_pnl?: number | null;
  win_rate_pct?: number | null;
  average_r?: number | null;
  average_pnl?: number | null;
  profit_factor?: number | null;
  best_regime?: TradeQualityRegime | null;
  worst_regime?: TradeQualityRegime | null;
  quality_counts: Record<string, number>;
  early_exit_ratio_pct?: number | null;
  late_exit_ratio_pct?: number | null;
  average_capture_ratio_pct?: number | null;
  issue_balance: 'entry' | 'exit' | 'balanced' | 'insufficient_data';
  r_available_count: number;
}

export interface TradeQualityAnalysisSlice {
  summary: TradeQualitySummary;
  regimes: TradeQualityRegime[];
  alignment_stats: TradeQualityGroup[];
  trade_alignment_stats: TradeQualityGroup[];
  hold_results: Record<string, TradeQualityHoldAggregate>;
  virtual_exit_strategies: Record<string, TradeQualityStrategyAggregate>;
}

export interface JournalQualityAnalysisData extends TradeQualityAnalysisSlice {
  entry_trend_intervals: Array<'1w' | '1d' | '4h'>;
  exit_interval: '4h';
  minimum_regime_conclusion_sample: number;
  market_data_sources: string[];
  thresholds: Record<string, number | string | null>;
  direction_stats: TradeQualityGroup[];
  direction_breakdown: Record<'Long' | 'Short', TradeQualityAnalysisSlice>;
  items: TradeQualityItem[];
  return_filter: {
    basis: 'net_return_on_invested_margin';
    minimum_abs_net_return_pct: number;
    candidate_count: number;
    included_count: number;
    excluded_below_threshold_count: number;
    excluded_return_unavailable_count: number;
  };
  warnings: string[];
}

export type StopLossClassification =
  | 'false_stop'
  | 'good_stop'
  | 'reversal_opportunity'
  | 'noise_chop'
  | 'insufficient_data';

export interface StopLossSummary {
  confirmed_stop_count: number;
  classified_stop_count: number;
  pending_stop_count: number;
  class_counts: Record<string, number>;
  class_pct: Record<string, number | null>;
}

export interface StopLossRegimePattern {
  id: string;
  stop_count: number;
  false_stop_count: number;
  false_stop_pct: number;
  reversal_count: number;
  reversal_pct: number;
}

export interface StopLossHorizonResult {
  available: boolean;
  close_time?: number;
  close_price?: number;
  original_position_r?: number;
  reverse_from_stop_r?: number;
}

export interface StopLossOppositeTrade {
  journal_id: number;
  direction: 'Long' | 'Short';
  entry_datetime?: string | null;
  exit_datetime?: string | null;
  realized_pnl?: number | null;
  combined_realized_pnl?: number | null;
}

export interface StopLossAnalysisItem {
  journal_id: number;
  symbol?: string | null;
  direction: 'Long' | 'Short';
  entry_datetime?: string | null;
  exit_datetime?: string | null;
  entry_price: number;
  exit_price?: number | null;
  stop_price: number;
  stop_time: number;
  realized_pnl?: number | null;
  risk_amount?: number;
  risk_pct?: number;
  classification: StopLossClassification;
  post_candle_count: number;
  entry_recovered?: boolean;
  recovery_bars?: number | null;
  original_direction_mfe_r?: number;
  original_direction_mfe_pct?: number;
  opposite_direction_mfe_r?: number;
  opposite_direction_mfe_pct?: number;
  original_target_hits?: Record<string, boolean>;
  reversal_target_hits?: Record<string, boolean>;
  horizon_results?: Record<string, StopLossHorizonResult>;
  entry_trend_states: Record<string, Record<string, unknown>>;
  entry_market_regime: { id: string; alignment: string; trade_bias: string };
  stop_trend_states: Record<string, Record<string, unknown>>;
  stop_market_regime: { id: string; alignment: string; trade_bias: string };
  four_hour_reversal_bar?: number | null;
  opposite_trade?: StopLossOppositeTrade | null;
}

export interface JournalStopLossAnalysisData {
  interval: '4h';
  horizons: number[];
  criteria: Record<string, unknown>;
  summary: StopLossSummary;
  regime_patterns: StopLossRegimePattern[];
  direction_breakdown: Record<'Long' | 'Short', {
    summary: StopLossSummary;
    regime_patterns: StopLossRegimePattern[];
  }>;
  coverage: {
    closed_positions_considered: number;
    matched_confirmed_stops: number;
    trigger_history: Record<string, {
      raw_order_count: number;
      confirmed_stop_count: number;
      oldest_history_time?: number | null;
      newest_history_time?: number | null;
      history_limit_reached: boolean;
    }>;
  };
  items: StopLossAnalysisItem[];
  warnings: string[];
}

export interface StopOptimizationPerformance {
  trade_count: number;
  stop_hit_count: number;
  win_rate_pct?: number | null;
  winner_preservation_pct?: number | null;
  false_stop_pct?: number | null;
  average_return_pct?: number | null;
  average_r?: number | null;
  profit_factor?: number | null;
  max_drawdown_pct_points: number;
}

export interface StopOptimizationCandidate {
  type: 'fixed' | 'atr';
  value: number;
  average_stop_pct?: number | null;
  overall: StopOptimizationPerformance;
  train: StopOptimizationPerformance;
  validation: StopOptimizationPerformance;
  score: number;
}

export interface StopOptimizationRecommendation {
  lower_pct: number;
  upper_pct: number;
  selected_pct: number;
  score: number;
  train: StopOptimizationPerformance;
  validation: StopOptimizationPerformance;
  sample_quality: 'low' | 'medium' | 'high';
  validation_status?: 'passed' | 'neutral' | 'failed' | 'insufficient';
}

export interface StopOptimizationBundle {
  trade_count: number;
  train_count: number;
  validation_count: number;
  winner_mae_distribution: {
    winner_count: number;
    p50?: number | null;
    p75?: number | null;
    p90?: number | null;
    p95?: number | null;
  };
  loser_recovery: {
    loser_count: number;
    points: Array<{
      threshold_pct: number;
      reached_count: number;
      recovered_count: number;
      recovery_probability_pct?: number | null;
    }>;
    steepest_drop?: {
      from_pct: number;
      to_pct: number;
      drop_pct_points: number;
    } | null;
  };
  fixed_candidates: StopOptimizationCandidate[];
  atr_candidates: StopOptimizationCandidate[];
  recommendation?: StopOptimizationRecommendation | null;
  actual_validation: StopOptimizationPerformance;
  expected_effect?: {
    profit_factor_delta?: number | null;
    average_return_delta_pct?: number | null;
    max_drawdown_reduction_pct_points: number;
  } | null;
}

export interface JournalStopOptimizationData {
  interval: '15m';
  methodology: {
    winner_definition: string;
    candidate_return_basis: string;
    train_ratio: number;
    score_weights: Record<string, number>;
    same_candle_recovery_counted: boolean;
    minimum_regime_sample: number;
  };
  direction_breakdown: Record<'Long' | 'Short', StopOptimizationBundle>;
  regime_breakdown: Record<'Long' | 'Short', Array<{
    id: string;
    trade_count: number;
    recommendation?: StopOptimizationRecommendation | null;
  }>>;
  coverage: {
    closed_positions_considered: number;
    analyzed_positions: number;
  };
  warnings: string[];
}

export interface SlTpPerformance {
  trade_count: number;
  win_rate_pct?: number | null;
  stop_hit_count: number;
  stop_hit_pct?: number | null;
  tp_hit_count: number;
  tp_hit_pct?: number | null;
  ambiguous_count: number;
  average_win_pct?: number | null;
  average_loss_pct?: number | null;
  expectancy_pct?: number | null;
  average_r?: number | null;
  profit_factor?: number | null;
  cumulative_return_pct?: number | null;
  max_drawdown_pct?: number | null;
}

export interface SlTpCandidate {
  sl_pct: number;
  tp_pct: number;
  score: number;
  overall: SlTpPerformance;
  train: SlTpPerformance;
  validation: SlTpPerformance;
}

export interface SlTpRecommendation {
  sl_lower_pct: number;
  sl_upper_pct: number;
  tp_lower_pct: number;
  tp_upper_pct: number;
  selected_sl_pct: number;
  selected_tp_pct: number;
  score: number;
  validation_status: 'passed' | 'neutral' | 'failed' | 'insufficient';
  sample_quality: 'low' | 'medium' | 'high';
}

export interface SlTpAnalysisBundle {
  trade_count: number;
  train_count: number;
  validation_count: number;
  actual_overall: SlTpPerformance;
  actual_validation: SlTpPerformance;
  candidates: SlTpCandidate[];
  best_candidate?: SlTpCandidate | null;
  recommendation?: SlTpRecommendation | null;
}

export interface JournalSlTpAnalysisData {
  interval: '5m';
  sl_values: number[];
  tp_values: number[];
  methodology: {
    simulation_window: string;
    same_candle_policy: string;
    return_basis: string;
    funding_included: boolean;
    slippage_included: boolean;
    train_ratio: number;
    score_weights: Record<string, number>;
    max_grid_combinations: number;
  };
  direction_breakdown: Record<'Long' | 'Short', SlTpAnalysisBundle>;
  coverage: {
    closed_positions_considered: number;
    analyzed_positions: number;
    fee_proxy_positions: number;
  };
  warnings: string[];
}

export interface TradeQualityItem {
  journal_id: number;
  symbol?: string | null;
  direction?: string | null;
  entry_datetime?: string | null;
  exit_datetime?: string | null;
  realized_pnl?: number | null;
  r_multiple?: number | null;
  holding_minutes: number;
  excursion?: TradeExcursion | null;
  quality_class: string;
  trend_states: Record<string, CurrentMarketTrendState>;
  market_regime: { id: string; alignment: string; trade_bias: string };
  regime_alignment?: string;
  trade_alignment?: 'with_trend' | 'counter_trend' | 'neutral';
  exit_quality: Record<string, unknown>;
}

export interface DeepcoinStatus {
  configured: boolean;
  mode: 'read_only';
}

export interface JournalPerformanceGroup {
  id: string;
  trade_count: number;
  wins: number;
  win_rate_pct: number | null;
  net_pnl: number;
}

export interface JournalPerformanceTrade {
  journal_id: number;
  symbol?: string | null;
  direction?: string | null;
  realized_pnl?: number | null;
}

export interface JournalPerformanceData {
  closed_trade_count: number;
  evaluated_trade_count: number;
  missing_pnl_count: number;
  wins: number;
  losses: number;
  breakevens: number;
  win_rate_pct: number | null;
  net_pnl: number;
  net_return_pct: number | null;
  return_sample_count: number;
  gross_profit: number;
  gross_loss: number;
  profit_factor: number | null;
  profit_factor_infinite: boolean;
  average_win: number | null;
  average_loss: number | null;
  expectancy: number | null;
  fee_impact: number;
  funding_impact: number;
  max_win_streak: number;
  max_loss_streak: number;
  best_trade: JournalPerformanceTrade | null;
  worst_trade: JournalPerformanceTrade | null;
  directions: JournalPerformanceGroup[];
  symbols: JournalPerformanceGroup[];
}

export type ExchangeId = 'deepcoin' | 'binance' | 'bybit' | 'okx';

export interface ExchangeStatus {
  id: ExchangeId;
  name: string;
  configured: boolean;
  mode: 'read_only';
  instrument_types: Array<'SWAP' | 'SPOT'>;
  requires_passphrase: boolean;
  connector: 'native' | 'ccxt';
  credential_source: 'environment' | 'keyring' | 'encrypted_db' | 'none';
  credential_error?: string | null;
}

export interface ExchangeCredentialDeleteResult {
  exchanges: ExchangeStatus[];
  deleted: boolean;
  environment_override: boolean;
}

export interface ExchangeSyncResult extends DeepcoinSyncResult {
  exchange: ExchangeId;
}

export interface DeepcoinSyncResult {
  inst_type: 'SWAP' | 'SPOT';
  lookback_days: number;
  fetched: number;
  imported: number;
  skipped: number;
  ignored: number;
  complete_snapshots: number;
  partial_snapshots: number;
  positions_fetched: number;
  positions_imported: number;
  positions_updated: number;
  fills_updated: number;
  positions_skipped: number;
  positions_ignored: number;
  warnings: string[];
}

export interface DeepcoinOpenPosition {
  position_id: string;
  symbol: string;
  direction: 'Long' | 'Short';
  size: number;
  average_price?: number | null;
  last_price?: number | null;
  unrealized_pnl?: number | null;
  leverage?: number | null;
  opened_at?: string | null;
  updated_at?: string | null;
}

export interface ExchangeOpenPosition extends DeepcoinOpenPosition {
  exchange: ExchangeId;
}

export interface ExchangeOpenPositionsData {
  positions: ExchangeOpenPosition[];
  unavailable_exchanges: ExchangeId[];
}

export interface TradeExecutionMarker {
  datetime: string;
  price: number;
  size?: number | null;
  order_id?: string | null;
  label: string;
}

export interface DeepcoinTradeMarkers {
  source: 'deepcoin_trigger_order_history';
  take_profits: TradeExecutionMarker[];
  warnings: string[];
}

export interface JournalEntry {
  id?: number;
  datetime?: string;
  entry_datetime?: string;
  symbol?: string;
  timeframe?: string;
  direction?: string;
  entry_reason_1_indicator?: string;
  entry_reason_1?: string;
  entry_reason_2_indicator?: string;
  entry_reason_2?: string;
  entry_reason_3_indicator?: string;
  entry_reason_3?: string;
  size?: number;
  entry_price?: number;
  exit_price?: number;
  pnl_pct?: number;
  r_multiple?: number;
  outcome?: string;
  emotion?: string;
  tags?: string;
  mistakes?: string;
  planned_stop_pct?: number | null;
  planned_target_pct?: number | null;
  planned_entry_reason?: string | null;
  setup_tags?: string[];
  mistake_tags?: string[];
  plan_recorded_at?: string | null;
  notes?: string;
  source?: string;
  external_id?: string;
  exchange?: string;
  order_id?: string;
  fee?: number;
  fee_currency?: string;
  funding_fee?: number;
  realized_pnl?: number;
  leverage?: number;
  invested_amount?: number;
  pnl_calculation_version?: number;
  indicator_snapshot?: TradeIndicatorSnapshot;
  created_at?: string;
}

export type JournalBehaviorRuleType = 'trend_direction_forbid' | 'max_stop_pct' | 'min_rr' | 'no_scale_in';

export interface JournalBehaviorRule {
  id: number;
  name: string;
  rule_type: JournalBehaviorRuleType;
  parameters: Record<string, unknown>;
  is_enabled: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface JournalBehaviorCondition {
  type: 'direction' | 'symbol' | 'regime' | 'setup' | 'mistake' | 'rule_status';
  value: string;
  label?: string;
}

export interface JournalBehaviorStats {
  trade_count: number;
  pnl_sample_count: number;
  total_pnl?: number | null;
  win_rate_pct?: number | null;
  average_r?: number | null;
  r_sample_count: number;
  profit_factor?: number | null;
  average_favorable_move_pct?: number | null;
  average_adverse_move_pct?: number | null;
  max_drawdown_pnl?: number | null;
}

export interface JournalBehaviorPlan {
  planned_stop_pct?: number | null;
  planned_target_pct?: number | null;
  planned_rr?: number | null;
  planned_entry_reason?: string | null;
  plan_recorded_at?: string | null;
  recording_phase: 'before_entry' | 'during_trade' | 'after_exit' | 'unknown';
  eligible_for_exit_plan_review: boolean;
  eligible_for_entry_rule_review: boolean;
  actual_price_return_pct?: number | null;
  maximum_favorable_move_pct?: number | null;
  maximum_adverse_move_pct?: number | null;
  stop_status: 'not_recorded' | 'within_exit' | 'touched_not_executed' | 'overrun';
  target_status: 'not_recorded' | 'met' | 'gave_back_after_hit' | 'closed_before_target' | 'not_reached';
}

export interface JournalBehaviorItem {
  journal_id: number;
  symbol?: string | null;
  direction?: string | null;
  entry_datetime?: string | null;
  exit_datetime?: string | null;
  realized_pnl?: number | null;
  r_multiple?: number | null;
  mfe_pct?: number | null;
  mae_pct?: number | null;
  post_exit_opportunity_pct?: number | null;
  profit_give_up_pct?: number | null;
  quality_class?: string | null;
  market_regime: { id?: string; alignment?: string; trade_bias?: string };
  trend_states: Record<string, { direction?: string; status?: string }>;
  setup_tags: string[];
  mistake_tags: string[];
  plan: JournalBehaviorPlan;
  rule_checks: Array<{ rule_id?: number; rule_name?: string; rule_type?: string; status: 'compliant' | 'violation' | 'unknown'; reason: string }>;
  rule_status: 'not_configured' | 'compliant' | 'violation' | 'unknown';
  issues: Array<{ id: string; label: string }>;
}

export interface JournalBehaviorAnalysisData {
  items: JournalBehaviorItem[];
  summary: JournalBehaviorStats;
  plan_summary: { recorded_trade_count: number; full_plan_trade_count: number; stop_overrun_count: number; target_giveback_count: number; post_exit_record_count: number };
  setup_stats: Array<{ tag: string; evidence_journal_ids: number[] } & JournalBehaviorStats>;
  mistake_stats: Array<{ tag: string; evidence_journal_ids: number[] } & JournalBehaviorStats>;
  biggest_leaks: Array<{ id: string; label: string; loss_impact_pnl: number; loss_impact_r?: number | null; opportunity_sample_count: number; average_opportunity_pct?: number | null; conclusion_eligible: boolean; evidence_journal_ids: number[] } & JournalBehaviorStats>;
  rule_status_stats: Record<'compliant' | 'violation' | 'unknown', JournalBehaviorStats>;
  rules: JournalBehaviorRule[];
  condition_options: JournalBehaviorCondition[];
  minimum_conclusion_sample: number;
  coverage: { selected_closed_positions: number; behavior_items: number; missing_quality_items: number };
  warnings: string[];
}

export interface JournalBehaviorComparisonData {
  left: { condition: JournalBehaviorCondition; stats: JournalBehaviorStats; evidence_journal_ids: number[] };
  right: { condition: JournalBehaviorCondition; stats: JournalBehaviorStats; evidence_journal_ids: number[] };
}
