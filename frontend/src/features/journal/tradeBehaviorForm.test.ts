import { describe, expect, it } from 'vitest';

import {
  hasTradeBehaviorChanges,
  serializeTradeBehaviorChanges,
  tradeBehaviorDraftFromEntry,
  tradeBehaviorNumberErrors,
} from './tradeBehaviorForm';

describe('trade behavior form serialization', () => {
  it.each([2, -1, 'false', 'malformed'])('preserves invalid history %s unless explicitly edited', (raw) => {
    const initial = tradeBehaviorDraftFromEntry({ id: 1, fomo: raw, revenge_trade: raw, notes: 'old' });
    expect(initial.fomo).toBe('invalid');
    expect(initial.revenge_trade).toBe('invalid');
    expect(hasTradeBehaviorChanges(initial, { ...initial })).toBe(false);
    expect(serializeTradeBehaviorChanges(initial, { ...initial, notes: 'new' })).toEqual({ notes: 'new' });
    expect(serializeTradeBehaviorChanges(initial, { ...initial, fomo: 'no' })).toEqual({ fomo: false });
    expect(serializeTradeBehaviorChanges(initial, { ...initial, revenge_trade: 'yes' })).toEqual({ revenge_trade: true });
    expect(serializeTradeBehaviorChanges(initial, { ...initial, fomo: 'unrecorded' })).toEqual({ fomo: null });
  });

  it('omits every untouched field on initial load', () => {
    const initial = tradeBehaviorDraftFromEntry({
      id: 1,
      planned_stop_pct: 1.5,
      emotion_before: 'Calm',
      fomo: false,
      notes: 'keep',
    });

    expect(serializeTradeBehaviorChanges(initial, { ...initial })).toEqual({});
    expect(hasTradeBehaviorChanges(initial, { ...initial })).toBe(false);
  });

  it('sends only the edited field', () => {
    const initial = tradeBehaviorDraftFromEntry({ id: 1, notes: 'old', focus_score: 3 });
    const current = { ...initial, notes: 'new' };

    expect(serializeTradeBehaviorChanges(initial, current)).toEqual({ notes: 'new' });
  });

  it('uses explicit null when a recorded value is cleared', () => {
    const initial = tradeBehaviorDraftFromEntry({ id: 1, emotion_before: 'Anxious', confidence_score: 4 });
    const current = { ...initial, emotion_before: '', confidence_score: '' as const };

    expect(serializeTradeBehaviorChanges(initial, current)).toEqual({
      emotion_before: null,
      confidence_score: null,
    });
  });

  it('preserves null, false, and true as separate boolean states', () => {
    const initial = tradeBehaviorDraftFromEntry({ id: 1, fomo: null, revenge_trade: true });
    const current = { ...initial, fomo: 'no' as const, revenge_trade: 'unrecorded' as const };

    expect(serializeTradeBehaviorChanges(initial, current)).toEqual({
      fomo: false,
      revenge_trade: null,
    });
  });

  it('serializes confidence, focus, and false-to-true transitions independently', () => {
    const initial = tradeBehaviorDraftFromEntry({ id: 1, confidence_score: 2, focus_score: null, fomo: false });
    const current = { ...initial, confidence_score: '5' as const, focus_score: '4' as const, fomo: 'yes' as const };

    expect(serializeTradeBehaviorChanges(initial, current)).toEqual({
      confidence_score: 5,
      focus_score: 4,
      fomo: true,
    });
  });

  it('normalizes comma-separated tags without emitting unchanged formatting', () => {
    const initial = tradeBehaviorDraftFromEntry({ id: 1, setup_tags: ['trend', 'breakout'] });
    const current = { ...initial, setup_tags: ' trend, breakout, trend ' };

    expect(serializeTradeBehaviorChanges(initial, current)).toEqual({});
  });

  it('serializes an explicitly cleared plan number as null and a valid value as a number', () => {
    const initial = tradeBehaviorDraftFromEntry({ id: 1, planned_stop_pct: 1.5, planned_target_pct: 3 });

    expect(serializeTradeBehaviorChanges(initial, { ...initial, planned_stop_pct: '' })).toEqual({ planned_stop_pct: null });
    expect(serializeTradeBehaviorChanges(initial, { ...initial, planned_target_pct: '4.5' })).toEqual({ planned_target_pct: 4.5 });
  });

  it.each(['0', '-1', 'abc', 'Infinity', '101'])('rejects an invalid stop value instead of clearing the existing value: %s', (value) => {
    const initial = tradeBehaviorDraftFromEntry({ id: 1, planned_stop_pct: 1.5 });
    const current = { ...initial, planned_stop_pct: value };

    expect(tradeBehaviorNumberErrors(current)).toEqual({ planned_stop_pct: true });
    expect(() => serializeTradeBehaviorChanges(initial, current)).toThrow();
  });

  it.each(['0', '-1', 'abc', 'Infinity', '501'])('rejects an invalid target value: %s', (value) => {
    const current = tradeBehaviorDraftFromEntry({ id: 1 });
    current.planned_target_pct = value;

    expect(tradeBehaviorNumberErrors(current)).toEqual({ planned_target_pct: true });
  });
});
