import type { AnalyticsGroup } from './analytics';
import type { StrategyRuleDocumentV2 } from './strategy';

export type PrimaryMetric = 'average_return_pct' | 'average_r';
export type DiscoveryMetric = PrimaryMetric | 'win_rate_pct' | 'profit_factor';
export interface DiscoveryRequest {
  start_time: number; end_time: number; symbols: string[] | null;
  directions: ('Long' | 'Short')[] | null; primary_metric: PrimaryMetric;
}
export interface DiscoveryMetadata {
  engine_version: number; policy_version: number; features: string[]; primary_metrics: PrimaryMetric[];
  metrics: DiscoveryMetric[]; discovery_pct: number; minimum_sample_per_segment: number;
  minimum_coverage_pct: number; max_trades: number; max_symbols: number; max_candidates: number;
  max_conditions: number; time_basis: string; evidence_semantics: string; profit_factor_reason: string; ranking_basis: string;
}
export interface DiscoverySegment {
  sample: number; metrics: Record<DiscoveryMetric, AnalyticsGroup>; baseline: Record<DiscoveryMetric, AnalyticsGroup>;
  primary_delta: string | null; trade_ids: number[];
}
export interface CandidateAdoption {
  strategy_id: number; version_id: number; rules_modified: boolean;
  evidence_applies_to_saved_rules: boolean; saved_rules_fingerprint: string; created_at: string;
}
export interface StrategyCandidate {
  id: number; run_id: number; rank: number; name: string;
  conditions: { field: 'symbol' | 'direction'; operator?: 'eq' | 'in'; value: string | string[] }[];
  rules: StrategyRuleDocumentV2; discovery: DiscoverySegment; validation: DiscoverySegment;
  validation_state: 'CONSISTENT' | 'WEAKENED' | 'INSUFFICIENT_EVIDENCE'; reasons: string[];
  adoption: CandidateAdoption | null;
}
export interface DiscoveryRun {
  id: number; request: DiscoveryRequest; engine_version: number; policy_version: number;
  input_fingerprint: string; created_at: string;
  summary: {
    selected_trades: number; discovery_trades: number; validation_trades: number;
    excluded: Record<string, number>; split_time: number; searched_conditions: number;
    shortlisted_candidates: number; candidate_count: number;
    state: 'AVAILABLE' | 'NO_CANDIDATES' | 'INSUFFICIENT_EVIDENCE';
    baseline_discovery: Record<DiscoveryMetric, AnalyticsGroup>; baseline_validation: Record<DiscoveryMetric, AnalyticsGroup>;
  };
}
export interface DiscoveryRunDetail extends DiscoveryRun { candidates: StrategyCandidate[] }
export interface DiscoveryRunPage { items: DiscoveryRun[]; offset: number; has_more: boolean }
export interface DiscoveryEvidence {
  journal_id: number; external_id: string | null; symbol: string | null; direction: string | null;
  entry_datetime: string | null; datetime: string | null; average_return_pct: number | null;
  realized_r: string | null; segment: 'DISCOVERY' | 'VALIDATION';
}
export interface DiscoveryEvidencePage { items: DiscoveryEvidence[]; offset: number; has_more: boolean }
