import { describe, expect, it } from 'vitest';

import {
  matchesEvidenceDirection,
  selectExitHoldEvidence,
  useEvidenceNavigation,
  type EvidenceRequest,
} from './evidenceNavigation';
import type { JournalExitHoldItem, TradeQualityHoldAggregate } from '../../types';

const request: EvidenceRequest = {
  title: 'evidence',
  filterLabel: 'LONG · 2%',
  tradeIds: [1, 2],
  period: { start: '2026-08-01', end: '2026-08-31' },
  direction: 'Long',
  minimumAbsNetReturnPct: 2,
};

describe('evidence navigation scope', () => {
  it('keeps the source minimum-return scope with the evidence request', () => {
    useEvidenceNavigation.getState().setRequest(request);

    expect(useEvidenceNavigation.getState().request).toMatchObject({
      period: request.period,
      direction: 'Long',
      minimumAbsNetReturnPct: 2,
      tradeIds: [1, 2],
    });

    useEvidenceNavigation.getState().clearRequest();
  });

  it('supports all, long and short evidence scopes without changing trade IDs', () => {
    expect(matchesEvidenceDirection('All', 'Long')).toBe(true);
    expect(matchesEvidenceDirection('All', 'Short')).toBe(true);
    expect(matchesEvidenceDirection('Long', 'Long')).toBe(true);
    expect(matchesEvidenceDirection('Long', 'Short')).toBe(false);
    expect(matchesEvidenceDirection('Short', 'Short')).toBe(true);
  });

  it('selects exactly the concrete losing IDs represented by the aggregate numerator', () => {
    const hold = (available: boolean, returnPct: number | null) => ({
      available,
      return_pct: returnPct,
    });
    const item = (
      journalId: number,
      direction: 'Long' | 'Short',
      actual: ReturnType<typeof hold>,
      selected: ReturnType<typeof hold>,
    ): JournalExitHoldItem => ({
      journal_id: journalId,
      direction,
      exit_datetime: `2026-08-${String(journalId).padStart(2, '0')}T00:00:00Z`,
      hold_results: { actual, '1': selected },
    });
    const aggregate: TradeQualityHoldAggregate = {
      available_count: 4,
      return_sample_count: 3,
      average_return_pct: 0,
      average_r: null,
      r_sample_count: 0,
      loss_count: 1,
      loss_rate_pct: 100 / 3,
      average_loss_pct: -5,
    };
    const items = [
      item(1, 'Long', hold(true, 1), hold(true, -5)),
      item(2, 'Long', hold(true, 1), hold(true, 5)),
      item(3, 'Long', hold(true, 1), hold(true, 0)),
      item(4, 'Long', hold(true, 1), hold(false, -3)),
      item(5, 'Long', hold(true, 1), hold(true, Number.NaN)),
      item(6, 'Short', hold(true, 1), hold(true, -4)),
      item(7, 'Long', hold(false, -1), hold(true, -2)),
    ];

    const selection = selectExitHoldEvidence(items, 'Long', '1', true);

    expect(selection.tradeIds).toEqual([1]);
    expect(selection.tradeIds).toHaveLength(aggregate.loss_count ?? -1);
    expect(selection.resultsByJournalId).toEqual({
      1: {
        actualReturnPct: 1,
        holdReturnPct: -5,
        differencePct: -6,
        exitTime: '2026-08-01T00:00:00Z',
      },
    });
  });
});
