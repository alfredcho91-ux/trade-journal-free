import { describe, expect, it } from 'vitest';

import type { JournalEntry, TradeIndicatorSnapshot } from '../../types';
import {
  buildAnalyzedTrades,
  conditionComparisons,
  filterTradesByCondition,
  filterTradesByIndicatorMetric,
  filterTradesByReturnRange,
  indicatorComparisons,
  performanceSummary,
  returnRangeIdFor,
  strongestReliableCondition,
} from './tradeAnalysis';
import { wilsonInterval } from './statisticalConfidence';

function snapshot(rsi: number, macdHistogram: number): TradeIndicatorSnapshot {
  return {
    event_type: 'fill',
    reference: 'last_completed_candle_before_deepcoin_fill',
    timeframes: {
      '4h': {
        status: 'complete',
        close: 100,
        rsi,
        macd: { histogram: macdHistogram },
        stoch_rsi: { k: rsi },
        slow_stochastic: {
          '5-3-3': { k: rsi },
          '10-6-6': { k: rsi },
          '20-12-12': { k: rsi },
        },
        vpvr: { vwap: 100, poc_mid: 100, value_area_low: 90, value_area_high: 110 },
      },
    },
  };
}

function fixtures(): JournalEntry[] {
  return [
    {
      id: 1,
      source: 'deepcoin',
      external_id: 'fill:win',
      datetime: '2026-08-01T00:00:00Z',
      symbol: 'BTC/USDT',
      direction: 'Long',
      notes: 'Deepcoin SWAP fill: buy / m',
      indicator_snapshot: snapshot(30, 2),
    },
    {
      id: 2,
      source: 'deepcoin_position',
      external_id: 'position:win',
      entry_datetime: '2026-08-01T00:00:00Z',
      datetime: '2026-08-01T02:00:00Z',
      symbol: 'BTC/USDT',
      direction: 'Long',
      realized_pnl: 20,
      fee: 2,
      funding_fee: 1,
      indicator_snapshot: { event_type: 'position_close', timeframes: { '4h': { status: 'complete', rsi: 99 } } },
    },
    {
      id: 3,
      source: 'deepcoin',
      external_id: 'fill:loss',
      datetime: '2026-08-02T00:00:00Z',
      symbol: 'ETH/USDT',
      direction: 'Short',
      notes: 'Deepcoin SWAP fill: sell / m',
      indicator_snapshot: snapshot(70, -2),
    },
    {
      id: 4,
      source: 'deepcoin_position',
      external_id: 'position:loss',
      entry_datetime: '2026-08-02T00:00:00Z',
      datetime: '2026-08-02T01:00:00Z',
      symbol: 'ETH/USDT',
      direction: 'Short',
      realized_pnl: -10,
      fee: 1,
      funding_fee: -0.5,
    },
  ];
}

