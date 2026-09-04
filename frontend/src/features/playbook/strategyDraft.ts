import type { StrategyRuleDocument, StrategyRuleDocumentV2, StrategyRuleV2, StrategyVersion } from '../../types';

export type RuleGroup = 'entry_rules' | 'risk_rules' | 'exit_rules';

export function emptyRules(): StrategyRuleDocumentV2 {
  return { schema_version: 2, entry_rules: [], risk_rules: [], exit_rules: [] };
}

function cloneRule(rule: StrategyRuleV2): StrategyRuleV2 {
  if (!rule.evaluation) return { id: rule.id, text: rule.text };
  return {
    id: rule.id,
    text: rule.text,
    evaluation: {
      metric_id: rule.evaluation.metric_id,
      operator: rule.evaluation.operator,
      expected: Array.isArray(rule.evaluation.expected)
        ? [...rule.evaluation.expected]
        : rule.evaluation.expected,
    },
  };
}

export function cloneRules(rules: StrategyRuleDocument): StrategyRuleDocumentV2 {
  return {
    schema_version: 2,
    entry_rules: rules.entry_rules.map((rule) => cloneRule(rule)),
    risk_rules: rules.risk_rules.map((rule) => cloneRule(rule)),
    exit_rules: rules.exit_rules.map((rule) => cloneRule(rule)),
  };
}

export function versionDraftFrom(source?: StrategyVersion) {
  return {
    version_label: '',
    description: source?.description ?? '',
    rules: source ? cloneRules(source.rules) : emptyRules(),
  };
}

export function newRule(group: RuleGroup, existingRules: StrategyRuleV2[]): StrategyRuleV2 {
  const prefix = group.replace('_rules', '');
  let candidate = '';
  do {
    candidate = `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
  } while (existingRules.some((rule) => rule.id === candidate));
  return { id: candidate, text: '' };
}

export function normalizedDescription(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
