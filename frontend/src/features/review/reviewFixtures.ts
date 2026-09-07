import type { AnalyticsMetadata } from '../../types/analytics';
import type { Classification, Diagnosis, Experiment, ObservationEvidence, Pattern, ReviewMetadata, TradingReview } from '../../types/review';
import { group, metadataFixture, resultFixture } from '../analytics/analyticsTestFixtures';

export function reviewDiscovery(): AnalyticsMetadata {
  const data = metadataFixture();
  return { ...data, metrics: [
    { ...data.metrics[0], id: 'average_r', label: 'Average R' },
    { ...data.metrics[0], id: 'trade_count', label: 'Trade count' },
    { ...data.metrics[1], id: 'adherence_pct', label: 'Global adherence' },
  ] };
}
export const filters = { start_time: 1767225600000, end_time: 1767311999999 };
export const reviewMetadata: ReviewMetadata = { filters, timezone: 'UTC', time_basis: 'CLOSE_DATETIME_INCLUSIVE', evidence_semantics: 'OBSERVED_ASSOCIATION', warnings: ['Historical association only.'],
  policy: { execution_rule_metric_roles: { 'execution.entry_deviation_r': 'EXECUTION_PROCESS' }, minimum_availability_pct: 80, minimum_trade_sample: 5, healthy_rule_adherence_pct: 80, entry_deviation_limit_r: .1, execution_signal_policy: 'Process evidence only.' } };
export function observation(metric = 'execution.entry_deviation_r', missing = false): ObservationEvidence {
  return { metric, unit: 'R', value: missing ? null : .1, total_sample: 10, evaluable_sample: missing ? 0 : 10, unavailable_sample: missing ? 10 : 0,
    unavailable_reason: missing ? 'MARKET_PATH_NOT_IN_SNAPSHOT' : null, unavailable_reasons: missing ? { MARKET_PATH_NOT_IN_SNAPSHOT: 10 } : {},
    true_sample: null, false_sample: null, within_entry_limit_sample: missing ? null : 10, outside_entry_limit_sample: missing ? null : 0 };
}
export function diagnosisFixture(classification: Classification = 'STRATEGY_POSITIVE_EXECUTION_HEALTHY'): Diagnosis {
  return { identity: { ...group('Historical v1').identity, key: 'strategy_version:42', strategy_id: 7, strategy_version_id: 42 }, classification, reasons: ['OBSERVED_EXECUTION_HEALTHY'], strategy_evidence: [resultFixture({ metric: reviewDiscovery().metrics[0], groups: [group('R outcomes', 2)] })],
    execution_rule_evidence: { total_rule_count: 20, execution_eligible_rule_count: 10, execution_evaluable_rule_count: 8, excluded_rule_count: 10, excluded_rule_counts_by_role: { OUTCOME: 10 }, summary: { total_rules: 10, evaluable_rules: 8, followed_rules: 8, violated_rules: 0, not_evaluable_rules: 2, adherence_pct: '100', coverage_pct: '80' } }, entry_deviation: observation(), evaluable_rule_trade_sample: 8 };
}
export function patternFixture(status: Pattern['status'] = 'ELIGIBLE'): Pattern {
  return { metric: 'average_r', dimension: 'fomo', observed: group('FALSE', '0.000000001'), baseline: group('All trades', '1'), signed_delta: '-0.999999999', status, reasons: status === 'ELIGIBLE' ? [] : ['SEGMENT_SMALL_SAMPLE'], evaluable_trade_sample: 7, baseline_evaluable_trade_sample: 7 };
}
export function tradingFixture(): TradingReview {
  const data = resultFixture({ metric: reviewDiscovery().metrics[0] });
  return { metadata: reviewMetadata, state: 'AVAILABLE', performance: [data], strategy: [data], psychology: [data],
    execution: { rule_and_holding_metrics: [resultFixture({ metric: reviewDiscovery().metrics[2], groups: [group('All rules', '50')] })], observations: [observation()], market_dependent: [observation('mfe_capture_efficiency', true), observation('plan_exit_adherence', true), observation('post_exit_opportunity', true)] },
    patterns: { metadata: reviewMetadata, candidates: [patternFixture()], state: 'AVAILABLE' }, strategy_execution: { metadata: reviewMetadata, diagnoses: [diagnosisFixture()], state: 'AVAILABLE' },
    evidence_quality: { selected_trade_count: 10, unassigned_trade_count: 2, assigned_without_rules_count: 1, evaluable_rule_trade_count: 8, excluded_close_time_count_all_stored_positions: 1, observations: [observation()] },
    period_comparison: { state: 'AVAILABLE', filters, metrics: [{ metric: 'average_r', current: group('Now', 2), comparison: group('Before', 1), signed_delta: '1', unavailable_reason: null }] } };
}
export function experimentFixture(id = 1, status: Experiment['status'] = 'DRAFT'): Experiment {
  return { id, revision: 1, ownership: 'USER_OWNED', status, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', started_at: null, completed_at: null, cancelled_at: null,
    definition: { name: `Experiment ${id}`, hypothesis: 'User hypothesis', notes: '', query: { metric: 'average_r', dimension: 'all', filters }, baseline: { start_time: filters.start_time - 86400000, end_time: filters.start_time - 1 }, group_key: null, criterion: { operator: 'gte', basis: 'DELTA', target: '0.2' }, minimum_sample: 5 } };
}
