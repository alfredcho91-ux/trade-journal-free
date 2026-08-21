import { describe, expect, it } from 'vitest';

import type { JournalEntry } from '../types';
import { resolvePositionEntryTime } from './positionReview';

const position: JournalEntry = {
  id: 10,
  datetime: '2026-08-04T20:00:00Z',
  symbol: 'BTC/USDT',
  direction: 'Short',
  source: 'deepcoin_position',
  order_id: 'position-1',
};

function fill(overrides: Partial<JournalEntry>): JournalEntry {
  return {
    datetime: '2026-08-04T18:00:00Z',
    symbol: 'BTC/USDT',
    direction: 'Short',
    source: 'deepcoin',
    notes: 'Deepcoin SWAP fill: sell / m / order position-1',
    ...overrides,
  };
}

describe('position review entry time', () => {
  it('uses the first opening fill with the same exchange identifier', () => {
    const later = fill({ datetime: '2026-08-04T18:05:00Z', order_id: 'position-1' });
    const first = fill({ datetime: '2026-08-04T18:00:00Z', order_id: 'position-1' });

    const result = resolvePositionEntryTime(position, [position, later, first]);

    expect(result.datetime).toBe(first.datetime);
    expect(result.confidence).toBe('confirmed');
    expect(result.source).toBe('matched_fill');
    expect(result.matchedEntry).toBe(first);
    expect(result.entryFills).toHaveLength(1);
  });

  it('marks a same-direction fill without an identifier match as estimated', () => {
    const candidate = fill({ order_id: 'different-order' });

    expect(resolvePositionEntryTime(position, [position, candidate])).toEqual({
      datetime: candidate.datetime,
      confidence: 'estimated',
      source: 'inferred_fill',
      matchedEntry: candidate,
      entryFills: [candidate],
    });
  });

  it('does not use a fill after the close time', () => {
    const future = fill({ datetime: '2026-08-04T21:00:00Z', order_id: 'position-1' });

    expect(resolvePositionEntryTime(position, [position, future]).confidence).toBe('unavailable');
  });

  it('keeps later opening fills as split entries after the confirmed first fill', () => {
    const scaledPosition = { ...position, size: 3 };
    const first = fill({ datetime: '2026-08-04T18:00:00Z', order_id: 'position-1' });
    first.size = 2;
    const addition = fill({ datetime: '2026-08-04T18:30:00Z', order_id: 'scale-order', size: 1 });

    const result = resolvePositionEntryTime(scaledPosition, [scaledPosition, addition, first]);

    expect(result.entryFills).toEqual([first, addition]);
  });

  it('does not treat a later separate position as a split entry', () => {
    const sizedPosition = { ...position, size: 2 };
    const first = fill({ datetime: '2026-08-04T18:00:00Z', order_id: 'position-1', size: 2 });
    const separate = fill({ datetime: '2026-08-04T18:30:00Z', order_id: 'next-position', size: 3 });

    const result = resolvePositionEntryTime(sizedPosition, [sizedPosition, separate, first]);

    expect(result.entryFills).toEqual([first]);
  });

  it('ignores an opposite-position close with the same buy or sell side', () => {
    const first = fill({ datetime: '2026-08-04T18:00:00Z', order_id: 'position-1' });
    const shortClose = fill({
      datetime: '2026-08-04T18:30:00Z',
      direction: 'Long',
      order_id: 'short-close',
    });

    const result = resolvePositionEntryTime(position, [position, first, shortClose]);

    expect(result.entryFills).toEqual([first]);
  });

  it('uses position creation time before a reused historical identifier', () => {
    const positioned = { ...position, entry_datetime: '2026-08-04T19:00:00Z' };
    const historical = fill({ datetime: '2026-08-04T18:00:00Z', order_id: 'position-1' });
    const actual = fill({ datetime: '2026-08-04T19:00:00Z', order_id: 'new-order' });

    const result = resolvePositionEntryTime(positioned, [positioned, historical, actual]);

    expect(result.datetime).toBe(actual.datetime);
    expect(result.matchedEntry).toBe(actual);
    expect(result.entryFills).toEqual([actual]);
  });

  it('combines partial fills from one order using a weighted average price', () => {
    const positioned = { ...position, entry_datetime: '2026-08-04T18:00:00Z', size: 3 };
    const first = fill({ order_id: 'one-order', entry_price: 100, size: 2 });
    const second = fill({ order_id: 'one-order', entry_price: 103, size: 1 });

    const result = resolvePositionEntryTime(positioned, [positioned, first, second]);

    expect(result.entryFills).toHaveLength(1);
    expect(result.entryFills[0].size).toBe(3);
    expect(result.entryFills[0].entry_price).toBeCloseTo(101);
  });

  it('matches an opening fill from another supported exchange', () => {
    const bybitPosition: JournalEntry = {
      ...position,
      source: 'bybit_position',
      exchange: 'Bybit',
      entry_datetime: '2026-08-04T18:00:00Z',
    };
    const bybitFill: JournalEntry = {
      ...fill({}),
      source: 'bybit_fill',
      exchange: 'Bybit',
      notes: 'Bybit SWAP fill: sell',
    };

    const result = resolvePositionEntryTime(bybitPosition, [bybitPosition, bybitFill]);

    expect(result.confidence).toBe('confirmed');
    expect(result.matchedEntry).toBe(bybitFill);
  });
});
