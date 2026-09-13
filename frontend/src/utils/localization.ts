/**
 * Small presentation-only locale helpers for text that is shared between
 * analytics surfaces. API identifiers and persisted values remain unchanged.
 */
export function textFor(isKo: boolean, ko: string, en: string): string {
  return isKo ? ko : en;
}

const analyticsLabels: Record<string, string> = {
  'Trade Analysis': '매매 분석',
  'Analytics Workspace': '분석 워크스페이스',
  'Edge Explorer': '엣지 탐색',
  Overview: '개요',
  Strategy: '전략',
  Psychology: '심리',
  Rules: '규칙',
  Time: '시간',
  Review: '복기',
  Experiments: '실험',
  Metric: '지표',
  Dimension: '분석 기준',
  Group: '그룹',
  Value: '값',
  'Total sample': '전체 표본',
  Evaluable: '판정 가능',
  Unavailable: '판정 불가',
  'Evidence context': '근거 맥락',
  'Start time': '시작 시각',
  'End time': '종료 시각',
  'Strategy version': '전략 버전',
  'Rule status': '규칙 상태',
  'Market regime': '시장 국면',
  'Setup tag': '설정 태그',
  'Mistake tag': '실수 태그',
  Symbol: '종목',
  Direction: '방향',
  'Net return': '순수익률',
  'Average R': '평균 R',
  'Trade count': '거래 수',
  'Win rate': '승률',
  'Profit factor': '손익비',
  'Global adherence': '전체 준수율',
  'Close day': '종료 일자',
  'Close week': '종료 주차',
  'Close month': '종료 월',
  'Close weekday': '종료 요일',
  'Close hour': '종료 시간',
  all: '전체',
  strategy: '전략',
  strategy_version: '전략 버전',
  confidence_score: '확신 점수',
  focus_score: '집중도 점수',
  fomo: 'FOMO',
  revenge_trade: '복수 매매',
};

/** Localizes known metadata labels without changing their server-owned IDs. */
export function analyticsLabel(value: string, isKo: boolean): string {
  return isKo ? analyticsLabels[value] ?? value : value;
}

const analyticsFilterHelp: Record<string, string> = {
  start_time: '포함 범위의 UTC 종료 시각을 Unix 밀리초로 입력합니다. 필수 항목입니다.',
  end_time: '포함 범위의 UTC 종료 시각을 Unix 밀리초로 입력합니다. 필수 항목입니다.',
  strategy_ids: '정확한 전략 ID입니다. 보관된 전략도 지정할 수 있습니다.',
  strategy_version_ids: '정확한 과거 전략 버전 ID입니다.',
  assignment: '전체, 배정됨 또는 미지정 거래를 포함합니다.',
  symbols: '저장된 저널 종목을 정확히 지정합니다.',
  directions: '기록된 롱 또는 숏 방향입니다.',
  setups: '기록된 설정 태그를 정확히 지정합니다.',
  confidence_score: '기록된 확신 점수 상태입니다. UNRECORDED와 INVALID는 구분됩니다.',
  focus_score: '기록된 집중도 점수 상태입니다. UNRECORDED와 INVALID는 구분됩니다.',
  fomo: '기록된 FOMO 상태입니다. UNRECORDED와 INVALID는 구분됩니다.',
  revenge_trade: '기록된 복수 매매 상태입니다. UNRECORDED와 INVALID는 구분됩니다.',
  rule_statuses: '규칙 판정 상태입니다. NOT_EVALUABLE은 중립이며 규칙 지표에만 적용됩니다.',
};

export function analyticsFilterDescription(id: string, fallback: string, isKo: boolean): string {
  return isKo ? analyticsFilterHelp[id] ?? fallback : fallback;
}
