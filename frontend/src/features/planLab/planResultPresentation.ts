import type { PlanEvaluation } from '../../types';

export interface PlanResultPresentation {
  available: boolean;
  reason: string | null;
}

export function planResultPresentation(evaluation: PlanEvaluation | undefined, isKo: boolean, actualPricesAvailable?: boolean): PlanResultPresentation {
  if (evaluation?.planned_result_r != null && Number.isFinite(evaluation.planned_result_r)) {
    return { available: true, reason: null };
  }
  if (!evaluation) {
    return { available: false, reason: isKo ? '아직 계산 결과가 없습니다.' : 'No calculated result is available yet.' };
  }
  const ambiguity = evaluation.simulation_ambiguity_reason;
  if (ambiguity === 'TP1_SL_SAME_CANDLE') return { available: false, reason: isKo ? '계산되지 않음 — 같은 완료봉에서 TP1과 손절가가 모두 닿아 선후를 확인할 수 없습니다.' : 'Not calculated — TP1 and the stop were touched in the same completed candle, so their order is unknown.' };
  if (ambiguity === 'TP2_SL_SAME_CANDLE_AFTER_TP1') return { available: false, reason: isKo ? '계산되지 않음 — TP1 이후 같은 완료봉에서 TP2와 손절가가 모두 닿아 선후를 확인할 수 없습니다.' : 'Not calculated — after TP1, TP2 and the stop were touched in the same completed candle, so their order is unknown.' };
  if (ambiguity === 'BOUNDARY_PARTIAL_CANDLE' || ambiguity === 'HORIZON_PARTIAL_CANDLE') return { available: false, reason: isKo ? '계산되지 않음 — 관찰 경계의 가격 봉이 완성되지 않아 공식 결과로 사용할 수 없습니다.' : 'Not calculated — a price candle at the observation boundary is incomplete and cannot be used for an official result.' };
  if (evaluation.evaluation_status === 'AMBIGUOUS') return { available: false, reason: isKo ? '계산되지 않음 — 같은 완료봉에서 목표가와 손절가가 모두 닿아 선후를 확인할 수 없습니다.' : 'Not calculated — the target and stop were touched in the same completed candle, so their order is unknown.' };
  if (evaluation.evaluation_status === 'INVALID_PLAN' || evaluation.geometry?.valid === false) return { available: false, reason: isKo ? '계산되지 않음 — 저장된 진입가·손절가·목표가로 유효한 계획 가격 구조를 만들 수 없습니다.' : 'Not calculated — the recorded entry, stop, and target do not form a valid plan price structure.' };
  if (evaluation.evaluation_status === 'POST_TRADE_INPUT') return { available: false, reason: isKo ? '계산되지 않음 — 이 거래에 사용할 진입 시점 계획 버전이 없습니다.' : 'Not calculated — this trade has no entry-time plan revision to evaluate.' };
  if (evaluation.evaluation_status === 'UNRESOLVED') return { available: false, reason: isKo ? '계산되지 않음 — 관찰된 가격 경로에서 목표가나 손절가 도달을 확인할 수 없습니다.' : 'Not calculated — the observed price path does not confirm a target or stop hit.' };
  if (evaluation.evaluation_status === 'NOT_EVALUABLE' && actualPricesAvailable === false) return { available: false, reason: isKo ? '계산되지 않음 — 기록된 실제 진입가 또는 청산가가 없습니다.' : 'Not calculated — the recorded actual entry or exit price is unavailable.' };
  if (evaluation.evaluation_status === 'NOT_EVALUABLE' && evaluation.geometry?.valid && actualPricesAvailable === true) return { available: false, reason: isKo ? '계산되지 않음 — 계획 결과에 필요한 가격 경로 데이터가 없습니다.' : 'Not calculated — price-path data required for the plan result is unavailable.' };
  return { available: false, reason: isKo ? '계산되지 않음 — 구체적인 사유를 확인할 수 없습니다.' : 'Not calculated — no specific reason is available.' };
}
