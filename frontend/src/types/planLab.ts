export type PlanSide = 'Long' | 'Short';
export type PlanStatus = 'active' | 'linked' | 'cancelled';
export type PlanSource = 'UNLINKED' | 'RETROSPECTIVE' | 'VERIFIED_PRETRADE';
export type PlanRevisionPhase = 'PRE_TRADE' | 'POST_ENTRY_EDIT' | 'POST_TRADE_INPUT' | 'NOT_LINKED';

export interface PlanRevisionInput {
  entry_price?: number | null;
  entry_min?: number | null;
  entry_max?: number | null;
  stop_loss: number;
  take_profit: number;
  setup?: string | null;
  entry_note?: string | null;
  exit_note?: string | null;
  memo?: string | null;
  max_hold_hours?: number | null;
  client_created_at?: string | null;
}

export interface PlanRevision extends PlanRevisionInput {
  id: number;
  plan_id: number;
  version: number;
  received_at: string;
  created_at: string;
  phase?: PlanRevisionPhase;
}

export interface PlanTradeLink {
  id: number;
  plan_id: number;
  journal_entry_id?: number | null;
  journal_external_id?: string | null;
  link_status: 'LINKED' | 'AMBIGUOUS_LINK';
  linked_at: string;
  updated_at: string;
}

export interface TradingPlan {
  id: number;
  exchange: string;
  symbol: string;
  symbol_key: string;
  side: PlanSide;
  status: PlanStatus;
  source: PlanSource;
  client_created_at?: string | null;
  received_at: string;
  created_at: string;
  updated_at: string;
  revisions: PlanRevision[];
  latest_revision: PlanRevision;
  link?: PlanTradeLink | null;
}

export interface PlanGeometry {
  valid: boolean;
  status: 'VALID' | 'INVALID_PLAN';
  entry?: number | null;
  stop?: number | null;
  target?: number | null;
  risk_distance?: number | null;
  reward_distance?: number | null;
  risk_pct?: number | null;
  reward_pct?: number | null;
  planned_rr?: number | null;
  break_even_win_rate_pct?: number | null;
}

export interface PlanAdherencePart {
  score?: number | null;
  status: string;
  deviation_r?: number | null;
}

export interface PlanEvaluation {
  plan_id: number;
  journal_id: number;
  symbol?: string | null;
  side: PlanSide;
  plan_source: PlanSource;
  setup?: string | null;
  entry_datetime?: string | null;
  exit_datetime?: string | null;
  evaluation_status: string;
  geometry?: PlanGeometry;
  planned_result_r?: number | null;
  actual_r?: number | null;
  r_basis: 'usdt' | 'price' | 'unavailable';
  planned_risk_usdt?: number | null;
  net_pnl?: number | null;
  execution_delta_r?: number | null;
  execution_delta_usdt?: number | null;
  actual_return_pct?: number | null;
  original_planned_rr?: number | null;
  primary_execution_category?: string | null;
  secondary_tags?: string[];
  post_exit_outcome?: string | null;
  simulation_horizon_end?: string | null;
  simulation_horizon_hours?: number | null;
  market_regime_id?: string | null;
  adherence?: {
    entry: PlanAdherencePart;
    stop: PlanAdherencePart;
    exit: PlanAdherencePart;
    overall?: number | null;
  };
  adherent?: boolean;
  mfe_r?: number | null;
  target_calibration?: number | null;
  plan_initial?: PlanRevision | null;
  plan_effective_at_entry?: PlanRevision | null;
  revisions: PlanRevision[];
}

export interface PlanLabSummary {
  trade_count: number;
  official_r_count: number;
  closed_trade_count: number;
  plan_recorded_count: number;
  plan_recording_rate_pct?: number | null;
  plan_win_rate_pct?: number | null;
  plan_expectancy_r?: number | null;
  actual_expectancy_r?: number | null;
  execution_delta_r?: number | null;
  average_planned_rr?: number | null;
  average_break_even_win_rate_pct?: number | null;
  adherence_pct?: number | null;
  adherent_trade_pct?: number | null;
  execution_delta_total_r?: number | null;
  actual: PlanPerformance;
  plan: PlanPerformance;
}

