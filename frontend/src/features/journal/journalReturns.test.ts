import { describe, expect, it } from 'vitest';

import type { JournalEntry } from '../../types';
import {
  aggregateNetPnl,
  aggregateNetReturnPct,
  feeImpact,
  fundingImpact,
  investedAmount,
  netCostImpact,
  netReturnPct,
  positionNotional,
} from './journalReturns';

describe('journal net returns', () => {
  it('uses realized PnL after fees and funding against unleveraged invested amount', () => {
    const entry: JournalEntry = { entry_price: 100, size: 2, realized_pnl: 9 };
    expect(netReturnPct(entry)).toBeCloseTo(4.5);
  });

  it('weights the period return by position notional', () => {
    const entries: JournalEntry[] = [
      { entry_price: 100, size: 1, realized_pnl: 10 },
      { entry_price: 200, size: 2, realized_pnl: -20 },
    ];
    expect(aggregateNetReturnPct(entries)).toBeCloseTo(-2);
  });

  it('infers Deepcoin SWAP notional because size is a contract count', () => {
    const entry: JournalEntry = {
      source: 'deepcoin_position',
      direction: 'Short',
      entry_price: 64_299.5,
      exit_price: 64_169.6,
      size: 72,
      fee: 4.62488785,
      funding_fee: 0,
      realized_pnl: 4.72741215,
      leverage: 10,
    };

    expect(positionNotional(entry)).toBeCloseTo(4_629.32, 1);
    expect(investedAmount(entry)).toBeCloseTo(462.932, 2);
    expect(netReturnPct(entry)).toBeCloseTo(1.0211, 3);
  });

  it('removes signed funding and absolute trading fees before inferring notional', () => {
    const entry: JournalEntry = {
      source: 'deepcoin_position',
      direction: 'Long',
      entry_price: 100,
      exit_price: 102,
      size: 50,
      fee: 2,
      funding_fee: -1,
      realized_pnl: 17,
      leverage: 5,
    };

    expect(positionNotional(entry)).toBeCloseTo(1_000);
    expect(investedAmount(entry)).toBeCloseTo(200);
    expect(netReturnPct(entry)).toBeCloseTo(8.5);
  });

  it('uses the exchange-synced invested amount when available', () => {
    const entry: JournalEntry = {
      source: 'deepcoin_position',
      invested_amount: 250,
      realized_pnl: 12.5,
    };

    expect(netReturnPct(entry)).toBeCloseTo(5);
  });

  it('does not fall back to contract count when Deepcoin notional cannot be inferred', () => {
    const entry: JournalEntry = {
      source: 'deepcoin_position',
      direction: 'Long',
      entry_price: 100,
      exit_price: 100,
      size: 500,
      realized_pnl: -2,
    };

    expect(positionNotional(entry)).toBeNull();
    expect(netReturnPct(entry)).toBeNull();
  });

  it('does not invent a return when size or entry price is missing', () => {
    expect(netReturnPct({ realized_pnl: 10 })).toBeNull();
    expect(aggregateNetReturnPct([{ realized_pnl: 10 }])).toBeNull();
  });

  it('sums only finite realized PnL values', () => {
    expect(aggregateNetPnl([
      { realized_pnl: 12.5 },
      { realized_pnl: -3 },
      { realized_pnl: Number.NaN },
      {},
    ])).toBeCloseTo(9.5);
  });

  it('treats trading fees as costs regardless of the exchange sign convention', () => {
    const entries: JournalEntry[] = [
      { fee: 2, funding_fee: -0.5 },
      { fee: -3, funding_fee: 1 },
      { fee: Number.NaN, funding_fee: Number.NaN },
    ];

    expect(feeImpact(entries)).toBe(-5);
    expect(fundingImpact(entries)).toBe(0.5);
    expect(netCostImpact(entries)).toBe(-4.5);
  });
});
