import { describe, expect, it } from 'vitest';
import { analyticsQueryKeys, buildRequest, canonicalRequest, initialDraft } from './analyticsBuilder';
import { metadataFixture } from './analyticsTestFixtures';

describe('Metadata-driven request construction', () => {
  it('accepts a new server metric and dimension without code changes', () => {
    const meta = metadataFixture();
    const draft = { ...initialDraft(meta), dimension: 'new_backend_dimension' };
    const built = buildRequest(meta, draft);
    expect(built.errors).toEqual([]);
    expect(built.request?.dimension).toBe('new_backend_dimension');
  });
  it('uses UTC millisecond timestamps and preserves false/unrecorded/invalid states', () => {
    const meta = metadataFixture();
    const draft = initialDraft(meta);
    draft.filters = { start_time: '2026-01-01T00:00:00.000', end_time: '2026-01-31T23:59:59.999', fomo: ['FALSE', 'INVALID', 'UNRECORDED'] };
    expect(buildRequest(meta, draft).request?.filters).toEqual({ start_time: 1767225600000, end_time: 1769903999999, fomo: ['FALSE', 'INVALID', 'UNRECORDED'] });
  });
  it('rejects unsupported combinations without substituting a dimension', () => {
    const meta = metadataFixture();
    expect(buildRequest(meta, { ...initialDraft(meta), dimension: 'rule_status' }).request).toBeNull();
  });
  it('applies metadata bounds, enum domains, applicability and cross constraints', () => {
    const meta = metadataFixture();
    const draft = initialDraft(meta);
    const invalidFilters: Record<string, string | string[]>[] = [ { symbols: 'A,B,C' }, { symbols: '0123456789ABCDE' }, { strategy_ids: '0' }, { fomo: ['maybe'] },
      { rule_statuses: ['FOLLOWED'] }, { assignment: 'UNASSIGNED', strategy_ids: '1' }, { start_time: '2030-01-01T00:00' }, { start_time: '' } ];
    for (const invalid of invalidFilters) {
      expect(buildRequest(meta, { ...draft, filters: { ...draft.filters, ...invalid } }).request).toBeNull();
    }
    expect(buildRequest(meta, { ...draft, metric: 'server_rules', filters: { ...draft.filters, rule_statuses: ['NOT_EVALUABLE'] } }).errors).toEqual([]);
  });
  it('uses canonical isolated keys without mutating request inputs', () => {
    const a = { metric: 'm', dimension: 'd', filters: { symbols: ['B', 'A'], start_time: 1, end_time: 2 } };
    const before = JSON.stringify(a);
    expect(analyticsQueryKeys.result(a)).toEqual(analyticsQueryKeys.result({ ...a, filters: { end_time: 2, start_time: 1, symbols: ['A', 'B'] } }));
    for (const b of [{ ...a, metric: 'other' }, { ...a, dimension: 'other' }, { ...a, filters: { ...a.filters, start_time: 3 } }]) {
      expect(analyticsQueryKeys.result(a)).not.toEqual(analyticsQueryKeys.result(b));
    }
    expect(JSON.stringify(a)).toBe(before);
    expect(canonicalRequest({ ...a, filters: { ...a.filters, optional: null } })).toEqual(canonicalRequest(a));
  });
});
