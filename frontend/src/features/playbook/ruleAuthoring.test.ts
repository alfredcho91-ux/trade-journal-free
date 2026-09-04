import { describe, expect, it } from 'vitest';

import type { RuleEngineMetadata, RuleMetricMetadata, StrategyRuleOperator, StrategyRuleV2 } from '../../types';
import { defaultEvaluator, evaluatorError, evaluatorForPayload, expectedForOperator } from './ruleAuthoring';

const blankConstraints = {
  enum_values: [], minimum: null, maximum: null, max_in_values: null,
  max_string_length: null, string_format: null,
};

function metric(overrides: Partial<RuleMetricMetadata>): RuleMetricMetadata {
  return {
    metric_id: 'test.metric', label: 'Test metric', value_type: 'boolean', unit: null,
    lifecycle: 'ENTRY', allowed_operators: ['eq'], constraints: blankConstraints,
    ...overrides,
  };
}

function metadata(definition: RuleMetricMetadata): RuleEngineMetadata {
  return { registry_version: 1, metrics: [definition] };
}

function rule(metricId: string, operator: StrategyRuleOperator, expected: boolean | number | string | string[]): StrategyRuleV2 {
  return { id: 'stable-id', text: 'Descriptive rule', evaluation: { metric_id: metricId, operator, expected } };
}

describe('metadata-driven rule authoring validation', () => {
  it('uses metadata order and operators for defaults without a frontend metric map', () => {
    const definition = metric({ metric_id: 'backend.only', allowed_operators: ['gte', 'lte'], value_type: 'numeric' });
    expect(defaultEvaluator(definition)).toEqual({ metric_id: 'backend.only', operator: 'gte', expected: 0 });
  });

  it('validates boolean expected values from the public value type', () => {
    const source = metadata(metric({ metric_id: 'bool' }));
    expect(evaluatorError(rule('bool', 'eq', false), source)).toBeNull();
    expect(evaluatorError(rule('bool', 'eq', 'false'), source)).toContain('true or false');
  });

  it('honors numeric min/max and allowed operators from metadata', () => {
    const definition = metric({
      metric_id: 'score', value_type: 'numeric', allowed_operators: ['lte', 'gte'],
      constraints: { ...blankConstraints, minimum: '1', maximum: '5' },
    });
    const source = metadata(definition);
    expect(evaluatorError(rule('score', 'gte', 1), source)).toBeNull();
    expect(evaluatorError(rule('score', 'gte', 0), source)).toContain('at least 1');
    expect(evaluatorError(rule('score', 'lte', 6), source)).toContain('at most 5');
    expect(evaluatorError(rule('score', 'eq', 3), source)).toContain('allowed operator');
  });

  it('supports enum eq/in membership, non-empty lists, and list bounds', () => {
    const definition = metric({
      metric_id: 'direction', value_type: 'enum', allowed_operators: ['eq', 'in'],
      constraints: { ...blankConstraints, enum_values: ['Long', 'Short'], max_in_values: 2 },
    });
    const source = metadata(definition);
    expect(evaluatorError(rule('direction', 'eq', 'Long'), source)).toBeNull();
    expect(evaluatorError(rule('direction', 'in', ['Long', 'Short']), source)).toBeNull();
    expect(evaluatorError(rule('direction', 'in', []), source)).toContain('at least one');
    expect(evaluatorError(rule('direction', 'in', ['Long', 'Short', 'Flat']), source)).toContain('no more than 2');
    expect(evaluatorError(rule('direction', 'eq', 'Flat'), source)).toContain('available value');
  });

  it('supports string eq/in length, format, empty, and list constraints', () => {
    const definition = metric({
      metric_id: 'symbol', value_type: 'string', allowed_operators: ['eq', 'in'],
      constraints: { ...blankConstraints, max_in_values: 2, max_string_length: 8, string_format: 'uppercase_alphanumeric' },
    });
    const source = metadata(definition);
    expect(evaluatorError(rule('symbol', 'eq', 'BTCUSDT'), source)).toBeNull();
    expect(evaluatorError(rule('symbol', 'eq', 'btc/usdt'), source)).toContain('uppercase');
    expect(evaluatorError(rule('symbol', 'eq', 'ABCDEFGHI'), source)).toContain('8 characters');
    expect(evaluatorError(rule('symbol', 'in', ['BTCUSDT', 'ETHUSDT']), source)).toBeNull();
    expect(evaluatorError(rule('symbol', 'in', []), source)).toContain('at least one');
  });

  it('changes expected shape when metadata changes the operator and normalizes payload values', () => {
    const definition = metric({
      metric_id: 'symbol', value_type: 'string', allowed_operators: ['eq', 'in'],
      constraints: { ...blankConstraints, max_in_values: 2, max_string_length: 8 },
    });
    expect(expectedForOperator(definition, 'in', 'BTC')).toEqual(['BTC']);
    expect(expectedForOperator(definition, 'eq', ['BTC', 'ETH'])).toBe('BTC');
    expect(evaluatorForPayload({ metric_id: 'symbol', operator: 'in', expected: [' BTC ', ' ETH '] }, metadata(definition)).expected).toEqual(['BTC', 'ETH']);
  });
});
