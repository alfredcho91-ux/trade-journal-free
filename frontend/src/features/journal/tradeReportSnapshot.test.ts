import { describe, expect, it } from 'vitest';

import { KNOWN_SNAPSHOT_INDICATOR_KEYS, formatRvol20 } from './tradeReportSnapshot';

describe('formatRvol20', () => {
  it('formats the canonical backend value as a neutral relative-volume multiple', () => {
    expect(formatRvol20(1.82)).toBe('1.82x');
  });

  it('keeps unavailable volume distinct from a numeric zero', () => {
    expect(formatRvol20(null)).toBe('—');
    expect(formatRvol20(undefined)).toBe('—');
    expect(formatRvol20(Number.NaN)).toBe('—');
    expect(formatRvol20(0)).toBe('0x');
  });

  it('keeps RVOL20 out of generic extra-indicator rendering', () => {
    expect(KNOWN_SNAPSHOT_INDICATOR_KEYS.has('rvol20')).toBe(true);
  });
});
