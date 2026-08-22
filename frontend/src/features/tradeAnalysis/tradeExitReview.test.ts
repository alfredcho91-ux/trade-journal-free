import { describe, expect, it } from 'vitest';

import type { TradeQualityItem } from '../../types';
import { buildExitReview, exitReviewConclusion } from './tradeExitReview';

function quality(exitQuality: Record<string, unknown>): TradeQualityItem {
  return {
    journal_id: 1,
    direction: 'Long',
    holding_minutes: 60,
    quality_class: 'unavailable',
    trend_states: {},
    market_regime: { id: 'mixed', alignment: 'conflict', trade_bias: 'neutral' },
    exit_quality: exitQuality,
  };
}

describe('trade exit review', () => {
  it('selects the highest available alternative without treating missing signals as results', () => {
    const review = buildExitReview(quality({
      hold_results: {
        actual: { available: true, return_pct: 1 },
        '1': { available: true, return_pct: 1.4 },
        '2': { available: false, reason: 'future_candle_unavailable' },
      },
      virtual_exits: {
        rsi_overheat: { available: true, return_pct: 2.3 },
        stoch_rsi_overheat: { available: false, reason: 'not_triggered' },
      },
      post_exit_mfe_pct: 1.5,
    }));

    expect(review?.actual?.returnPct).toBe(1);
    expect(review?.bestAlternative?.id).toBe('rsi_overheat');
    expect(review?.signals.find((row) => row.id === 'stoch_rsi_overheat')?.available).toBe(false);
    expect(exitReviewConclusion(review)).toBe('RSI 과열 도달이 1.30%p 더 높음');
  });

  it('does not invent a conclusion when no alternative is available', () => {
    const review = buildExitReview(quality({
      hold_results: { actual: { available: true, return_pct: -0.4 } },
      virtual_exits: {},
    }));

    expect(exitReviewConclusion(review)).toBe('비교 가능한 대안 없음');
  });
});
