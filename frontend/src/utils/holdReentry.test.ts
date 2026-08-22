import { describe, expect, it } from 'vitest';

import { calculateHoldReentry } from './holdReentry';

describe('calculateHoldReentry', () => {
  it('uses a manually supplied one-way fee', () => {
    const result = calculateHoldReentry({
      direction: 'long',
      entryPrice: 100,
      currentPrice: 99,
      reentryPrice: 98,
      targetPrice: 102,
      marginUsd: 100,
      leverage: 10,
      feePercent: 0.06,
    });

    expect(result.effectiveFeePercent).toBe(0.06);
    expect(result.incrementalFees).toBeCloseTo(1.2064898, 6);
  });

  it('compares the supplied long hold and re-entry scenario after fees', () => {
    const result = calculateHoldReentry({
      direction: 'long',
      entryPrice: 64_000,
      currentPrice: 63_600,
      reentryPrice: 63_000,
      targetPrice: 65_000,
      marginUsd: 64_000,
      leverage: 1,
    });

    expect(result.isValid).toBe(true);
    expect(result.holdingPnl).toBeCloseTo(1_000, 5);
    expect(result.reentryFinalPnl).toBeCloseTo(1_631.74603, 5);
    expect(result.netReentryAdvantage).toBeLessThan(result.grossReentryAdvantage);
  });
});
