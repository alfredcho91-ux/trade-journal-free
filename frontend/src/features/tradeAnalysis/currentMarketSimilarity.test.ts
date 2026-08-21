import { describe, expect, it } from 'vitest';

import type { CurrentMarketTrendState, JournalCurrentMarketData, JournalEntry, TradeQualityItem } from '../../types';
import type { AnalyzedTrade } from './tradeAnalysis';
import {
  buildCurrentMarketSimilarities,
  MIN_CURRENT_MARKET_SIMILARITY_PCT,
  selectCurrentMarketSimilarities,
} from './currentMarketSimilarity';

function snapshot(rsi: number) {
  const frame = {
    status: 'complete' as const,
    close: 100,
    rsi,
    macd: { histogram: 0.2 },
    stoch_rsi: { k: rsi },
    slow_stochastic: {
      '5-3-3': { k: rsi },
      '10-6-6': { k: rsi },
      '20-12-12': { k: rsi },
    },
    vpvr: { vwap: 99, poc_mid: 98 },
  };
  return {
    event_type: 'fill' as const,
    timeframes: { '1h': frame, '2h': frame, '4h': frame, '1d': frame },
  };
}

function trend(direction: 'up' | 'down'): CurrentMarketTrendState {
  return {
    status: 'complete',
    direction,
    ema_alignment: direction === 'up' ? 'bullish' : 'bearish',
    macd: { direction: direction === 'up' ? 'bullish' : 'bearish' },
  };
}

function analyzedTrade(id: number, rsi: number, pnl: number, symbol = 'BTC/USDT'): AnalyzedTrade {
  const entry: JournalEntry = {
    id,
    symbol,
    direction: 'Long',
    datetime: new Date(Date.UTC(2026, 0, id)).toISOString(),
    realized_pnl: pnl,
    invested_amount: 100,
  };
  return {
    entry,
    entryDatetime: null,
    entryTimeConfidence: 'confirmed',
    entrySnapshot: snapshot(rsi),
    holdingMinutes: null,
    excursion: {
      journal_id: id,
      mfe_pct: 3,
      mae_pct: 1,
      realized_move_pct: 2,
      classification: 'balanced',
      candle_count: 10,
    },
  };
}

describe('buildCurrentMarketSimilarities', () => {
  it('lists recent matches first while leaving similarity independent from the trade outcome', () => {
    const current: JournalCurrentMarketData = {
      symbol: 'BTC/USDT',
      as_of: '2026-08-17T10:00:00Z',
      indicator_snapshot: snapshot(50),
      trend_states: { '1w': trend('up'), '1d': trend('up'), '4h': trend('up') },
      market_regime: { id: 'aligned_up', alignment: 'aligned', trade_bias: 'up' },
      warnings: [],
    };
    const quality = (id: number, direction: 'up' | 'down'): TradeQualityItem => ({
      journal_id: id,
      holding_minutes: 60,
      quality_class: 'good_entry_good_exit',
      trend_states: { '1w': trend(direction), '1d': trend(direction), '4h': trend(direction) },
      market_regime: { id: 'test', alignment: 'aligned', trade_bias: direction },
      exit_quality: { additional_profit_potential_pct: 1.5 },
    });

    const rows = buildCurrentMarketSimilarities(
      current,
      [analyzedTrade(1, 52, -10), analyzedTrade(2, 80, 50), analyzedTrade(3, 50, 30, 'ETH/USDT')],
      [quality(1, 'up'), quality(2, 'down'), quality(3, 'up')],
    );

    expect(rows.map((row) => row.trade.entry.id)).toEqual([2, 1]);
    expect(rows[1].outcome).toBe('loss');
    expect(rows[1].similarityPct).toBeGreaterThan(rows[0].similarityPct);
    expect(rows[1].postExitPotentialPct).toBe(1.5);
    const selected = selectCurrentMarketSimilarities(rows);
    expect(selected.map((row) => row.trade.entry.id)).toEqual([1]);
    expect(selected[0].similarityPct).toBeGreaterThanOrEqual(MIN_CURRENT_MARKET_SIMILARITY_PCT);
  });

  it('rejects incomplete indicator coverage instead of renormalizing one timeframe', () => {
    const current: JournalCurrentMarketData = {
      symbol: 'BTC/USDT',
      as_of: '2026-08-17T10:00:00Z',
      indicator_snapshot: snapshot(50),
      trend_states: { '1w': trend('up'), '1d': trend('up'), '4h': trend('up') },
      market_regime: { id: 'aligned_up', alignment: 'aligned', trade_bias: 'up' },
      warnings: [],
    };
    const incomplete = analyzedTrade(4, 50, 10);
    incomplete.entrySnapshot = {
      event_type: 'fill',
      timeframes: { '4h': snapshot(50).timeframes['4h'] },
    };
    const quality: TradeQualityItem = {
      journal_id: 4,
      holding_minutes: 60,
      quality_class: 'balanced',
      trend_states: { '1w': trend('up'), '1d': trend('up'), '4h': trend('up') },
      market_regime: { id: 'aligned_up', alignment: 'aligned', trade_bias: 'up' },
      exit_quality: {},
    };

    expect(buildCurrentMarketSimilarities(current, [incomplete], [quality])).toEqual([]);
  });

  it('rejects an estimated entry even when its indicators match', () => {
    const current: JournalCurrentMarketData = {
      symbol: 'BTC/USDT',
      as_of: '2026-08-17T10:00:00Z',
      indicator_snapshot: snapshot(50),
      trend_states: { '1w': trend('up'), '1d': trend('up'), '4h': trend('up') },
      market_regime: { id: 'aligned_up', alignment: 'aligned', trade_bias: 'up' },
      warnings: [],
    };
    const estimated = analyzedTrade(5, 50, 10);
    estimated.entryTimeConfidence = 'estimated';
    const quality: TradeQualityItem = {
      journal_id: 5,
      holding_minutes: 60,
      quality_class: 'balanced',
      trend_states: { '1w': trend('up'), '1d': trend('up'), '4h': trend('up') },
      market_regime: { id: 'aligned_up', alignment: 'aligned', trade_bias: 'up' },
      exit_quality: {},
    };

    expect(buildCurrentMarketSimilarities(current, [estimated], [quality])).toEqual([]);
  });
});
