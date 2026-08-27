import type { PlanLabData } from '../../types';

export function planCoverageItems(data: Pick<PlanLabData, 'coverage'>, isKo: boolean) {
  return [
    { label: isKo ? '종료 거래' : 'Closed', value: data.coverage.closed_trades },
    { label: isKo ? 'Plan 입력' : 'Plans', value: data.coverage.plan_recorded },
    { label: isKo ? '공식 USDT R' : 'Official USDT R', value: data.coverage.official_r },
    { label: isKo ? '가격 R만 가능' : 'Price R only', value: data.coverage.price_r_only },
    { label: isKo ? 'R 계산 불가' : 'R unavailable', value: data.coverage.r_unavailable },
    { label: isKo ? '동일 봉 충돌' : 'Ambiguous', value: data.coverage.ambiguous },
    { label: isKo ? '경계·경로 불확실' : 'Not evaluable', value: data.coverage.not_evaluable },
    { label: isKo ? '사전 기록' : 'Verified', value: data.coverage.verified_pretrade },
    { label: isKo ? '회고 입력' : 'Retrospective', value: data.coverage.retrospective },
    { label: isKo ? 'TP1 단일 계획' : 'Single-TP plans', value: data.coverage.legacy_single_tp || 0 },
    { label: isKo ? 'TP1·TP2 분할 계획' : 'Split-TP plans', value: data.coverage.split_tp || 0 },
    {
      label: isKo ? '분할 계획 청산 후 분석 제외' : 'Split post-exit excluded',
      value: data.coverage.split_post_exit_unsupported || 0,
    },
  ];
}
