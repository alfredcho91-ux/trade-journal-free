import type { RuleMetricValueType, StrategyRuleOperator } from './strategy';

export type RuleEvaluationStatus = 'FOLLOWED' | 'VIOLATED' | 'NOT_EVALUABLE';

export type RuleNotEvaluableReason =
  | 'NO_EVALUATOR'
  | 'MISSING_METRIC'
  | 'MISSING_PLAN'
  | 'PLAN_NOT_EFFECTIVE_AT_ENTRY'
  | 'INVALID_PLAN'
  | 'TRADE_NOT_CLOSED'
  | 'LEGACY_DATA_UNAVAILABLE'
  | 'UNSUPPORTED_SOURCE'
  | 'MARKET_DATA_UNAVAILABLE'
  | 'INCOMPLETE_MARKET_PATH'
  | 'INVALID_HISTORICAL_DATA'
  | 'RULE_SCHEMA_UNSUPPORTED';

export type RuleEvaluationCategory = 'ENTRY' | 'RISK' | 'EXIT';
export interface RuleConditionFact {
  metric_id: string;
  operator: StrategyRuleOperator;
  expected: unknown;
  unit: string;
  value_type: RuleMetricValueType;
}

export interface RuleObservationFact {
  available: boolean;
  value: unknown;
  unit: string | null;
  source: string | null;
  record_id: number | string | null;
  reason_code: RuleNotEvaluableReason | null;
}

export interface RuleExplanation {
  template_id: string;
  message: string;
}

export interface RuleEvaluationResult {
  rule_id: string;
  category: RuleEvaluationCategory;
  text: string;
  status: RuleEvaluationStatus;
  reason_code: RuleNotEvaluableReason | null;
  condition: RuleConditionFact | null;
  observation: RuleObservationFact;
  explanation: RuleExplanation;
}

export interface RuleEvaluationSummary {
  total_rules: number;
  evaluable_rules: number;
  followed_rules: number;
  violated_rules: number;
  not_evaluable_rules: number;
  adherence_pct: string | null;
  coverage_pct: string | null;
}

export interface RuleCategoryEvaluationSummaries {
  overall: RuleEvaluationSummary;
  entry: RuleEvaluationSummary;
  risk: RuleEvaluationSummary;
  exit: RuleEvaluationSummary;
}

export interface JournalStrategyEvaluation {
  journal_entry_id: number;
  evaluation_basis: 'CURRENT_RECONSTRUCTED';
  strategy: {
    id: number;
    name: string;
    archived_at: string | null;
  };
  strategy_version: {
    id: number;
    strategy_id: number;
    sequence: number;
    version_label: string;
    description: string | null;
    is_active: boolean;
    retired_at: string | null;
    created_at: string;
    assigned_at: string;
    assignment_updated_at: string;
  };
  summary: RuleCategoryEvaluationSummaries;
  rules: RuleEvaluationResult[];
}
