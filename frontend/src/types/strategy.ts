export interface StrategyRule {
  id: string;
  text: string;
}

export interface StrategyRuleDocument {
  schema_version: 1;
  entry_rules: StrategyRule[];
  risk_rules: StrategyRule[];
  exit_rules: StrategyRule[];
}

export interface StrategyVersionInput {
  version_label: string;
  description: string | null;
  rules: StrategyRuleDocument;
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
