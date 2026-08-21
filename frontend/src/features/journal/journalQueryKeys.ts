export const journalQueryKeys = {
  entries: ['journal'] as const,
  excursions: (startTime: number | null, endTime: number | null) =>
    ['journal-excursions', startTime, endTime] as const,
  qualityAnalysis: (startTime: number | null, endTime: number | null) =>
    ['journal-quality-analysis', startTime, endTime] as const,
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
  ['journal-excursions'],
  ['journal-quality-analysis'],
  ['journal-stop-loss-analysis'],
  ['journal-stop-optimization'],
  ['journal-sl-tp-analysis'],
  ['journal-current-market'],
] as const;
