export interface StrategyRule {
  id: string;
  text: string;
}

export type StrategyRuleOperator = 'eq' | 'lte' | 'gte' | 'in';
export type StrategyRuleExpected = boolean | number | string | string[];

export interface StrategyRuleEvaluator {
  metric_id: string;
  operator: StrategyRuleOperator;
  expected: StrategyRuleExpected;
}

export interface StrategyRuleV2 extends StrategyRule {
  evaluation?: StrategyRuleEvaluator | null;
}

export interface StrategyRuleDocumentV1 {
  schema_version: 1;
  entry_rules: StrategyRule[];
  risk_rules: StrategyRule[];
  exit_rules: StrategyRule[];
}

export interface StrategyRuleDocumentV2 {
  schema_version: 2;
  entry_rules: StrategyRuleV2[];
  risk_rules: StrategyRuleV2[];
  exit_rules: StrategyRuleV2[];
}

export type StrategyRuleDocument = StrategyRuleDocumentV1 | StrategyRuleDocumentV2;

export interface StrategyVersionInput {
  version_label: string;
  description: string | null;
  rules: StrategyRuleDocumentV2;
}

export interface StrategyCreateInput {
  name: string;
  description: string | null;
  initial_version: StrategyVersionInput;
}

export interface StrategyUpdateInput {
  name?: string;
  description?: string | null;
}

export interface Strategy {
  id: number;
  name: string;
  description: string | null;
  archived_at: string | null;
  active_version_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface StrategyVersion {
  id: number;
  strategy_id: number;
  sequence: number;
  version_label: string;
  description: string | null;
  rules: StrategyRuleDocument;
  is_active: boolean;
  retired_at: string | null;
  created_at: string;
}

export type RuleMetricValueType = 'boolean' | 'numeric' | 'enum' | 'string';
export type RuleMetricLifecycle = 'ENTRY' | 'RISK' | 'REVIEW' | 'EXIT';
export type RuleMetricStringFormat = 'uppercase_alphanumeric';

export interface RuleMetricConstraints {
  enum_values: string[];
  minimum: string | null;
  maximum: string | null;
  max_in_values: number | null;
  max_string_length: number | null;
  string_format: RuleMetricStringFormat | null;
}

export interface RuleMetricMetadata {
  metric_id: string;
  label: string;
  value_type: RuleMetricValueType;
  unit: string | null;
  lifecycle: RuleMetricLifecycle;
  allowed_operators: StrategyRuleOperator[];
  constraints: RuleMetricConstraints;
}

export interface RuleEngineMetadata {
  registry_version: 1;
  metrics: RuleMetricMetadata[];
}
