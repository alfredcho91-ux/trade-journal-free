import { describe, expect, it } from 'vitest';

import { hourStartTimestamp, millisecondsUntilNextHour } from './useHourlyRefresh';

describe('millisecondsUntilNextHour', () => {
  it('returns one full hour at the top of an hour', () => {
    expect(millisecondsUntilNextHour(new Date(2026, 0, 1, 10, 0, 0, 0))).toBe(3_600_000);
  });

  it('keeps the remaining minutes, seconds and milliseconds precise', () => {
    expect(millisecondsUntilNextHour(new Date(2026, 0, 1, 10, 15, 30, 500))).toBe(2_669_500);
  });
});

describe('hourStartTimestamp', () => {
  it('normalizes any time to the beginning of its local hour', () => {
    expect(hourStartTimestamp(new Date(2026, 0, 1, 10, 59, 59, 999))).toBe(
      new Date(2026, 0, 1, 10, 0, 0, 0).getTime(),
    );
  });

  it('changes as soon as the next hour begins', () => {
    const before = hourStartTimestamp(new Date(2026, 0, 1, 10, 59, 59, 999));
    const after = hourStartTimestamp(new Date(2026, 0, 1, 11, 0, 0, 0));

    expect(after - before).toBe(3_600_000);
  });
});
