import { describe, expect, it } from 'vitest';

import { dailyPnlByCloseDate, monthlyPnlByCloseMonth } from './dailyPnlUtils';

describe('dailyPnlByCloseDate', () => {
  it('groups closed trade PnL by the local close date', () => {
    const summary = dailyPnlByCloseDate([
      { datetime: '2026-08-24T09:00:00', realized_pnl: 12.5 },
      { datetime: '2026-08-24T18:00:00', realized_pnl: -2.5 },
      { datetime: '2026-08-25T09:00:00', realized_pnl: -8 },
    ]);

    expect(summary['2026-08-24']).toEqual({ pnl: 10, tradeCount: 2 });
    expect(summary['2026-08-25']).toEqual({ pnl: -8, tradeCount: 1 });
  });

  it('ignores entries without a valid realized PnL or close date', () => {
    const summary = dailyPnlByCloseDate([
      { datetime: 'invalid', realized_pnl: 4 },
      { datetime: '2026-08-24T09:00:00' },
    ]);

    expect(summary).toEqual({});
  });

  it('aggregates the same closed trades into monthly totals', () => {
    const summary = monthlyPnlByCloseMonth([
      { datetime: '2026-08-01T09:00:00', realized_pnl: 10 },
      { datetime: '2026-08-20T09:00:00', realized_pnl: -4 },
      { datetime: '2026-09-01T09:00:00', realized_pnl: 3 },
    ]);

    expect(summary['2026-08']).toEqual({ pnl: 6, tradeCount: 2 });
    expect(summary['2026-09']).toEqual({ pnl: 3, tradeCount: 1 });
  });
});
