export const journalQueryKeys = {
  entries: ['journal'] as const,
  excursions: (startTime: number | null, endTime: number | null) =>
    ['journal-excursions', startTime, endTime] as const,
  performance: (startTime: number | null, endTime: number | null) =>
    ['journal-performance', startTime, endTime] as const,
  qualityAnalysis: (startTime: number | null, endTime: number | null, minAbsNetReturnPct = 0) =>
    ['journal-quality-analysis', startTime, endTime, minAbsNetReturnPct] as const,
  exitHoldAnalysis: (startTime: number | null, endTime: number | null, interval: string, minAbsNetReturnPct = 0) =>
    ['journal-exit-hold-analysis', startTime, endTime, interval, minAbsNetReturnPct] as const,
  behaviorAnalysis: (startTime: number | null, endTime: number | null, minAbsNetReturnPct = 0) =>
    ['journal-behavior-analysis', startTime, endTime, minAbsNetReturnPct] as const,
  behaviorRules: ['journal-behavior-rules'] as const,
  stopLossAnalysis: (startTime: number | null, endTime: number | null) =>
    ['journal-stop-loss-analysis', startTime, endTime] as const,
  stopOptimization: (startTime: number | null, endTime: number | null) =>
    ['journal-stop-optimization', startTime, endTime] as const,
  slTpAnalysis: (
    startTime: number,
    endTime: number,
    slMin: number,
    slMax: number,
    slStep: number,
    tpMin: number,
    tpMax: number,
    tpStep: number,
  ) => ['journal-sl-tp-analysis', startTime, endTime, slMin, slMax, slStep, tpMin, tpMax, tpStep] as const,
  currentMarket: (coin: string) => ['journal-current-market', coin] as const,
};

export const journalDerivedQueryPrefixes = [
  ['journal-performance'],
  ['journal-excursions'],
  ['journal-quality-analysis'],
  ['journal-exit-hold-analysis'],
  ['journal-behavior-analysis'],
  ['journal-behavior-rules'],
  ['journal-stop-loss-analysis'],
  ['journal-stop-optimization'],
  ['journal-sl-tp-analysis'],
  ['journal-current-market'],
] as const;
