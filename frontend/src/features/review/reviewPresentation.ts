import type { AnalyticsGroup } from '../../types/analytics';
import type { Classification, Diagnosis, Pattern, TradingReview } from '../../types/review';
import { textFor } from '../../utils/localization';

export type Finding = { kind: 'diagnosis'; item: Diagnosis } | { kind: 'pattern'; item: Pattern };

export function reviewMetricLabel(id: string, isKo: boolean): string {
  const labels: Record<string, [string, string]> = {
    average_r: ['Average recorded R', '평균 기록 R'],
    net_return_pct: ['Net return on margin', '투입 증거금 대비 순수익률'],
    adherence_pct: ['Global rule adherence', '전체 규칙 준수율'],
  };
  return labels[id]?.[isKo ? 1 : 0] ?? textFor(isKo, '기록된 비교', 'Recorded comparison');
}

/** Presentation only: flagged diagnoses, eligible nonzero comparisons, then healthy
 * diagnoses. Preserve server order inside each bucket (including its per-metric
 * pattern ordering). Never compare magnitudes across units or infer a diagnosis.
 * Inconclusive/insufficient/zero-delta results remain in the full review.
 */
export function primaryFindings(data: TradingReview): Finding[] {
  if (data.state === 'EMPTY_PERIOD') return [];
  const diagnoses = data.strategy_execution.diagnoses;
  const wrap = (item: Diagnosis): Finding => ({ kind: 'diagnosis', item });
  return [
    ...diagnoses.filter(d => d.classification !== 'INCONCLUSIVE' && d.classification !== 'STRATEGY_POSITIVE_EXECUTION_HEALTHY').map(wrap),
    ...data.patterns.candidates.filter(p => p.status === 'ELIGIBLE' && p.signed_delta !== null && /[1-9]/.test(p.signed_delta.split(/[eE]/)[0])).map((item): Finding => ({ kind: 'pattern', item })),
    ...diagnoses.filter(d => d.classification === 'STRATEGY_POSITIVE_EXECUTION_HEALTHY').map(wrap),
  ].slice(0, 3);
}

const diagnosisCopy: Record<Classification, [string, string, string, string, string, string]> = {
  STRATEGY_WEAK_EXECUTION_HEALTHY: ['Strategy', '전략', 'Weak results alongside healthy execution', '실행은 양호하지만 결과는 약했습니다', 'Within this sample, average R and net return were both negative while execution rules and entry alignment met the review policy. Review the strategy outcomes separately from execution.', '이 표본에서 평균 R과 순수익률은 모두 음수였지만 실행 규칙과 진입 정렬은 복기 기준을 충족했습니다. 전략 결과와 실행 근거를 나누어 살펴보세요.'],
  STRATEGY_POSITIVE_EXECUTION_DRAG: ['Execution', '실행', 'Positive results alongside execution drag', '결과는 긍정적이지만 실행 저하가 있었습니다', 'Within this sample, positive average R and net return coexisted with lower execution-rule adherence and entry alignment. Positive outcomes alone do not describe the execution process.', '이 표본에서 평균 R과 순수익률은 양수였지만 실행 규칙 준수와 진입 정렬은 기준보다 낮았습니다. 긍정적인 결과만으로 실행 과정을 설명할 수는 없습니다.'],
  STRATEGY_WEAK_EXECUTION_DRAG: ['Strategy & Execution', '전략 및 실행', 'Weak results alongside execution drag', '약한 결과와 실행 저하가 함께 나타났습니다', 'Within this sample, strategy outcomes and execution signals were both weak. This does not establish which contributed to the results; inspect both sets of evidence.', '이 표본에서 전략 결과와 실행 신호가 모두 약했습니다. 무엇이 결과에 영향을 주었는지는 확정할 수 없으므로 두 근거를 함께 살펴보세요.'],
  STRATEGY_POSITIVE_EXECUTION_HEALTHY: ['Strategy & Execution', '전략 및 실행', 'Positive results alongside healthy execution', '긍정적인 결과와 양호한 실행이 함께 나타났습니다', 'Within this sample, average R and net return were positive and execution signals met the review policy. This is a historical observation, not a prediction of future results.', '이 표본에서 평균 R과 순수익률은 양수였고 실행 신호는 복기 기준을 충족했습니다. 이는 과거 관찰이며 미래 결과를 예측하지 않습니다.'],
  INCONCLUSIVE: ['Unclear', '판단 보류', 'Strategy and Execution cannot be separated yet', '아직 전략과 실행을 구분해 판단할 수 없습니다', 'There is not enough consistent evidence to make a Strategy or Execution judgment. Missing evidence is not a rule violation.', '전략 또는 실행을 판단할 만큼 일관된 근거가 없습니다. 근거 누락은 규칙 위반을 뜻하지 않습니다.'],
};
export function diagnosisText(classification: Classification, isKo: boolean) {
  const copy = diagnosisCopy[classification];
  return { category: copy[isKo ? 1 : 0], title: copy[isKo ? 3 : 2], why: copy[isKo ? 5 : 4] };
}