describe('trade analysis', () => {
  it('uses entry fill snapshots and never the close snapshot', () => {
    const trades = buildAnalyzedTrades(fixtures());

    expect(trades).toHaveLength(2);
    expect(trades[0].entrySnapshot?.timeframes?.['4h']?.rsi).toBe(30);
    expect(trades[0].holdingMinutes).toBe(120);
  });

  it('summarizes net performance and costs', () => {
    const summary = performanceSummary(buildAnalyzedTrades(fixtures()));

    expect(summary.winRate).toBe(50);
    expect(summary.netPnl).toBe(10);
    expect(summary.profitFactor).toBe(2);
    expect(summary.feeImpact).toBe(-3);
    expect(summary.fundingImpact).toBe(0.5);
  });

  it('compares winner and loser entry conditions', () => {
    const trades = buildAnalyzedTrades(fixtures());
    const comparisons = indicatorComparisons(trades, '4h');
    const rsi = comparisons.find((item) => item.id === 'rsi');
    const lowRsi = conditionComparisons(trades, '4h').find((item) => item.id === 'rsi_low');

    expect(rsi?.winAverage).toBe(30);
    expect(rsi?.lossAverage).toBe(70);
    expect(lowRsi?.winFrequency).toBe(100);
    expect(lowRsi?.lossFrequency).toBe(0);
    expect(lowRsi?.conditionCount).toBe(1);
    expect(lowRsi?.conditionalWinRate).toBe(100);
    expect(lowRsi?.occurrenceRatio).toBeNull();
    expect(filterTradesByCondition(trades, '4h', 'rsi_low').map((trade) => trade.entry.id)).toEqual([2]);
  });

  it('uses only reliable, meaningful occurrence gaps for the automatic condition conclusion', () => {
    const base = {
      id: 'condition',
      label: 'Condition',
      winFrequency: 40,
      lossFrequency: 20,
      difference: 20,
      winCount: 30,
      lossCount: 30,
      winMatched: 12,
      lossMatched: 6,
      conditionCount: 18,
      conditionalWinRate: 66.666,
      occurrenceRatio: 2,
    };
    expect(strongestReliableCondition([base])?.id).toBe('condition');
    expect(strongestReliableCondition([{ ...base, winCount: 8, lossCount: 8 }])).toBeNull();
    expect(strongestReliableCondition([{ ...base, difference: 4, occurrenceRatio: 1.1 }])).toBeNull();
  });

  it('calculates Wilson intervals only from valid exact counts', () => {
    const interval = wilsonInterval(34, 50);
    expect(interval?.low).toBeCloseTo(54.19, 1);
    expect(interval?.high).toBeCloseTo(79.24, 1);
    expect(wilsonInterval(1, 0)).toBeNull();
    expect(wilsonInterval(6, 5)).toBeNull();
  });

  it('omits condition comparisons when either outcome group is empty', () => {
    const winsOnly = buildAnalyzedTrades(fixtures()).filter((trade) => (trade.entry.realized_pnl || 0) > 0);

    expect(conditionComparisons(winsOnly, '4h')).toEqual([]);
  });

  it('keeps zero-match condition statistics finite', () => {
    const comparisons = conditionComparisons(buildAnalyzedTrades(fixtures()), '4h');
    const highStochRsi = comparisons.find((item) => item.id === 'stoch_rsi_high');

    expect(highStochRsi?.conditionCount).toBe(0);
    expect(highStochRsi?.conditionalWinRate).toBeNull();
    expect(highStochRsi?.occurrenceRatio).toBeNull();
    expect(Number.isFinite(highStochRsi?.winFrequency || 0)).toBe(true);
    expect(Number.isFinite(highStochRsi?.lossFrequency || 0)).toBe(true);
  });

  it('keeps evidence drawers aligned with win/loss comparison samples', () => {
    const trades = buildAnalyzedTrades(fixtures());
    const breakEven = {
      ...trades[0],
      entry: { ...trades[0].entry, id: 99, realized_pnl: 0 },
    };
    const withBreakEven = [...trades, breakEven];

    expect(filterTradesByIndicatorMetric(withBreakEven, '4h', 'rsi').map((trade) => trade.entry.id)).toEqual([2, 4]);
    expect(filterTradesByCondition(withBreakEven, '4h', 'rsi_low').map((trade) => trade.entry.id)).toEqual([2]);
  });

  it('classifies profit and loss return magnitudes at exact boundaries', () => {
    expect(returnRangeIdFor(0.999)).toBe('lt1');
    expect(returnRangeIdFor(-1)).toBe('1to5');
    expect(returnRangeIdFor(4.999)).toBe('1to5');
    expect(returnRangeIdFor(-5)).toBe('5to10');
    expect(returnRangeIdFor(9.999)).toBe('5to10');
    expect(returnRangeIdFor(-10)).toBe('gte10');
  });

  it('filters both profits and losses by absolute net return', () => {
    const trades = buildAnalyzedTrades(fixtures()).map((trade, index) => ({
      ...trade,
      entry: {
        ...trade.entry,
        entry_price: 100,
        exit_price: index === 0 ? 102 : 98,
        realized_pnl: index === 0 ? 2 : -2,
        invested_amount: 100,
        fee: 0,
        funding_fee: 0,
      },
    }));

    expect(filterTradesByReturnRange(trades, '1to5')).toHaveLength(2);
    expect(filterTradesByReturnRange(trades, 'lt1')).toHaveLength(0);
  });
});
