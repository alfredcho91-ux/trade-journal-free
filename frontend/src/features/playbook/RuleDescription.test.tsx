// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import type { RuleEngineMetadata, RuleMetricMetadata, StrategyRuleV2 } from '../../types';
import RuleDescription from './RuleDescription';
import { ruleSentence } from './rulePresentation';

afterEach(cleanup);
const constraints = { enum_values: [], minimum: null, maximum: null, max_in_values: null, max_string_length: null, string_format: null };
const metric: RuleMetricMetadata = { metric_id: 'journal.confidence_score', label: 'Confidence score', value_type: 'numeric', unit: 'score', lifecycle: 'REVIEW', allowed_operators: ['gte', 'lte'], constraints };
const metadata: RuleEngineMetadata = { registry_version: 1, metrics: [metric] };
const rule: StrategyRuleV2 = { id: 'exact-rule-id', text: 'My written rule', evaluation: { metric_id: metric.metric_id, operator: 'gte', expected: 3 } };

it.each([false, true])('shows a localized sentence and exact immutable configuration on disclosure, locale %s', async isKo => {
  const snapshot = structuredClone(rule);
  render(<RuleDescription rule={rule} metadata={metadata} isKo={isKo} />);
  expect(screen.getByText(isKo ? '확신 점수: 3 점 이상' : 'Confidence score is at least 3 points')).toBeTruthy();
  expect(screen.getByText(isKo ? /기록이 부족하면 판정 불가/ : /missing evidence is not evaluable, not a violation/)).toBeTruthy();
  const raw = screen.getByText(/"metric_id": "journal.confidence_score"/);
  expect(raw.closest('details')?.open).toBe(false);
  await userEvent.click(screen.getByText(isKo ? '정확한 규칙 정의' : 'Exact rule definition'));
  expect(raw.closest('details')?.open).toBe(true); expect(JSON.parse(raw.textContent!)).toEqual(snapshot); expect(rule).toEqual(snapshot);
});

it.each([false, true])('keeps text-only rules non-automatic, locale %s', isKo => {
  render(<RuleDescription rule={{ id: 'legacy', text: 'Review my own setup' }} metadata={metadata} isKo={isKo} />);
  expect(screen.getByText(isKo ? '기록용 규칙 · 자동으로 판정하지 않습니다.' : 'Text-only rule · not automatically evaluated.')).toBeTruthy();
});

it.each([
  ['plan.stop_distance_pct', 'Stop distance', 'numeric', 'percent', 'lte', 2, 'Stop distance is at most 2 %', '손절 거리: 2 % 이하'],
  ['journal.fomo', 'FOMO recorded', 'boolean', null, 'eq', false, 'FOMO recorded: No', 'FOMO 기록 여부: 아니요'],
  ['plan.recorded_before_entry', 'Plan recorded before entry', 'boolean', null, 'eq', true, 'Plan recorded before entry: Yes', '진입 전 계획 기록 여부: 예'],
  ['trade.direction', 'Trade direction', 'enum', null, 'in', ['Long', 'Short'], 'Trade direction is one of Long, Short', '매매 방향: 롱, 숏 중 하나'],
  ['trade.symbol', 'Trade symbol', 'string', null, 'eq', 'BTCUSDT', 'Trade symbol equals BTCUSDT', '종목: BTCUSDT 와 같음'],
] as const)('formats metadata for %s without changing evaluator', (id, label, type, unit, operator, expected, en, ko) => {
  const evaluation = { metric_id: id, operator, expected: Array.isArray(expected) ? [...expected] : expected } as NonNullable<StrategyRuleV2['evaluation']>;
  const source = { registry_version: 1 as const, metrics: [{ ...metric, metric_id: id, label, value_type: type, unit, allowed_operators: [operator] }] };
  const snapshot = structuredClone(evaluation);
  expect(ruleSentence(evaluation, source, false)).toBe(en); expect(ruleSentence(evaluation, source, true)).toBe(ko); expect(evaluation).toEqual(snapshot);
});

it('does not invent an explanation or evaluation when metadata is unavailable', () => {
  render(<RuleDescription rule={rule} isKo={false} />);
  expect(screen.getByText(/Condition description unavailable/)).toBeTruthy();
  expect(screen.queryByText('VIOLATED')).toBeNull();
  expect(screen.queryByText('FOLLOWED')).toBeNull();
});