export interface PlanPerformance {
  trade_count: number;
  expectancy_r?: number | null;
  total_r: number;
  win_rate_pct?: number | null;
  profit_factor?: number | null;
  average_win_r?: number | null;
  average_loss_r?: number | null;
  max_drawdown_r?: number | null;
  sample_confidence: 'low' | 'medium' | 'strong';
  delta_vs_actual_r?: number | null;
}

export interface PlanMatrixCell {
  id: string;
  adherent: boolean;
  plan_positive: boolean;
  trade_count: number;
  average_planned_r?: number | null;
  average_actual_r?: number | null;
  average_execution_delta_r?: number | null;
  journal_ids: number[];
}

export interface PlanBehaviorCost {
  id: string;
  trade_count: number;
  total_execution_delta_r: number;
  total_execution_delta_usdt: number;
  journal_ids: number[];
  average_actual_r?: number | null;
  average_planned_r?: number | null;
  average_execution_delta_r?: number | null;
  occurrence_rate_pct?: number | null;
  sample_confidence?: 'low' | 'medium' | 'strong';
}

export interface PlanSetupStats extends Omit<PlanLabSummary, 'closed_trade_count' | 'plan_recorded_count' | 'plan_recording_rate_pct'> {
  id: string;
  setup?: string;
  average_actual_r?: number | null;
  average_planned_r?: number | null;
  average_execution_delta_r?: number | null;
  total_execution_delta_r?: number | null;
  sample_confidence?: 'low' | 'medium' | 'strong';
  journal_ids: number[];
  all_journal_ids?: number[];
}

export interface PlanCurvePoint {
  journal_id: number;
  date?: string | null;
  symbol?: string | null;
  setup?: string | null;
  actual_r: number;
  plan_r: number;
  execution_delta_r?: number | null;
  actual_cumulative_r: number;
  plan_cumulative_r: number;
}

export interface PlanDeltaBucket {
  id: string;
  label: string;
  trade_count: number;
  journal_ids: number[];
}

export interface PlanOptimizerVariant {
  id: string;
  overall: PlanPerformance;
  discovery: PlanPerformance;
  validation: PlanPerformance;
  validation_status: 'supported' | 'observed_low_sample' | 'not_maintained';
  journal_ids: number[];
}

export interface PlanLabData {
  methodology: {
    official_revision: string;
    path_interval: string;
    same_candle_policy: string;
    official_r_basis: string;
    adherence_weights: Record<'entry' | 'stop' | 'exit', number>;
    adherence_threshold: number;
    fees_funding: string;
    verified_pretrade: string;
    retrospective: string;
    simulation_mode: string;
    default_horizon: string;
    setup_identity: string;
  };
  summary: PlanLabSummary;
  diagnosis: string;
  coverage: {
    closed_trades: number;
    plan_recorded: number;
    official_r: number;
    price_r_only: number;
    r_unavailable: number;
    ambiguous_links: number;
    ambiguous: number;
    not_evaluable: number;
    verified_pretrade: number;
    retrospective: number;
  };
  cumulative_curve: PlanCurvePoint[];
  primary_attribution: PlanBehaviorCost[];
  largest_execution_gap?: PlanBehaviorCost | null;
  secondary_observations: PlanBehaviorCost[];
  early_exit_analysis: PlanBehaviorCost[];
  stop_behavior_analysis: PlanBehaviorCost[];
  delta_distribution: PlanDeltaBucket[];
  matrix: PlanMatrixCell[];
  behavior_costs: PlanBehaviorCost[];
  setup_stats: PlanSetupStats[];
  side_stats: PlanSetupStats[];
  regime_stats: PlanSetupStats[];
  optimizer: {
    split: 'chronological_70_30';
    variants: PlanOptimizerVariant[];
  };
  target_calibration: {
    sample_count: number;
    average_mfe_r?: number | null;
    average_target_to_mfe_ratio?: number | null;
  };
  evaluations: PlanEvaluation[];
  plans: TradingPlan[];
  warnings: string[];
}
