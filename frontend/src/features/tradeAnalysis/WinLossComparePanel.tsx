import type { ConditionComparison, IndicatorComparison, AnalysisTimeframe } from './tradeAnalysis';
import { SampleBadge } from './SampleBadge';

function value(value: number | null): string {
  return value == null || !Number.isFinite(value) ? '-' : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function percent(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

function position(value: number, min: number, max: number): string {
  return `${Math.min(94, Math.max(6, ((value - min) / Math.max(0.0001, max - min)) * 100))}%`;
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
  const orderedConditions = [...conditions].sort((left, right) => (right.lift ?? -Infinity) - (left.lift ?? -Infinity));

  return <section className="rounded-2xl border border-dark-700 bg-dark-900/35 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.12)] sm:p-6">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div><div className="text-xs font-semibold tracking-[0.12em] text-primary-300">{isKo ? '고급 통계 · 승리/패배 평균값 비교' : 'Advanced statistics · Win/loss comparison'}</div><h3 className="mt-2 text-2xl font-semibold tracking-tight text-white">{isKo ? '승리와 패배를 가른 차이를 봅니다.' : 'See what separated wins from losses.'}</h3><p className="mt-2 text-sm leading-6 text-dark-400">{isKo ? '승리군과 패배군을 같은 기준에서 비교하고 실제 근거 거래까지 확인합니다.' : 'Compare winning and losing groups on the same basis and inspect the supporting trades.'}</p></div>
      <div className="rounded-xl border border-dark-700 bg-dark-950/50 px-3 py-2 text-xs text-dark-400">{isKo ? '지표는 진입 직전 완료봉 기준' : 'Indicators use the last completed candle before entry'}</div>
    </div>
    <div className="mt-5 flex justify-end border-y border-dark-700 py-3">
      <div className="grid grid-cols-4 gap-1 border border-dark-700 bg-dark-950/40 p-1">{(['1h', '2h', '4h', '1d'] as AnalysisTimeframe[]).map((item) => <button key={item} type="button" onClick={() => onTimeframeChange(item)} className={`min-h-9 px-3 text-xs font-medium ${timeframe === item ? 'bg-primary-500/20 text-primary-100' : 'text-dark-400 hover:text-white'}`}>{item.toUpperCase()}</button>)}</div>
    </div>

    <div className="mt-5 flex items-start justify-between gap-3"><div><h4 className="text-base font-semibold text-white">{isKo ? '지표 평균 · 승리군 vs 패배군' : 'Indicator averages · wins vs losses'}</h4><p className="mt-1 text-xs text-dark-500">{isKo ? '각 지표 안에서 초록 점은 승리 평균, 빨간 점은 패배 평균입니다.' : 'Green is the win average and red is the loss average within each metric.'}</p></div><div className="hidden items-center gap-3 text-[11px] text-dark-500 sm:flex"><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-bull" />{isKo ? '승리군' : 'Wins'}</span><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-bear" />{isKo ? '패배군' : 'Losses'}</span></div></div>
    <div className="mt-3 divide-y divide-dark-700">
      {validRows.map((row) => {
        const low = Math.min(row.winAverage as number, row.lossAverage as number);
        const high = Math.max(row.winAverage as number, row.lossAverage as number);
        const span = Math.max(high - low, Math.max(Math.abs(high), Math.abs(low), 1) * 0.22);
        const min = low - span * 0.4;
        const max = high + span * 0.4;
        return <button key={row.id} type="button" onClick={() => onIndicatorOpen(row)} className="grid w-full gap-3 py-4 text-left md:grid-cols-[170px_minmax(160px,1fr)_75px_75px_90px] md:items-center">
          <div className="text-sm font-semibold text-dark-100">{row.label}<div className="mt-1"><SampleBadge count={Math.min(row.winCount, row.lossCount)} isKo={isKo} /></div></div>
          <div className="relative h-8 rounded-full bg-dark-800"><div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-dark-600" /><span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dark-900 bg-bull" style={{ left: position(row.winAverage as number, min, max) }} /><span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dark-900 bg-bear" style={{ left: position(row.lossAverage as number, min, max) }} /></div>
          <span className="font-mono text-sm text-bull md:text-right">{value(row.winAverage)}</span><span className="font-mono text-sm text-bear md:text-right">{value(row.lossAverage)}</span><span className="text-xs text-primary-200 md:text-right">{isKo ? '거래 보기 →' : 'View →'}</span>
        </button>;
      })}
      {validRows.length === 0 && <div className="py-6 text-center text-sm text-dark-500">{isKo ? '비교할 지표 데이터가 없습니다.' : 'No indicator comparison data is available.'}</div>}
    </div>

    <div className="my-5 h-px bg-dark-700" />
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="text-base font-semibold text-white">{isKo ? '승리군에서 더 자주 나타난 조건' : 'Conditions more common in wins'}</h4><p className="mt-1 text-xs text-dark-500">{isKo ? '발생률 차이와 리프트를 함께 봅니다. 조건은 연관성이지 원인 증명이 아닙니다.' : 'Frequency difference and lift are shown together. Conditions are associations, not causal proof.'}</p></div><span className="rounded-full border border-dark-700 px-2.5 py-1 text-[10px] text-dark-500">{isKo ? '근거 거래 연결' : 'Evidence linked'}</span></div>
    <div className="mt-4 hidden overflow-x-auto md:block"><div className="grid min-w-[760px] grid-cols-[2fr_1fr_1fr_.75fr_.75fr_100px] gap-4 border-b border-dark-700 pb-2 text-xs text-dark-500"><div>{isKo ? '조건' : 'Condition'}</div><div>{isKo ? '승리군 발생률' : 'Win frequency'}</div><div>{isKo ? '패배군 발생률' : 'Loss frequency'}</div><div>{isKo ? '차이' : 'Difference'}</div><div>{isKo ? '리프트' : 'Lift'}</div><div className="text-right">{isKo ? '근거' : 'Evidence'}</div></div>{orderedConditions.map((row) => <div key={row.id} className="grid min-w-[760px] grid-cols-[2fr_1fr_1fr_.75fr_.75fr_100px] items-center gap-4 border-b border-dark-800 py-4 text-sm last:border-b-0"><div className="font-semibold text-dark-100">{row.label}<span className="ml-2 text-[10px] font-normal text-dark-600">{row.winMatched}/{row.winCount} · {row.lossMatched}/{row.lossCount}</span></div><div className="font-mono text-bull">{percent(row.winFrequency)}</div><div className="font-mono text-bear">{percent(row.lossFrequency)}</div><div className="font-mono text-bull">{row.difference >= 0 ? '+' : ''}{percent(row.difference)}</div><div className="font-mono font-semibold text-bull">{row.lift == null ? '-' : `${row.lift.toFixed(1)}×`}</div><div className="flex justify-end gap-2"><SampleBadge count={Math.min(row.winCount, row.lossCount)} isKo={isKo} /><button type="button" onClick={() => onConditionOpen(row)} className="rounded-lg border border-primary-400/40 px-2 py-1 text-[11px] text-primary-200 hover:border-primary-300 hover:text-white">{isKo ? '거래 보기' : 'View'}</button></div></div>)}</div>
    <div className="mt-4 space-y-2 md:hidden">{orderedConditions.map((row) => <button key={row.id} type="button" onClick={() => onConditionOpen(row)} className="w-full border border-dark-700 bg-dark-950/30 p-3 text-left"><div className="flex justify-between gap-2 text-sm font-semibold text-dark-100"><span>{row.label}</span><span className="text-bull">{row.lift == null ? '-' : `${row.lift.toFixed(1)}×`}</span></div><div className="mt-2 flex flex-wrap items-center gap-3 text-xs"><span className="text-bull">{isKo ? '승리' : 'Win'} {percent(row.winFrequency)}</span><span className="text-bear">{isKo ? '패배' : 'Loss'} {percent(row.lossFrequency)}</span><span className="text-dark-400">{isKo ? '차이' : 'Diff'} {row.difference >= 0 ? '+' : ''}{percent(row.difference)}</span><SampleBadge count={Math.min(row.winCount, row.lossCount)} isKo={isKo} /></div><div className="mt-2 text-xs text-primary-200">{isKo ? `${row.winMatched + row.lossMatched}개 근거 거래 보기 →` : `View ${row.winMatched + row.lossMatched} trades →`}</div></button>)}</div>
    <div className="mt-4 rounded-xl border border-dashed border-dark-600 bg-dark-950/30 px-3 py-3 text-xs leading-5 text-dark-500">{isKo ? '신뢰도: 충분은 양쪽 유효 표본이 충분함, 보통은 해석 시 주의, 부족은 과해석을 피해야 함을 뜻합니다.' : 'Confidence: strong means enough valid samples, medium needs caution, and low should not be overinterpreted.'}</div>
  </section>;
}
