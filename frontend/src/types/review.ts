import type { AnalyticsGroup, AnalyticsRequest, AnalyticsResult } from './analytics';

export interface ReviewRequest { filters: AnalyticsRequest['filters']; compare_previous: boolean }
export interface ObservationEvidence {
  metric: string; unit: string; value: number | null; total_sample: number; evaluable_sample: number; unavailable_sample: number;
  unavailable_reason: string | null; unavailable_reasons: Record<string, number>; true_sample: number | null; false_sample: number | null;
  within_entry_limit_sample: number | null; outside_entry_limit_sample: number | null;
}
export interface RuleSummary {
  total_rules: number; evaluable_rules: number; followed_rules: number; violated_rules: number; not_evaluable_rules: number;
  adherence_pct: string | null; coverage_pct: string | null;
}
export interface ReviewMetadata {
  filters: AnalyticsRequest['filters']; timezone: string; time_basis: string; evidence_semantics: string;
  warnings: string[]; policy: { execution_rule_metric_roles: Record<string, string>; minimum_availability_pct: number;
    healthy_rule_adherence_pct: number; entry_deviation_limit_r: number; minimum_trade_sample: number; execution_signal_policy: string };
}
export interface Pattern {
  metric: string; dimension: string; observed: AnalyticsGroup; baseline: AnalyticsGroup; signed_delta: string | null;
  status: 'ELIGIBLE' | 'INSUFFICIENT_EVIDENCE'; reasons: string[]; evaluable_trade_sample: number; baseline_evaluable_trade_sample: number;
}
export interface Patterns { metadata: ReviewMetadata; candidates: Pattern[]; state: string }
export type Classification = 'STRATEGY_POSITIVE_EXECUTION_HEALTHY' | 'STRATEGY_POSITIVE_EXECUTION_DRAG' |
  'STRATEGY_WEAK_EXECUTION_HEALTHY' | 'STRATEGY_WEAK_EXECUTION_DRAG' | 'INCONCLUSIVE';
export interface Diagnosis {
  identity: AnalyticsGroup['identity']; classification: Classification; reasons: string[]; strategy_evidence: AnalyticsResult[];
  execution_rule_evidence: { total_rule_count: number; execution_eligible_rule_count: number; execution_evaluable_rule_count: number;
    excluded_rule_count: number; excluded_rule_counts_by_role: Record<string, number>; summary: RuleSummary };
  entry_deviation: ObservationEvidence; evaluable_rule_trade_sample: number;
}
export interface Diagnoses { metadata: ReviewMetadata; diagnoses: Diagnosis[]; state: string }
export interface TradingReview {
  metadata: ReviewMetadata; state: string; performance: AnalyticsResult[]; strategy: AnalyticsResult[]; psychology: AnalyticsResult[];
  execution: { rule_and_holding_metrics: AnalyticsResult[]; observations: ObservationEvidence[]; market_dependent: ObservationEvidence[] };
  patterns: Patterns; strategy_execution: Diagnoses;
  evidence_quality: { selected_trade_count: number; unassigned_trade_count: number; assigned_without_rules_count: number;
    evaluable_rule_trade_count: number; excluded_close_time_count_all_stored_positions: number; observations: ObservationEvidence[] };
  period_comparison: { state: string; filters: AnalyticsRequest['filters'] | null; metrics: {
    metric: string; current: AnalyticsGroup; comparison: AnalyticsGroup; signed_delta: string | null; unavailable_reason: string | null;
  }[] };
}
export interface ExperimentDefinition {
  name: string; hypothesis: string; notes: string; query: AnalyticsRequest; baseline: { start_time: number; end_time: number };
  group_key: string | null; criterion: { operator: 'gte' | 'lte'; basis: 'VALUE' | 'DELTA'; target: string }; minimum_sample: number;
}
export interface Experiment {
  id: number; revision: number; status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'; ownership: 'USER_OWNED';
  created_at: string; updated_at: string; started_at: string | null; completed_at: string | null; cancelled_at: string | null;
  definition: ExperimentDefinition;
}
export interface Measurement {
  experiment_id: number; definition_revision: number; current: AnalyticsGroup | null; baseline: AnalyticsGroup | null;
  delta: string | null; criterion_status: 'MET' | 'NOT_MET' | 'NOT_EVALUABLE'; reasons: string[]; warnings: string[];
  query: AnalyticsRequest; baseline_query: AnalyticsRequest; evidence_semantics: string; evaluation_basis: string;
}
