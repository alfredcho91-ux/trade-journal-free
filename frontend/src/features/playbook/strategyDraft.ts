import type { StrategyRule, StrategyRuleDocument, StrategyRuleDocumentV1, StrategyVersion } from '../../types';

export type RuleGroup = 'entry_rules' | 'risk_rules' | 'exit_rules';

export function emptyRules(): StrategyRuleDocumentV1 {
  return { schema_version: 1, entry_rules: [], risk_rules: [], exit_rules: [] };
}

export function canCloneVersion(version: StrategyVersion): version is StrategyVersion & { rules: StrategyRuleDocumentV1 } {
  return version.rules.schema_version === 1;
}

export function cloneRules(rules: StrategyRuleDocument): StrategyRuleDocumentV1 {
  if (rules.schema_version !== 1) throw new Error('Rule Engine versions cannot be cloned in this editor yet.');
  return {
    schema_version: 1,
    entry_rules: rules.entry_rules.map((rule) => ({ ...rule })),
    risk_rules: rules.risk_rules.map((rule) => ({ ...rule })),
    exit_rules: rules.exit_rules.map((rule) => ({ ...rule })),
  };
}

export function versionDraftFrom(source?: StrategyVersion) {
  if (source && !canCloneVersion(source)) throw new Error('Rule Engine versions cannot be cloned in this editor yet.');
  return {
    version_label: '',
    description: source?.description ?? '',
    rules: source ? cloneRules(source.rules) : emptyRules(),
  };
}

export function newRule(group: RuleGroup, existingRules: StrategyRule[]): StrategyRule {
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
