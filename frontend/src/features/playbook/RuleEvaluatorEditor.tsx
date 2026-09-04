import type {
  RuleEngineMetadata,
  RuleMetricMetadata,
  StrategyRuleExpected,
  StrategyRuleV2,
} from '../../types';
import {
  defaultEvaluator,
  evaluatorError,
  expectedForOperator,
  metricFor,
} from './ruleAuthoring';

const compactInput = 'w-full border border-dark-600 bg-dark-900 px-2 py-1.5 text-[11px] text-white outline-none focus:border-primary-400 disabled:cursor-not-allowed disabled:opacity-60';

function expectedText(expected: StrategyRuleExpected): string {
  return Array.isArray(expected) ? expected.join(', ') : String(expected);
}

function ExpectedEditor({ metric, rule, label, onChange }: {
  metric: RuleMetricMetadata;
  rule: StrategyRuleV2;
  label: string;
  onChange: (rule: StrategyRuleV2) => void;
}) {
  const evaluator = rule.evaluation!;
  const updateExpected = (expected: StrategyRuleExpected) => onChange({
    ...rule,
    evaluation: { ...evaluator, expected },
  });

  if (metric.value_type === 'boolean') {
    return <label className="text-[10px] text-dark-400">Expected Value
      <select aria-label={`${label} expected value`} value={String(evaluator.expected)} onChange={(event) => updateExpected(event.target.value === 'true')} className={`mt-1 ${compactInput}`}>
        <option value="true">true</option><option value="false">false</option>
      </select>
    </label>;
  }

  if (metric.value_type === 'numeric') {
    return <label className="text-[10px] text-dark-400">Expected Value
      <div className="mt-1 flex items-center gap-1.5">
        <input
          aria-label={`${label} expected value`}
          type="number"
          value={Array.isArray(evaluator.expected) ? '' : String(evaluator.expected)}
          min={metric.constraints.minimum ?? undefined}
          max={metric.constraints.maximum ?? undefined}
          onChange={(event) => updateExpected(event.target.value)}
          className={compactInput}
        />
        {metric.unit && <span className="shrink-0 font-mono text-[10px] text-dark-500">{metric.unit}</span>}
      </div>
    </label>;
  }

  if (metric.value_type === 'enum' && evaluator.operator === 'in') {
    const selected = Array.isArray(evaluator.expected) ? evaluator.expected : [];
    return <fieldset className="text-[10px] text-dark-400">
      <legend>Expected Values</legend>
      <div className="mt-1 flex min-h-8 flex-wrap gap-2 border border-dark-600 bg-dark-900 px-2 py-1.5">
        {metric.constraints.enum_values.map((value) => <label key={value} className="flex items-center gap-1 text-[11px] text-dark-200">
          <input
            aria-label={`${label} expected ${value}`}
            type="checkbox"
            checked={selected.includes(value)}
            onChange={(event) => updateExpected(event.target.checked ? [...selected, value] : selected.filter((item) => item !== value))}
          />{value}
        </label>)}
      </div>
    </fieldset>;
  }

  if (metric.value_type === 'enum') {
    return <label className="text-[10px] text-dark-400">Expected Value
      <select aria-label={`${label} expected value`} value={Array.isArray(evaluator.expected) ? '' : String(evaluator.expected)} onChange={(event) => updateExpected(event.target.value)} className={`mt-1 ${compactInput}`}>
        {metric.constraints.enum_values.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
    </label>;
  }

  if (evaluator.operator === 'in') {
    return <label className="text-[10px] text-dark-400">Expected Values
      <input
        aria-label={`${label} expected values`}
        value={expectedText(evaluator.expected)}
        onChange={(event) => updateExpected(event.target.value.split(',').map((value) => value.trim()))}
        className={`mt-1 ${compactInput}`}
        placeholder="BTCUSDT, ETHUSDT"
      />
      <span className="mt-1 block text-[9px] text-dark-600">Comma-separated · max {metric.constraints.max_in_values ?? '—'}</span>
    </label>;
  }

  return <label className="text-[10px] text-dark-400">Expected Value
    <input
      aria-label={`${label} expected value`}
      value={Array.isArray(evaluator.expected) ? '' : String(evaluator.expected)}
      maxLength={metric.constraints.max_string_length ?? undefined}
      onChange={(event) => updateExpected(event.target.value)}
      className={`mt-1 ${compactInput}`}
      placeholder={metric.constraints.string_format === 'uppercase_alphanumeric' ? 'BTCUSDT' : undefined}
    />
  </label>;
}

export default function RuleEvaluatorEditor({ rule, label, metadata, metadataLoading, metadataError, onChange }: {
  rule: StrategyRuleV2;
  label: string;
  metadata?: RuleEngineMetadata;
  metadataLoading: boolean;
  metadataError: string | null;
  onChange: (rule: StrategyRuleV2) => void;
}) {
  const evaluator = rule.evaluation;
  const metric = evaluator && metadata ? metricFor(metadata, evaluator.metric_id) : undefined;
  const disabled = !metadata || metadataLoading || Boolean(metadataError);
  const toggle = (enabled: boolean) => {
    if (!enabled) {
      onChange({ id: rule.id, text: rule.text });
      return;
    }
    const firstMetric = metadata?.metrics[0];
    if (firstMetric) onChange({ ...rule, evaluation: defaultEvaluator(firstMetric) });
  };

  return <div className="mt-2 border-l border-dark-700 pl-2">
    <label className="flex items-center gap-2 text-[10px] text-dark-300">
      <input
        type="checkbox"
        aria-label={`${label} evaluate automatically`}
        checked={Boolean(evaluator)}
        disabled={disabled}
        onChange={(event) => toggle(event.target.checked)}
      />
      Evaluate automatically
    </label>
    {evaluator && !metadata && <div className="mt-2 border border-dark-700 bg-dark-900/70 p-2 text-[10px] text-dark-400">
      Preserved evaluator: <span className="font-mono text-dark-200">{evaluator.metric_id} · {evaluator.operator} · {expectedText(evaluator.expected)}</span>
    </div>}
    {evaluator && metadata && <div className="mt-2 grid grid-cols-3 gap-2">
      <label className="text-[10px] text-dark-400">Metric
        <select
          aria-label={`${label} metric`}
          value={evaluator.metric_id}
          disabled={disabled}
          onChange={(event) => {
            const nextMetric = metricFor(metadata, event.target.value);
            if (nextMetric) onChange({ ...rule, evaluation: defaultEvaluator(nextMetric) });
          }}
          className={`mt-1 ${compactInput}`}
        >{metadata.metrics.map((item) => <option key={item.metric_id} value={item.metric_id}>{item.label}</option>)}</select>
      </label>
      <label className="text-[10px] text-dark-400">Operator
        <select
          aria-label={`${label} operator`}
          value={evaluator.operator}
          disabled={disabled || !metric}
          onChange={(event) => {
            if (!metric) return;
            const operator = event.target.value as typeof evaluator.operator;
            onChange({ ...rule, evaluation: { ...evaluator, operator, expected: expectedForOperator(metric, operator, evaluator.expected) } });
          }}
          className={`mt-1 ${compactInput}`}
        >{metric?.allowed_operators.map((operator) => <option key={operator} value={operator}>{operator}</option>)}</select>
      </label>
      {metric && <ExpectedEditor metric={metric} rule={rule} label={label} onChange={onChange} />}
    </div>}
    {evaluator && metadata && evaluatorError(rule, metadata) && <p role="alert" className="mt-1 text-[10px] text-bear">{evaluatorError(rule, metadata)}</p>}
  </div>;
}
