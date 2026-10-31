import type { StrategyCandidate } from '../../types/strategyDiscovery';

export function validationLabel(state: StrategyCandidate['validation_state'], isKo: boolean): string {
  return ({ CONSISTENT: isKo ? '검증 구간에서도 유지' : 'Repeated in holdout',
    WEAKENED: isKo ? '검증 구간에서 약화' : 'Weakened in holdout',
    INSUFFICIENT_EVIDENCE: isKo ? '검증 근거 부족' : 'Insufficient holdout evidence' })[state];
}
export function reasonLabel(reason: string, isKo: boolean): string {
  const labels: Record<string, [string, string]> = {
    RECORDED_TRADES_ONLY: ['실제로 기록된 거래만 평가합니다. 미진입 기회까지 포함한 매매 시뮬레이션이 아닙니다.', 'Evaluates recorded trades, not a full market backtest including untraded opportunities.'],
    PNL_CURRENCY_UNVERIFIED: ['손익 통화를 확인할 수 없어 Profit Factor는 계산하지 않습니다.', 'Profit Factor is unavailable because PnL settlement currency is not verified.'],
    RISK_AND_EXIT_RULES_NOT_GENERATED: ['리스크·청산 규칙은 생성하지 않았습니다. 등록 전에 직접 검토하세요.', 'Risk and exit rules are not generated. Review them before registering.'],
    HOLDOUT_SAMPLE_OR_COVERAGE_TOO_LOW: ['검증 구간의 평가 가능 표본 또는 데이터 가용성이 부족합니다.', 'Holdout evaluable sample or data coverage is insufficient.'],
    HOLDOUT_UPLIFT_OR_POSITIVE_RESULT_NOT_REPEATED: ['발견 구간의 양수 성과 또는 전체 대비 차이가 검증 구간에서 반복되지 않았습니다.', 'The positive result or uplift over the baseline did not repeat in holdout.'],
    ENTRY_BEFORE_PERIOD: ['기간 전에 진입한 거래', 'Trades entered before the period'],
    INVALID_POSITION_TIME: ['진입·종료 시각 결측 또는 오류', 'Missing or invalid position times'],
    CLOSE_OUTSIDE_PERIOD: ['기간 밖에서 종료한 거래', 'Trades closed outside the period'],
    CROSSES_SPLIT: ['기간 분리 경계를 걸친 거래', 'Trades crossing the split boundary'],
    MISSING_CLOSE_TIME_ALL_STORED_POSITIONS: ['저장된 전체 포지션 중 종료 시각 결측', 'Stored positions with unavailable close time, across all periods'],
  };
  return labels[reason]?.[isKo ? 0 : 1] ?? reason;
}
export const utcDate = (value: number | string) => new Date(value).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
