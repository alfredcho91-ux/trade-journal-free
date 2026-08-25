import type { AnalysisTimeframe, ConditionComparison, IndicatorComparison } from './tradeAnalysis';
import { SampleBadge } from './SampleBadge';
import { wilsonInterval } from './statisticalConfidence';

function value(input: number | null): string {
  return input == null || !Number.isFinite(input) ? '-' : input.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function percent(input: number | null): string {
  return input == null || !Number.isFinite(input) ? '-' : `${input.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

function position(input: number, min: number, max: number): number {
  return Math.min(96, Math.max(4, ((input - min) / Math.max(0.0001, max - min)) * 100));
}

function metricScale(row: IndicatorComparison): { min: number; max: number } {
  if (row.id === 'rsi' || row.id.startsWith('stoch_')) return { min: 0, max: 100 };
  const bound = Math.max(Math.abs(row.winAverage || 0), Math.abs(row.lossAverage || 0), 1) * 1.2;
  return { min: -bound, max: bound };
}

function ciLabel(successes: number, total: number): string | null {
  const interval = wilsonInterval(successes, total);
  return interval ? `95% CI ${interval.low.toFixed(0)}~${interval.high.toFixed(0)}%` : null;
}

function occurrenceRatioLabel(row: ConditionComparison, isKo: boolean): string {
  if (row.occurrenceRatio != null && Number.isFinite(row.occurrenceRatio)) return `${row.occurrenceRatio.toFixed(1)}×`;
  if (row.lossFrequency === 0 && row.winFrequency > 0) return isKo ? '패배군 0%' : '0% in losses';
  return '-';
}

export default function WinLossComparePanel({ rows, conditions, isKo, timeframe, onTimeframeChange, onIndicatorOpen, onConditionOpen }: {
  rows: IndicatorComparison[];
  conditions: ConditionComparison[];
  isKo: boolean;
  timeframe: AnalysisTimeframe;
  onTimeframeChange: (timeframe: AnalysisTimeframe) => void;
  onIndicatorOpen: (row: IndicatorComparison) => void;
  onConditionOpen: (row: ConditionComparison) => void;
}) {
  const validRows = rows.filter((row) => row.winAverage != null && row.lossAverage != null);
  const orderedConditions = [...conditions].sort((left, right) => {
    const leftRatio = left.occurrenceRatio ?? (left.winFrequency > 0 && left.lossFrequency === 0 ? Number.MAX_SAFE_INTEGER : -1);
    const rightRatio = right.occurrenceRatio ?? (right.winFrequency > 0 && right.lossFrequency === 0 ? Number.MAX_SAFE_INTEGER : -1);
    return rightRatio - leftRatio;
  });
  const strongestConditionRatio = Math.max(
    1,
    ...orderedConditions.flatMap((row) => row.occurrenceRatio != null && Number.isFinite(row.occurrenceRatio) ? [row.occurrenceRatio] : []),
  );

  return <section className="border border-dark-700 bg-dark-900/35 p-4 sm:p-5">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div><div className="text-xs font-semibold text-primary-300">{isKo ? '고급 통계 · 승리/패배 비교' : 'Advanced statistics · Win/loss comparison'}</div><h3 className="mt-1.5 text-xl font-semibold text-white">{isKo ? '승리와 패배에서 관찰된 차이' : 'Observed differences between wins and losses'}</h3><p className="mt-1.5 text-xs leading-5 text-dark-400">{isKo ? '진입 직전 완료봉의 지표를 같은 축에서 비교합니다. 차이는 연관성이며 수익의 원인을 뜻하지 않습니다.' : 'Indicators from the last completed candle before entry share one scale. Differences are associations, not causes.'}</p></div>
      <div className="border border-dark-700 bg-dark-950/50 px-3 py-2 text-xs text-dark-400">{isKo ? '진입 직전 완료봉 기준' : 'Last completed candle before entry'}</div>
    </div>
    <div className="mt-4 flex justify-end border-y border-dark-700 py-2.5">
      <div className="grid grid-cols-4 gap-1 border border-dark-700 bg-dark-950/40 p-1">{(['1h', '2h', '4h', '1d'] as AnalysisTimeframe[]).map((item) => <button key={item} type="button" onClick={() => onTimeframeChange(item)} className={`min-h-8 px-3 text-xs font-medium ${timeframe === item ? 'bg-primary-500/20 text-primary-100' : 'text-dark-400 hover:text-white'}`}>{item.toUpperCase()}</button>)}</div>
    </div>

    <div className="mt-5 flex items-start justify-between gap-3"><div><h4 className="text-sm font-semibold text-white">{isKo ? '지표 평균 · 승리군 vs 패배군' : 'Indicator averages · wins vs losses'}</h4><p className="mt-1 text-xs text-dark-500">{isKo ? '각 지표의 승리·패배 평균과 실제 유효 표본 수를 함께 표시합니다.' : 'Each metric shows win/loss averages and exact valid sample counts.'}</p></div><div className="hidden items-center gap-3 text-[11px] text-dark-500 sm:flex"><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-bull" />{isKo ? '승리' : 'Wins'}</span><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-bear" />{isKo ? '패배' : 'Losses'}</span></div></div>
    <div className="mt-3 divide-y divide-dark-700">
      {validRows.map((row) => {
        const scale = metricScale(row);
        const winPosition = position(row.winAverage as number, scale.min, scale.max);
        const lossPosition = position(row.lossAverage as number, scale.min, scale.max);
        const connectorLeft = Math.min(winPosition, lossPosition);
        const connectorWidth = Math.abs(winPosition - lossPosition);
        return <button key={row.id} type="button" onClick={() => onIndicatorOpen(row)} className="grid w-full gap-3 py-3.5 text-left md:grid-cols-[165px_minmax(180px,1fr)_105px_105px_86px] md:items-center">
          <div><div className="text-sm font-semibold text-dark-100">{row.label}</div><div className="mt-1"><SampleBadge count={Math.min(row.winCount, row.lossCount)} isKo={isKo} /></div></div>
          <div className="relative h-9 bg-dark-800/75"><div className="absolute left-3 right-3 top-1/2 h-px -translate-y-1/2 bg-dark-600" /><div className="absolute top-1/2 h-1 -translate-y-1/2 bg-primary-400/45" style={{ left: `${connectorLeft}%`, width: `${connectorWidth}%` }} /><span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dark-900 bg-bull" style={{ left: `${winPosition}%` }} /><span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dark-900 bg-bear" style={{ left: `${lossPosition}%` }} /></div>
          <span className="font-mono text-xs text-bull md:text-right">{isKo ? '승리' : 'Win'} <b className="text-sm">{value(row.winAverage)}</b><small className="ml-1 text-[10px] text-dark-600">n={row.winCount}</small></span>
          <span className="font-mono text-xs text-bear md:text-right">{isKo ? '패배' : 'Loss'} <b className="text-sm">{value(row.lossAverage)}</b><small className="ml-1 text-[10px] text-dark-600">n={row.lossCount}</small></span>
          <span className="text-xs text-primary-200 md:text-right">{isKo ? '거래 보기 →' : 'View →'}</span>
        </button>;
      })}
      {validRows.length === 0 && <div className="py-6 text-center text-sm text-dark-500">{isKo ? '비교할 지표 데이터가 없습니다.' : 'No indicator comparison data is available.'}</div>}
    </div>

    <div className="my-5 h-px bg-dark-700" />
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="text-sm font-semibold text-white">{isKo ? '조건별 승리·패배 발생 비교' : 'Condition occurrence in wins and losses'}</h4><p className="mt-1 text-xs leading-5 text-dark-500">{isKo ? '조건부 승률과 승리군·패배군 내부 발생률을 함께 봅니다. 승리/패배 발생비는 원인이나 미래 승률을 뜻하지 않습니다.' : 'Conditional win rate and within-group occurrence are shown together. The occurrence ratio does not imply causation or future odds.'}</p></div><span className="border border-dark-700 px-2.5 py-1 text-[10px] text-dark-500">{isKo ? '실제 건수 기준' : 'Exact counts'}</span></div>
    <div className="mt-4 space-y-2.5">
      {orderedConditions.map((row) => {
        const ratio = row.occurrenceRatio != null && Number.isFinite(row.occurrenceRatio) ? row.occurrenceRatio : 0;
        const isLowSample = Math.min(row.winCount, row.lossCount) < 15;
        const width = ratio <= 0 ? 0 : Math.max(6, Math.min(100, (ratio / strongestConditionRatio) * 100));
        return <button key={row.id} type="button" onClick={() => onConditionOpen(row)} className="grid w-full gap-2 border-b border-dark-800 py-2.5 text-left sm:grid-cols-[180px_minmax(120px,1fr)_minmax(140px,auto)] sm:items-center">
          <div><div className="text-xs font-medium text-dark-200">{row.label}</div><div className="mt-1"><SampleBadge count={Math.min(row.winCount, row.lossCount)} isKo={isKo} /></div></div>
          <div className="h-2 overflow-hidden bg-dark-800"><div className={`h-full ${isLowSample ? 'bg-amber-300/55' : ratio >= 1 ? 'bg-bull/80' : 'bg-bear/75'}`} style={{ width: `${width}%` }} /></div>
          <div className="flex items-center justify-between gap-3 text-xs sm:block sm:text-right"><span className="font-mono font-semibold text-dark-100">{occurrenceRatioLabel(row, isKo)}</span><span className="text-dark-500 sm:mt-1 sm:block">{isKo ? `조건부 승률 ${percent(row.conditionalWinRate)} · ${row.conditionCount}건` : `Win ${percent(row.conditionalWinRate)} · n=${row.conditionCount}`}</span></div>
        </button>;
      })}
      {orderedConditions.length === 0 && <div className="py-4 text-center text-xs text-dark-500">{isKo ? '비교할 조건 데이터가 없습니다.' : 'No condition comparison data is available.'}</div>}
    </div>
    <details className="mt-5 border border-dark-700 bg-dark-950/25">
      <summary className="cursor-pointer px-3 py-2.5 text-xs font-medium text-dark-300 hover:text-white">{isKo ? '정확한 조건 수치와 근거 거래 보기' : 'View exact condition values and evidence'}</summary>
      <div className="border-t border-dark-700 px-3 pb-3">
    <div className="mt-4 hidden overflow-x-auto md:block">
      <div className="grid min-w-[1060px] grid-cols-[1.55fr_.65fr_1.15fr_1fr_1fr_1.1fr_92px] gap-4 border-b border-dark-700 pb-2 text-xs text-dark-500"><div>{isKo ? '조건' : 'Condition'}</div><div>{isKo ? '충족 거래' : 'Matched'}</div><div>{isKo ? '조건부 승률' : 'Conditional win'}</div><div>{isKo ? '승리군 발생률' : 'Win occurrence'}</div><div>{isKo ? '패배군 발생률' : 'Loss occurrence'}</div><div>{isKo ? '승리/패배 발생비' : 'Win/loss ratio'}</div><div className="text-right">{isKo ? '근거' : 'Evidence'}</div></div>
      {orderedConditions.map((row) => {
        const interval = ciLabel(row.winMatched, row.conditionCount);
        return <div key={row.id} className="grid min-w-[1060px] grid-cols-[1.55fr_.65fr_1.15fr_1fr_1fr_1.1fr_92px] items-center gap-4 border-b border-dark-800 py-3.5 text-sm last:border-b-0">
          <div><div className="font-semibold text-dark-100">{row.label}</div><div className="mt-1"><SampleBadge count={Math.min(row.winCount, row.lossCount)} isKo={isKo} /></div></div>
          <div className="font-mono text-dark-200">{row.conditionCount}</div>
          <div><div className="font-mono text-dark-100">{percent(row.conditionalWinRate)}</div>{interval && <div className="mt-1 text-[10px] text-dark-500">{interval}</div>}</div>
          <div className="font-mono text-bull">{percent(row.winFrequency)} <small className="text-[10px] text-dark-600">{row.winMatched}/{row.winCount}</small></div>
          <div className="font-mono text-bear">{percent(row.lossFrequency)} <small className="text-[10px] text-dark-600">{row.lossMatched}/{row.lossCount}</small></div>
          <div className="font-mono font-semibold text-dark-100">{occurrenceRatioLabel(row, isKo)}</div>
          <div className="text-right"><button type="button" onClick={() => onConditionOpen(row)} className="border border-primary-400/40 px-2 py-1 text-[11px] text-primary-200 hover:border-primary-300 hover:text-white">{isKo ? '거래 보기' : 'View'}</button></div>
        </div>;
      })}
    </div>
    <div className="mt-4 space-y-2 md:hidden">{orderedConditions.map((row) => {
      const interval = ciLabel(row.winMatched, row.conditionCount);
      return <button key={row.id} type="button" onClick={() => onConditionOpen(row)} className="w-full border border-dark-700 bg-dark-950/30 p-3 text-left">
        <div className="flex items-start justify-between gap-2"><div><div className="text-sm font-semibold text-dark-100">{row.label}</div><div className="mt-1"><SampleBadge count={Math.min(row.winCount, row.lossCount)} isKo={isKo} /></div></div><span className="font-mono text-sm text-dark-100">{occurrenceRatioLabel(row, isKo)}</span></div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="text-dark-400">{isKo ? '조건 충족' : 'Matched'} <b className="ml-1 font-mono text-dark-100">{row.conditionCount}</b></div><div className="text-dark-400">{isKo ? '조건부 승률' : 'Conditional win'} <b className="ml-1 font-mono text-dark-100">{percent(row.conditionalWinRate)}</b></div><div className="text-bull">{isKo ? '승리군' : 'Wins'} {percent(row.winFrequency)} <small className="text-dark-600">({row.winMatched}/{row.winCount})</small></div><div className="text-bear">{isKo ? '패배군' : 'Losses'} {percent(row.lossFrequency)} <small className="text-dark-600">({row.lossMatched}/{row.lossCount})</small></div></div>
        {interval && <div className="mt-2 text-[10px] text-dark-500">{isKo ? '조건부 승률' : 'Conditional win'} · {interval}</div>}
        <div className="mt-2 text-xs text-primary-200">{isKo ? `${row.conditionCount}개 근거 거래 보기 →` : `View ${row.conditionCount} trades →`}</div>
      </button>;
    })}</div>
      </div>
    </details>
    <div className="mt-4 border border-dashed border-dark-600 bg-dark-950/30 px-3 py-3 text-xs leading-5 text-dark-500">{isKo ? '95% 신뢰구간은 실제 승리 건수와 조건 충족 거래 수로만 계산합니다. 분포(Q1/Q3)가 없어 박스플롯은 표시하지 않습니다.' : 'The 95% interval uses exact win and matched counts only. Box plots are omitted because Q1/Q3 distribution data is unavailable.'}</div>
  </section>;
}
