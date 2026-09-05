export type FilterValue = string | number | (string | number)[] | null;
export interface AnalyticsRequest {
  metric: string;
  dimension: string;
  filters: Record<string, FilterValue>;
}
export interface AnalyticsMetric {
  id: string; label: string; unit: string; sample_unit: 'trade' | 'trade_rule';
  aggregation: string; availability: string; supported_dimensions: string[];
}
export interface AnalyticsDimension {
  id: string; label: string; semantics: string; multi_membership: boolean;
}
export interface DiscoveryDimension extends AnalyticsDimension {
  category: string; time_basis: string | null; timezone: string | null;
}
export interface AnalyticsFilter {
  id: string; label: string; description: string;
  value_type: 'timestamp_ms' | 'positive_integer' | 'text' | 'enum';
  input_mode: 'scalar' | 'list'; required: boolean; nullable: boolean;
  minimum: number | null; maximum: number | null; exclusive_minimum: number | null;
  min_items: number | null; max_items: number | null;
  min_length: number | null; max_length: number | null; enum_values: string[];
  option_source: string; null_semantics: string;
  applicable_sample_units: AnalyticsMetric['sample_unit'][];
}
export interface AnalyticsMetadata {
  registry_version: number;
  metrics: (AnalyticsMetric & { value_type: 'integer' | 'decimal' })[];
  dimensions: DiscoveryDimension[];
  filters: AnalyticsFilter[];
  filter_constraints: { id: string; kind: 'ORDER' | 'FORBIDS_WHEN'; fields: string[]; value: string | null; description: string }[];
  timezone: string; time_basis: string;
}
export interface AnalyticsGroup {
  identity: { key: string; label: string; state: string; strategy_id: number | null;
    strategy_version_id: number | null; rule_id: string | null; rule_category: string | null };
  value: number | string | null;
  total_sample: number; evaluable_sample: number; unavailable_sample: number; trade_sample: number;
  unassigned_trade_count: number; assigned_without_rules_count: number;
  unavailable_reason: string | null; unavailable_reasons: Record<string, number>;
  profit_factor_infinite: boolean; evidence_semantics: string;
}
export interface AnalyticsResult {
  registry_version: number; metric: AnalyticsMetric; dimension: AnalyticsDimension;
  filters: AnalyticsRequest['filters']; groups: AnalyticsGroup[];
  selected_trade_count: number; excluded_unavailable_close_count: number;
  timezone: string; time_basis: string; population: string; evaluation_basis: string;
  evidence_semantics: string; warnings: string[]; limits: Record<string, number>;
}
