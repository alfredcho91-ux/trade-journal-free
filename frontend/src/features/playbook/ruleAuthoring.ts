import type {
  RuleEngineMetadata,
  RuleMetricMetadata,
  StrategyRuleEvaluator,
  StrategyRuleExpected,
  StrategyRuleOperator,
  StrategyRuleV2,
} from '../../types';

export function metricFor(metadata: RuleEngineMetadata, metricId: string): RuleMetricMetadata | undefined {
  return metadata.metrics.find((metric) => metric.metric_id === metricId);
}

function scalarDefault(metric: RuleMetricMetadata): StrategyRuleExpected {
  if (metric.value_type === 'boolean') return false;
  if (metric.value_type === 'numeric') {
    return metric.constraints.minimum === null ? 0 : Number(metric.constraints.minimum);
  }
  if (metric.value_type === 'enum') return metric.constraints.enum_values[0] ?? '';
  return '';
}

export function expectedForOperator(
  metric: RuleMetricMetadata,
  operator: StrategyRuleOperator,
  current?: StrategyRuleExpected,
): StrategyRuleExpected {
  if (operator === 'in') {
    if (Array.isArray(current)) return [...current];
    if (typeof current === 'string' && current) return [current];
    const initial = scalarDefault(metric);
    return typeof initial === 'string' && initial ? [initial] : [];
  }
  if (Array.isArray(current)) return current[0] ?? scalarDefault(metric);
  if (current !== undefined) return current;
  return scalarDefault(metric);
}

export function defaultEvaluator(metric: RuleMetricMetadata): StrategyRuleEvaluator {
  const operator = metric.allowed_operators[0];
  return {
    metric_id: metric.metric_id,
    operator,
    expected: expectedForOperator(metric, operator),
  };
}

function listError(values: StrategyRuleExpected, metric: RuleMetricMetadata): string | null {
  if (!Array.isArray(values) || values.length === 0) return 'Select or enter at least one value.';
  if (metric.constraints.max_in_values !== null && values.length > metric.constraints.max_in_values) {
    return `Use no more than ${metric.constraints.max_in_values} values.`;
  }
  if (values.some((value) => typeof value !== 'string' || !value.trim())) {
    return 'List values must not be empty.';
  }
  return null;
}

function stringError(value: string, metric: RuleMetricMetadata): string | null {
  if (!value) return 'Expected value is required.';
  if (metric.constraints.max_string_length !== null && value.length > metric.constraints.max_string_length) {
    return `Use no more than ${metric.constraints.max_string_length} characters.`;
  }
  if (
    metric.constraints.string_format === 'uppercase_alphanumeric'
    && (!/^[A-Z0-9]+$/.test(value) || value !== value.toUpperCase())
  ) {
    return 'Use uppercase letters and numbers only.';
  }
  return null;
}

export function evaluatorError(rule: StrategyRuleV2, metadata: RuleEngineMetadata): string | null {
  const evaluator = rule.evaluation;
  if (!evaluator) return null;
  const metric = metricFor(metadata, evaluator.metric_id);
  if (!metric) return 'Select an available metric.';
  if (!metric.allowed_operators.includes(evaluator.operator)) return 'Select an allowed operator.';

  if (metric.value_type === 'boolean') {
    return typeof evaluator.expected === 'boolean' ? null : 'Select true or false.';
  }

  if (metric.value_type === 'numeric') {
    if (Array.isArray(evaluator.expected) || typeof evaluator.expected === 'boolean' || evaluator.expected === '') {
      return 'Enter a valid number.';
    }
    const value = Number(evaluator.expected);
    if (!Number.isFinite(value)) return 'Enter a valid number.';
    if (metric.constraints.minimum !== null && value < Number(metric.constraints.minimum)) {
      return `Value must be at least ${metric.constraints.minimum}.`;
    }
    if (metric.constraints.maximum !== null && value > Number(metric.constraints.maximum)) {
      return `Value must be at most ${metric.constraints.maximum}.`;
    }
    return null;
  }

  if (metric.value_type === 'enum') {
    if (evaluator.operator === 'in') {
      const invalidList = listError(evaluator.expected, metric);
      if (invalidList) return invalidList;
      return (evaluator.expected as string[]).every((value) => metric.constraints.enum_values.includes(value))
        ? null
        : 'Select values from the available options.';
    }
    return typeof evaluator.expected === 'string' && metric.constraints.enum_values.includes(evaluator.expected)
      ? null
      : 'Select an available value.';
  }

  if (evaluator.operator === 'in') {
    const invalidList = listError(evaluator.expected, metric);
    if (invalidList) return invalidList;
    for (const value of evaluator.expected as string[]) {
      const invalidString = stringError(value, metric);
      if (invalidString) return invalidString;
    }
    return null;
  }
  return typeof evaluator.expected === 'string'
    ? stringError(evaluator.expected.trim(), metric)
    : 'Expected value is required.';
}

export function rulesAreValid(rules: StrategyRuleV2[], metadata: RuleEngineMetadata): boolean {
  return rules.every((rule) => rule.text.trim().length > 0 && evaluatorError(rule, metadata) === null);
}

export function evaluatorForPayload(
  evaluator: StrategyRuleEvaluator,
  metadata: RuleEngineMetadata,
): StrategyRuleEvaluator {
  const metric = metricFor(metadata, evaluator.metric_id);
  if (!metric) return evaluator;
  let expected = evaluator.expected;
  if (metric.value_type === 'numeric') expected = Number(expected);
  if (metric.value_type === 'string') {
    expected = Array.isArray(expected)
      ? expected.map((value) => value.trim())
      : String(expected).trim();
  }
  return { metric_id: evaluator.metric_id, operator: evaluator.operator, expected };
}
