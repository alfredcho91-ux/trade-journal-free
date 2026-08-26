import type { ExitHoldInterval } from '../../types';
import type { AnalysisTimeframe } from '../tradeAnalysis/tradeAnalysis';

export type TradingStyle = 'auto' | 'scalper' | 'day' | 'swing' | 'position' | 'custom';

export type TradeAnalysisPriority = 'market' | 'execution' | 'indicators';

export type JournalMetricId =
  | 'netReturn'
  | 'netPnl'
  | 'winRate'
  | 'profitFactor'
  | 'averageWin'
  | 'averageLoss'
  | 'expectancy'
  | 'costImpact'
  | 'holdingTime';

export interface TradingStyleConfig {
  id: TradingStyle;
  labelKo: string;
  labelEn: string;
  defaultTimeframe: AnalysisTimeframe;
  defaultExitHoldInterval: ExitHoldInterval;
  analysisOrder: TradeAnalysisPriority[];
  journalMetricOrder: JournalMetricId[];
}

const STANDARD_METRIC_ORDER: JournalMetricId[] = [
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

const STANDARD_ANALYSIS_ORDER: TradeAnalysisPriority[] = ['market', 'execution', 'indicators'];

export const TRADING_STYLE_CONFIGS: Record<TradingStyle, TradingStyleConfig> = {
  auto: {
    id: 'auto',
    labelKo: '자동',
    labelEn: 'Auto',
    defaultTimeframe: '4h',
    defaultExitHoldInterval: '4h',
    analysisOrder: STANDARD_ANALYSIS_ORDER,
    journalMetricOrder: STANDARD_METRIC_ORDER,
  },
  scalper: {
    id: 'scalper',
    labelKo: '스캘퍼',
    labelEn: 'Scalper',
    defaultTimeframe: '1h',
    defaultExitHoldInterval: '15m',
    analysisOrder: ['execution', 'indicators', 'market'],
    journalMetricOrder: ['costImpact', 'holdingTime', 'netReturn', 'netPnl', 'winRate', 'profitFactor', 'expectancy', 'averageWin', 'averageLoss'],
  },
  day: {
    id: 'day',
    labelKo: '데이트레이더',
    labelEn: 'Day trader',
    defaultTimeframe: '1h',
    defaultExitHoldInterval: '15m',
    analysisOrder: ['execution', 'indicators', 'market'],
    journalMetricOrder: ['netReturn', 'netPnl', 'winRate', 'profitFactor', 'holdingTime', 'expectancy', 'costImpact', 'averageWin', 'averageLoss'],
  },
  swing: {
    id: 'swing',
    labelKo: '스윙 트레이더',
    labelEn: 'Swing trader',
    defaultTimeframe: '4h',
    defaultExitHoldInterval: '4h',
    analysisOrder: ['market', 'execution', 'indicators'],
    journalMetricOrder: ['netReturn', 'netPnl', 'winRate', 'profitFactor', 'holdingTime', 'expectancy', 'averageWin', 'averageLoss', 'costImpact'],
  },
  position: {
    id: 'position',
    labelKo: '포지션 트레이더',
    labelEn: 'Position trader',
    defaultTimeframe: '1d',
    defaultExitHoldInterval: '1d',
    analysisOrder: ['market', 'execution', 'indicators'],
    journalMetricOrder: ['netReturn', 'netPnl', 'holdingTime', 'profitFactor', 'winRate', 'expectancy', 'averageWin', 'averageLoss', 'costImpact'],
  },
  custom: {
    id: 'custom',
    labelKo: '사용자 지정',
    labelEn: 'Custom',
    defaultTimeframe: '4h',
    defaultExitHoldInterval: '4h',
    analysisOrder: STANDARD_ANALYSIS_ORDER,
    journalMetricOrder: STANDARD_METRIC_ORDER,
  },
};

export const TRADING_STYLE_OPTIONS = Object.values(TRADING_STYLE_CONFIGS);

export function isTradingStyle(value: unknown): value is TradingStyle {
  return typeof value === 'string' && value in TRADING_STYLE_CONFIGS;
}

export function tradingStyleLabel(style: TradingStyle, isKo: boolean): string {
  const config = TRADING_STYLE_CONFIGS[style];
  return isKo ? config.labelKo : config.labelEn;
}

