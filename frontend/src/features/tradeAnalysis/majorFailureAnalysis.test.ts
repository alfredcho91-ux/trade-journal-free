import { describe, expect, it } from 'vitest';

import type { AnalyzedTrade } from './tradeAnalysis';
import { isMajorFailure, summarizeMajorFailures } from './majorFailureRules';

function trade(id: number, pnl: number, investedAmount: number): AnalyzedTrade {
  return {
    entry: {
      id,
      source: 'deepcoin_position',
      direction: 'Long',
      symbol: 'BTC/USDT',
      realized_pnl: pnl,
      invested_amount: investedAmount,
      leverage: 10,
    },
    entryDatetime: null,
    entryTimeConfidence: 'unavailable',
    entrySnapshot: null,
    holdingMinutes: null,
    excursion: null,
  };
}

describe('major failure analysis', () => {
  it('classifies either the return threshold or dollar threshold', () => {
    expect(isMajorFailure(trade(1, -30, 100))).toBe(true);
    expect(isMajorFailure(trade(2, -200, 1_000))).toBe(true);
    expect(isMajorFailure(trade(3, -29.99, 100))).toBe(false);
    expect(isMajorFailure(trade(4, -199.99, 1_000))).toBe(false);
    expect(isMajorFailure(trade(5, 300, 100))).toBe(false);
  });

  it('reports the large losses share of all losing trades', () => {
    const summary = summarizeMajorFailures([
      trade(1, -200, 1_000),
      trade(2, -50, 1_000),
      trade(3, 100, 1_000),
    ], []);

    expect(summary.cases).toHaveLength(1);
    expect(summary.totalLossUsdt).toBe(-200);
    expect(summary.grossLossSharePct).toBe(80);
    expect(summary.leverageAmplifiedCount).toBe(1);
  });

  it('lists major failures by the most recent closed trade', () => {
    const older = trade(1, -500, 1_000);
    older.entry.datetime = '2026-07-01T00:00:00Z';
    const newer = trade(2, -250, 1_000);
    newer.entry.datetime = '2026-07-02T00:00:00Z';

    expect(summarizeMajorFailures([older, newer], []).cases.map((item) => item.trade.entry.id)).toEqual([2, 1]);
  });

  it('uses stored quality and post-exit data to explain a major failure', () => {
    const subject = trade(8, -250, 1_000);
    subject.excursion = {
      journal_id: 8,
      mfe_pct: 0.2,
      mae_pct: 1.1,
      realized_move_pct: -1,
      candle_count: 4,
    };

    const summary = summarizeMajorFailures([subject], [{
      journal_id: 8,
      holding_minutes: 60,
      quality_class: 'poor_entry',
      trend_states: {},
      market_regime: { id: 'mixed', alignment: 'conflict', trade_bias: 'neutral' },
      trade_alignment: 'counter_trend',
      exit_quality: {
        hold_results: { '10': { available: true, return_pct: 1 } },
      },
    }]);

    expect(summary.cases[0].reasons).toEqual(expect.arrayContaining([
      'loss_amount_threshold',
      'poor_entry',
      'regime_conflict',
      'counter_trend',
      'leverage_amplified',
      'late_recovery',
      'risk_basis_missing',
    ]));
  });
});
