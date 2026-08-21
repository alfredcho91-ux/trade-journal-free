import { describe, expect, it } from 'vitest';

import type { AnalyzedTrade } from './tradeAnalysis';
import { calculateStopLossExpectation } from './stopLossExpectation';

function trade(
  id: number,
  maePct: number,
  realizedMovePct: number,
  leverage: number | undefined,
): AnalyzedTrade {
  return {
    entry: {
      id,
      direction: 'Long',
      leverage,
      invested_amount: 100,
      realized_pnl: leverage == null ? realizedMovePct : realizedMovePct * leverage,
      fee: 0,
      datetime: `2026-08-0${id}T00:00:00Z`,
    },
    entryDatetime: null,
    entryTimeConfidence: 'unavailable',
    entrySnapshot: null,
    holdingMinutes: null,
    excursion: {
      journal_id: id,
      mfe_pct: Math.max(realizedMovePct, 0),
      mae_pct: maePct,
      realized_move_pct: realizedMovePct,
      classification: 'balanced',
      candle_count: 10,
    },
  };
}

describe('stop loss expectation', () => {
  it('uses only raw coin-price movement regardless of leverage', () => {
    const result = calculateStopLossExpectation([
      trade(1, 0.5, 2, 10),
      trade(2, 1.2, 3, 10),
      trade(3, 0.2, -1, 10),
    ], 1);

    expect(result.tradeCount).toBe(3);
    expect(result.stopHitCount).toBe(1);
    expect(result.falseStopCount).toBe(1);
    expect(result.winRatePct).toBeCloseTo(100 / 3);
    expect(result.expectancyPct).toBeCloseTo(0);
    expect(result.averageWinPct).toBe(2);
    expect(result.averageLossPct).toBe(-1);
    expect(result.profitFactor).toBe(1);
    expect(result.baselineExpectancyPct).toBeCloseTo(4 / 3);
  });

  it('does not change when leverage changes', () => {
    const result = calculateStopLossExpectation([
      trade(1, 0.5, 2, 50),
      trade(2, 1.2, 3, 2),
    ], 1);

    expect(result.stopHitCount).toBe(1);
    expect(result.expectancyPct).toBe(0.5);
    expect(result.averageWinPct).toBe(2);
    expect(result.averageLossPct).toBe(-1);
  });

  it('does not include trading fees in a price-based stop', () => {
    const subject = trade(1, 1.2, 3, 10);
    subject.entry.fee = -2;

    const result = calculateStopLossExpectation([subject], 1);

    expect(result.expectancyPct).toBe(-1);
    expect(result.averageLossPct).toBe(-1);
    expect(result.baselineExpectancyPct).toBe(3);
  });

  it('includes trades without leverage', () => {
    const trades = [trade(1, 0.5, 2, undefined)];

    expect(calculateStopLossExpectation(trades, 1).tradeCount).toBe(1);
    expect(calculateStopLossExpectation(trades, 1).excludedTradeCount).toBe(0);
  });

  it('returns empty metrics for an invalid stop', () => {
    const result = calculateStopLossExpectation([trade(1, 0.5, 2, 10)], 0);

    expect(result.tradeCount).toBe(0);
    expect(result.expectancyPct).toBeNull();
    expect(result.winRatePct).toBeNull();
  });
});
