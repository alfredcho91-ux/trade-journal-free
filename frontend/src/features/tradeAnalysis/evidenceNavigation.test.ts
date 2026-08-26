import { describe, expect, it } from 'vitest';

import { matchesEvidenceDirection, useEvidenceNavigation, type EvidenceRequest } from './evidenceNavigation';

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
});
