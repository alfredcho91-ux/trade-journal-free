import type { AnalyticsFilter, AnalyticsGroup, AnalyticsMetadata, AnalyticsResult, DiscoveryDimension } from '../../types/analytics';

export function filter(id: string, overrides: Partial<AnalyticsFilter> = {}): AnalyticsFilter {
  return { id, label: id, description: `Recorded ${id}`, value_type: 'enum', input_mode: 'list', required: false, nullable: true,
    minimum: null, maximum: null, exclusive_minimum: null, min_items: 1, max_items: 7, min_length: null, max_length: null,
    enum_values: ['TRUE', 'FALSE', 'UNRECORDED', 'INVALID'], option_source: 'STATIC', null_semantics: 'No filter when omitted.',
    applicable_sample_units: ['trade', 'trade_rule'], ...overrides };
}
export function dimension(id: string, category = 'trade'): DiscoveryDimension {
  return { id, label: category === 'time' ? `Close ${id}` : id, semantics: category === 'time' ? 'Close / exit datetime in UTC.' : `Exact recorded ${id}.`, multi_membership: false,
    category, time_basis: category === 'time' ? 'CLOSE_DATETIME' : null, timezone: category === 'time' ? 'UTC' : null };
}
// Synthetic IDs deliberately differ from production to prove runtime discovery.
export function metadataFixture(): AnalyticsMetadata {
  const dimensions = [dimension('all', 'aggregate'), dimension('strategy', 'strategy'), dimension('strategy_version', 'strategy'),
    ...['confidence_score', 'focus_score', 'fomo', 'revenge_trade'].map(d => dimension(d, 'psychology')),
    dimension('rule_status', 'rule'), ...['day', 'week', 'month', 'weekday', 'hour'].map(d => dimension(d, 'time')), dimension('new_backend_dimension')];
  return { registry_version: 1, timezone: 'UTC', time_basis: 'CLOSE_DATETIME_INCLUSIVE', dimensions,
    metrics: [
      { id: 'server_metric', label: 'Server supplied metric', unit: 'R', sample_unit: 'trade', value_type: 'decimal', aggregation: 'Backend aggregation.', availability: 'Recorded values.', supported_dimensions: dimensions.filter(d => d.category !== 'rule').map(d => d.id) },
      { id: 'server_rules', label: 'Server rule metric', unit: 'percent', sample_unit: 'trade_rule', value_type: 'decimal', aggregation: 'Backend rule aggregation.', availability: 'Evaluable rules.', supported_dimensions: dimensions.map(d => d.id) },
    ], filters: [
      filter('start_time', { label: 'Start time', value_type: 'timestamp_ms', input_mode: 'scalar', required: true, nullable: false, enum_values: [], minimum: 1, maximum: 253402300799999 }),
      filter('end_time', { label: 'End time', value_type: 'timestamp_ms', input_mode: 'scalar', required: true, nullable: false, enum_values: [], minimum: 1, maximum: 253402300799999 }),
      filter('fomo'), filter('confidence_score', { enum_values: ['1', '2', '3', '4', '5', 'UNRECORDED', 'INVALID'] }),
      filter('rule_statuses', { enum_values: ['FOLLOWED', 'VIOLATED', 'NOT_EVALUABLE'], applicable_sample_units: ['trade_rule'] }),
      filter('symbols', { value_type: 'text', enum_values: [], min_length: 1, max_length: 12, max_items: 2, option_source: 'JOURNAL_SYMBOLS' }),
      filter('assignment', { input_mode: 'scalar', enum_values: ['ALL', 'ASSIGNED', 'UNASSIGNED'], nullable: false }),
      filter('strategy_ids', { label: 'Strategies', value_type: 'positive_integer', enum_values: [], exclusive_minimum: 0, option_source: 'STRATEGIES' }),
      filter('strategy_version_ids', { label: 'Strategy versions', value_type: 'positive_integer', enum_values: [], exclusive_minimum: 0, option_source: 'STRATEGY_VERSIONS' }),
    ], filter_constraints: [
      { id: 'ordered', kind: 'ORDER', fields: ['start_time', 'end_time'], value: null, description: 'Start must precede end.' },
      { id: 'assignment', kind: 'FORBIDS_WHEN', fields: ['assignment', 'strategy_ids', 'strategy_version_ids'], value: 'UNASSIGNED', description: 'Unassigned cannot include strategy IDs.' },
    ] };
}
export function group(label = 'All selected trades', value: number | string | null = '1.234567890123456789', overrides: Partial<AnalyticsGroup> = {}): AnalyticsGroup {
  return { identity: { key: label, label, state: 'RECORDED', strategy_id: null, strategy_version_id: null, rule_id: null, rule_category: null }, value,
    total_sample: 10, evaluable_sample: 7, unavailable_sample: 3, trade_sample: 10, unassigned_trade_count: 2, assigned_without_rules_count: 1,
    unavailable_reason: null, unavailable_reasons: { MISSING_OBSERVATION: 3 }, profit_factor_infinite: false, evidence_semantics: 'OBSERVED_ASSOCIATION', ...overrides };
}
export function resultFixture(overrides: Partial<AnalyticsResult> = {}): AnalyticsResult {
  const m = metadataFixture();
  return { registry_version: 1, metric: m.metrics[0], dimension: m.dimensions[0], filters: { start_time: 1, end_time: 2 }, groups: [group()],
    selected_trade_count: 10, excluded_unavailable_close_count: 2, timezone: 'UTC', time_basis: 'CLOSE_DATETIME_INCLUSIVE', population: 'JOURNAL_CLOSED_POSITIONS',
    evaluation_basis: 'CURRENT_RECONSTRUCTED', evidence_semantics: 'OBSERVED_ASSOCIATION', warnings: ['Observed association only.'], limits: {}, ...overrides };
}
