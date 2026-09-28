import type { RuleEngineMetadata, StrategyRuleEvaluator } from '../../types';
import { analyticsLabel } from '../../utils/localization';
import { metricFor } from './ruleAuthoring';

// Locale copy only. Types, units and supported operators come from server metadata.
const metricKorean: Record<string, string> = {
  'trade.direction': '매매 방향', 'trade.symbol': '종목',
  'plan.recorded_before_entry': '진입 전 계획 기록 여부',
  'execution.entry_deviation_r': '계획 대비 진입 차이',
  'plan.stop_distance_pct': '손절 거리', 'plan.total_reward_risk_ratio': '전체 목표 손익비',
  'plan.max_hold_hours': '최대 보유시간',
  'journal.fomo': 'FOMO 기록 여부', 'journal.revenge_trade': '복수 매매 기록 여부',
  'execution.holding_minutes': '보유시간', 'execution.price_return_pct': '가격 수익률',
  'execution.realized_r': '실현 결과',
};

export function ruleSentence(evaluation: StrategyRuleEvaluator, metadata: RuleEngineMetadata | undefined, isKo: boolean): string {
  const metric = metadata && metricFor(metadata, evaluation.metric_id);
  if (!metric || !metric.allowed_operators.includes(evaluation.operator)) return isKo ? '조건 설명을 불러올 수 없습니다. 정확한 조건을 펼쳐 확인하세요.' : 'Condition description unavailable. Expand the exact condition to inspect it.';
  const shortId = evaluation.metric_id.replace(/^journal\./, '');
  const translated = analyticsLabel(shortId, true);
  const label = isKo ? metricKorean[evaluation.metric_id] ?? (translated !== shortId ? translated : '선택한 지표') : metric.label;
  const expected = evaluation.expected;
  const formatValue = (value: string) => metric.value_type === 'enum' && isKo ? ({ Long: '롱', Short: '숏' }[value] ?? value) : value;
  if (metric.value_type === 'boolean' && evaluation.operator === 'eq' && typeof expected === 'boolean') {
    return `${label}: ${isKo ? (expected ? '예' : '아니요') : (expected ? 'Yes' : 'No')}`;
  }
  const display = Array.isArray(expected) ? expected.map(formatValue).join(', ') : formatValue(String(expected));
  const unit = metric.value_type === 'numeric' ? ({ percent: '%', hours: isKo ? '시간' : 'hours', minutes: isKo ? '분' : 'minutes', score: isKo ? '점' : 'points' }[metric.unit ?? ''] ?? metric.unit ?? '') : '';
  const comparison = { gte: isKo ? '이상' : 'is at least', lte: isKo ? '이하' : 'is at most', eq: isKo ? '와 같음' : 'equals', in: isKo ? '중 하나' : 'is one of' }[evaluation.operator];
  return isKo ? `${label}: ${display}${unit ? ` ${unit}` : ''} ${comparison}` : `${label} ${comparison} ${display}${unit ? ` ${unit}` : ''}`;
}