export function groupLabel(identity: AnalyticsGroup['identity'], isKo: boolean): string {
  const label = identity.label.replace(/^value:/, '');
  const states: Record<string, [string, string]> = {
    TRUE: ['Recorded yes', '예로 기록됨'], FALSE: ['Recorded no', '아니오로 기록됨'],
    UNASSIGNED: ['No strategy assigned', '전략 미지정'], UNRECORDED: ['Not recorded', '미기록'],
    INVALID: ['Invalid recorded value', '유효하지 않은 기록값'], NO_RULES: ['No assigned rules', '배정된 규칙 없음'],
    FOLLOWED: ['Rules followed', '규칙 준수'], VIOLATED: ['Rules violated', '규칙 위반'],
    NOT_EVALUABLE: ['Cannot be evaluated', '판정 불가'],
  };
  const translated = states[label];
  return translated ? translated[isKo ? 1 : 0] : label;
}

/** Bounded, factual coverage explanations; no new evidence thresholds. */
export function evidenceLimits(data: TradingReview, isKo: boolean): string[] {
  const quality = data.evidence_quality;
  if (!quality.selected_trade_count) return [];
  const reasons = [...data.strategy_execution.diagnoses.flatMap(d => d.reasons), ...data.patterns.candidates.flatMap(p => p.reasons)];
  const limits: string[] = [];
  if (quality.selected_trade_count < data.metadata.policy.minimum_trade_sample || reasons.some(r => r.includes('SMALL_SAMPLE') || r.includes('INSUFFICIENT_EVALUABLE_TRADES'))) {
    limits.push(textFor(isKo, `일부 비교는 표본이 작습니다. 신중히 해석하세요. 복기 기준은 판정 가능한 거래 최소 ${data.metadata.policy.minimum_trade_sample}건입니다.`, `Some comparisons have a small sample — interpret cautiously. The review requires at least ${data.metadata.policy.minimum_trade_sample} evaluable trades.`));
  }
  if (quality.unassigned_trade_count) limits.push(textFor(isKo, `${quality.unassigned_trade_count}건은 전략 버전이 미지정되어 전략별 진단이 제한됩니다.`, `${quality.unassigned_trade_count} trades have no Strategy Version assignment, limiting strategy diagnosis.`));
  if (quality.assigned_without_rules_count) limits.push(textFor(isKo, `${quality.assigned_without_rules_count}건은 배정된 버전에 규칙이 없습니다.`, `${quality.assigned_without_rules_count} trades are assigned to versions without rules.`));
  if (reasons.some(r => r.includes('RULE') && !r.startsWith('OBSERVED'))) limits.push(textFor(isKo, '일부 진단은 판정 가능한 실행 규칙 근거가 부족합니다. 판정 불가는 위반이 아닙니다.', 'Some diagnoses lack evaluable execution-rule evidence. Cannot be evaluated does not mean violated.'));
  if (reasons.some(r => r.includes('PLAN_ENTRY'))) limits.push(textFor(isKo, '일부 진단은 연결된 계획과 진입 가격의 비교 근거가 더 필요합니다.', 'Some diagnoses need more evidence comparing linked plans with actual entries.'));
  if (reasons.some(r => r.includes('SIGNALS_CONFLICT'))) limits.push(textFor(isKo, '일부 전략 또는 실행 신호가 서로 다르거나 중립이어서 판단을 보류했습니다.', 'Some strategy or execution signals disagree or are neutral, so the diagnosis remains unclear.'));
  if (reasons.some(r => r.includes('METRIC_UNAVAILABLE') || r.includes('LOW_AVAILABILITY'))) limits.push(textFor(isKo, '일부 비교는 지표값이 없거나 근거 커버리지가 부족합니다. 이는 효과가 없다는 뜻이 아닙니다.', 'Some comparisons have unavailable metrics or limited evidence coverage. This does not mean there is no effect.'));
  const missingPsychology = quality.observations.filter(o => o.metric.startsWith('journal.') && o.unavailable_sample > 0);
  if (missingPsychology.length) limits.push(textFor(isKo, '일부 심리 기록이 없거나 유효하지 않아 관련 비교가 제한됩니다. 살펴볼 항목만 기록해도 됩니다.', 'Missing or invalid psychology records limit those comparisons. Record only the fields you want to investigate.'));
  return limits;
}
