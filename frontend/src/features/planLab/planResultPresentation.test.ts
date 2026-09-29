import { describe, expect, it } from 'vitest';
import type { PlanEvaluation } from '../../types';
import { planResultPresentation } from './planResultPresentation';

const evaluation = (overrides: Partial<PlanEvaluation> = {}): PlanEvaluation => ({
  plan_id: 1,
  journal_id: 1,
  side: 'Long',
  plan_source: 'VERIFIED_PRETRADE',
  evaluation_status: 'TP_FIRST',
  planned_result_r: 2,
  actual_r: 1.5,
  r_basis: 'usdt',
  revisions: [],
  geometry: { valid: true, status: 'VALID' },
  ...overrides,
});

describe('planResultPresentation', () => {
  it('keeps available values available without adding a reason', () => {
    expect(planResultPresentation(evaluation({ planned_result_r: 0 }), false)).toEqual({ available: true, reason: null });
  });

  it.each([false, true])('explains known missing price-path evidence, locale %s', isKo => {
    const result = planResultPresentation(evaluation({ evaluation_status: 'NOT_EVALUABLE', planned_result_r: null }), isKo, true);
    expect(result.available).toBe(false);
    expect(result.reason).toBe(isKo
      ? '계산되지 않음 — 계획 결과에 필요한 가격 경로 데이터가 없습니다.'
      : 'Not calculated — price-path data required for the plan result is unavailable.');
  });

  it.each([false, true])('explains missing actual prices without blaming price-path data, locale %s', isKo => {
    const result = planResultPresentation(evaluation({ evaluation_status: 'NOT_EVALUABLE', planned_result_r: null }), isKo, false);
    expect(result.reason).toBe(isKo
      ? '계산되지 않음 — 기록된 실제 진입가 또는 청산가가 없습니다.'
      : 'Not calculated — the recorded actual entry or exit price is unavailable.');
  });

  it('does not infer a price-path reason without actual-price context', () => {
    expect(planResultPresentation(evaluation({ evaluation_status: 'NOT_EVALUABLE', planned_result_r: null }), false).reason)
      .toBe('Not calculated — no specific reason is available.');
  });

  it('keeps unclassified absence neutral and never turns it into zero or failure', () => {
    const result = planResultPresentation(evaluation({ evaluation_status: 'FUTURE_UNKNOWN', planned_result_r: null, geometry: undefined }), false);
    expect(result).toEqual({ available: false, reason: 'Not calculated — no specific reason is available.' });
    expect(result.reason).not.toMatch(/zero|failure|loss/i);
  });

  it('uses exact existing ambiguity and unresolved states without changing the response', () => {
    const source = evaluation({ evaluation_status: 'NOT_EVALUABLE', planned_result_r: null, simulation_ambiguity_reason: 'TP1_SL_SAME_CANDLE' });
    const snapshot = structuredClone(source);
    expect(planResultPresentation(source, false).reason).toMatch(/same completed candle/);
    expect(planResultPresentation(evaluation({ evaluation_status: 'UNRESOLVED', planned_result_r: null }), true).reason).toMatch(/목표가나 손절가 도달/);
    expect(source).toEqual(snapshot);
  });
});
