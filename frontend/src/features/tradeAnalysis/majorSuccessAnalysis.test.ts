import { describe, expect, it } from 'vitest';

import type { AnalyzedTrade } from './tradeAnalysis';
import { isMajorSuccess, summarizeMajorSuccesses, tradePriceReturnPct } from './majorSuccessRules';

function trade(
  id: number,
  pnl: number,
  investedAmount: number,
  entryPrice = 100,
  exitPrice = 101,
  direction = 'Long',
): AnalyzedTrade {
  return {
    entry: {
      id,
      source: 'deepcoin_position',
      direction,
      symbol: 'BTC/USDT',
      realized_pnl: pnl,
      invested_amount: investedAmount,
      entry_price: entryPrice,
      exit_price: exitPrice,
    },
    entryDatetime: null,
    entryTimeConfidence: 'unavailable',
    entrySnapshot: null,
    holdingMinutes: null,
    excursion: null,
  };
}

describe('major success analysis', () => {
  it('classifies either margin return or direction-adjusted price return', () => {
    expect(isMajorSuccess(trade(1, 30, 100))).toBe(true);
    expect(isMajorSuccess(trade(2, 10, 1_000, 100, 103))).toBe(true);
    expect(isMajorSuccess(trade(3, 29.99, 100, 100, 102.99))).toBe(false);
    expect(isMajorSuccess(trade(4, -30, 100, 100, 104))).toBe(false);
  });

  it('calculates short price return in the profitable direction', () => {
    const subject = trade(1, 10, 100, 100, 96, 'Short');
    expect(tradePriceReturnPct(subject)).toBe(4);
    expect(isMajorSuccess(subject)).toBe(true);
  });

  it('reports major successes as a share of all profitable trades', () => {
    const summary = summarizeMajorSuccesses([
      trade(1, 30, 100),
      trade(2, 20, 1_000),
      trade(3, -10, 100),
    ], []);
    expect(summary.cases).toHaveLength(1);
    expect(summary.totalProfitUsdt).toBe(30);
    expect(summary.grossProfitSharePct).toBe(60);
  });

  it('lists major successes by the most recent close', () => {
    const older = trade(1, 30, 100);
    older.entry.datetime = '2026-07-01T00:00:00Z';
    const newer = trade(2, 40, 100);
    newer.entry.datetime = '2026-07-02T00:00:00Z';
    expect(summarizeMajorSuccesses([older, newer], []).cases.map((item) => item.trade.entry.id)).toEqual([2, 1]);
  });
});

