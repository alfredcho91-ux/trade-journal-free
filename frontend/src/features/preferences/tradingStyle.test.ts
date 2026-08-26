import { describe, expect, it } from 'vitest';

import {
  TRADING_STYLE_CONFIGS,
  TRADING_STYLE_OPTIONS,
  isTradingStyle,
  type JournalMetricId,
  type TradeAnalysisPriority,
} from './tradingStyle';

const expectedStyles = ['auto', 'scalper', 'day', 'swing', 'position', 'custom'];
const expectedAnalysisSections: TradeAnalysisPriority[] = ['market', 'execution', 'indicators'];
const expectedMetrics: JournalMetricId[] = [
  'netReturn',
  'netPnl',
  'winRate',
  'profitFactor',
  'averageWin',
  'averageLoss',
  'expectancy',
  'costImpact',
  'holdingTime',
];

describe('tradingStyle configuration', () => {
  it('defines every supported persisted style', () => {
    expect(TRADING_STYLE_OPTIONS.map((item) => item.id)).toEqual(expectedStyles);
    expectedStyles.forEach((style) => expect(isTradingStyle(style)).toBe(true));
    expect(isTradingStyle('unknown')).toBe(false);
  });

  it('keeps every existing analysis section and journal metric exactly once', () => {
    TRADING_STYLE_OPTIONS.forEach((config) => {
      expect([...config.analysisOrder].sort()).toEqual([...expectedAnalysisSections].sort());
      expect(new Set(config.analysisOrder).size).toBe(expectedAnalysisSections.length);
      expect([...config.journalMetricOrder].sort()).toEqual([...expectedMetrics].sort());
      expect(new Set(config.journalMetricOrder).size).toBe(expectedMetrics.length);
    });
  });

  it('uses only timeframes already supported by the current frontend', () => {
    expect(TRADING_STYLE_CONFIGS.scalper.defaultTimeframe).toBe('1h');
    expect(TRADING_STYLE_CONFIGS.day.defaultTimeframe).toBe('1h');
    expect(TRADING_STYLE_CONFIGS.swing.defaultTimeframe).toBe('4h');
    expect(TRADING_STYLE_CONFIGS.position.defaultTimeframe).toBe('1d');
    expect(TRADING_STYLE_CONFIGS.scalper.defaultExitHoldInterval).toBe('15m');
  });
});
