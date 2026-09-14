import type { AnalyticsMetadata } from '../../types/analytics';

interface GuidedQuestion {
  id: string;
  title: [string, string];
  description: [string, string];
  metric: string;
  dimension: string;
}

// Explicit product questions; availability still comes from the server registry.
const questions: GuidedQuestion[] = [
  { id: 'strategy', title: ['전략마다 결과가 어떻게 달랐나요?', 'How did results differ across strategies?'], description: ['거래에 연결한 전략별 평균 순수익률을 비교합니다.', 'Compare average net returns by assigned strategy.'], metric: 'average_return_pct', dimension: 'strategy' },
  { id: 'setup', title: ['어떤 진입 유형에서 결과가 달랐나요?', 'How did results differ across setups?'], description: ['저널에 기록한 진입 유형별 평균 순수익률을 봅니다.', 'Compare average net returns by recorded setup tag.'], metric: 'average_return_pct', dimension: 'setup' },
  { id: 'psychology', title: ['자신감에 따라 결과가 달랐나요?', 'Did results differ with my confidence?'], description: ['기록한 확신 점수별 결과를 비교합니다. 원인 분석은 아닙니다.', 'Compare results by recorded confidence score, without inferring cause.'], metric: 'average_return_pct', dimension: 'confidence_score' },
  { id: 'direction', title: ['롱과 숏의 결과는 어떻게 달랐나요?', 'How did Long and Short trades differ?'], description: ['매수·매도 방향별 평균 순수익률을 비교합니다.', 'Compare average net returns by recorded Long or Short direction.'], metric: 'average_return_pct', dimension: 'direction' },
  { id: 'symbol', title: ['종목마다 결과가 어떻게 달랐나요?', 'How did results differ across symbols?'], description: ['저장된 종목별 평균 순수익률과 거래 수를 봅니다.', 'Compare average net returns and trade counts by stored symbol.'], metric: 'average_return_pct', dimension: 'symbol' },
  { id: 'recent', title: ['최근 거래 결과가 달라졌나요?', 'How have my weekly results changed?'], description: ['거래가 종료된 주차별 결과를 봅니다. 시간 기준은 UTC입니다.', 'Compare results by closing week in UTC.'], metric: 'average_return_pct', dimension: 'week' },
  { id: 'weekday', title: ['요일마다 거래 결과가 달랐나요?', 'Did results differ by closing weekday?'], description: ['진입일이 아닌 종료 요일별 결과를 비교합니다. 시간 기준은 UTC입니다.', 'Compare results by closing weekday, not entry weekday, in UTC.'], metric: 'average_return_pct', dimension: 'weekday' },
  { id: 'rules', title: ['전략별로 규칙을 얼마나 지켰나요?', 'How consistently did I follow each strategy’s rules?'], description: ['판정 가능한 규칙의 준수율을 비교합니다. 판정 불가는 위반이 아닙니다.', 'Compare adherence among evaluable rules. Unknown is not a violation.'], metric: 'adherence_pct', dimension: 'strategy' },
];

export function guidedQuestions(metadata: AnalyticsMetadata): GuidedQuestion[] {
  return questions.filter(q => metadata.metrics.some(m => m.id === q.metric && m.supported_dimensions.includes(q.dimension))
    && metadata.dimensions.some(d => d.id === q.dimension));
}

export const guidedMetricNames: Record<string, [string, string]> = {
  average_return_pct: ['평균 순수익률', 'Average net return'],
  average_r: ['기록된 평균 실현 R', 'Average recorded realized R'],
  win_rate_pct: ['승률', 'Win rate'],
  adherence_pct: ['규칙 준수율', 'Rule adherence'],
  coverage_pct: ['규칙 판정 범위', 'Rule evaluation coverage'],
};
