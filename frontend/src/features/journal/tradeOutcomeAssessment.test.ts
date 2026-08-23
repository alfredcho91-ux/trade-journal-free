import { describe, expect, it } from 'vitest';

import type { TradeExcursion } from '../../types';
import { tradeOutcomeAssessment } from './tradeOutcomeAssessment';

function excursion(overrides: Partial<TradeExcursion>): TradeExcursion {
  return {
    journal_id: 1,
    mfe_pct: 10,
    mae_pct: 2,
    realized_move_pct: 3,
    capture_pct: 30,
    candle_count: 4,
    ...overrides,
  };
}

describe('trade outcome assessment', () => {
  it('explains a good entry with a weak exit using capture', () => {
    const result = tradeOutcomeAssessment(excursion({}), 'good_entry_early_exit', true);

    expect(result.label).toBe('진입 양호 · 너무 빠른 종료');
    expect(result.explanation).toContain('최대 +10%');
    expect(result.explanation).toContain('30%만 확보');
    expect(result.tone).toBe('warning');
  });

  it('explains a poor entry using adverse and favorable movement', () => {
    const result = tradeOutcomeAssessment(excursion({
      mfe_pct: 1,
      mae_pct: 6,
      realized_move_pct: -4,
      capture_pct: -400,
    }), 'poor_entry', true);

    expect(result.label).toBe('진입 불리');
    expect(result.explanation).toContain('-6%');
    expect(result.explanation).toContain('+1%');
    expect(result.explanation).toContain('-4%');
  });

  it('reports when the backend quality sample is unavailable', () => {
    const result = tradeOutcomeAssessment(excursion({}), 'unavailable', false);

    expect(result.label).toBe('Insufficient Classification Sample');
    expect(result.tone).toBe('neutral');
  });
});
