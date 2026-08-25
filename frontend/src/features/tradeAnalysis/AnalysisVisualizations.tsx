import { useMemo, useState } from 'react';

import type {
  JournalQualityAnalysisData,
  TradeQualityHoldAggregate,
  TradeQualityRegime,
} from '../../types';
import type { AnalyzedTrade } from './tradeAnalysis';
import { SampleBadge } from './SampleBadge';

type Direction = 'Long' | 'Short';
type HeatmapMetric = 'average_pnl' | 'win_rate' | 'profit_factor' | 'average_r' | 'average_mae';

const REGIME_LABELS: Record<string, string> = {
  aligned_up: '주·일·4H 강한 상승 정렬',
  aligned_down: '주·일·4H 강한 하락 정렬',
  higher_up_4h_reentry: '상위 상승 추세로 4H 재전환',
  higher_down_4h_reentry: '상위 하락 추세로 4H 재전환',
  higher_up_4h_pullback: '상위 상승 추세 내 4H 조정',
  higher_down_4h_pullback: '상위 하락 추세 내 4H 반등',
  weekly_sideways_mid_up: '주봉 횡보·일/4H 상승',
  weekly_sideways_mid_down: '주봉 횡보·일/4H 하락',
  weekly_up_mid_down_conflict: '주봉 상승·일/4H 하락 충돌',
  weekly_down_mid_up_conflict: '주봉 하락·일/4H 상승 충돌',
  weekly_up_mid_sideways_conflict: '주봉 상승·일/4H 횡보 충돌',
  weekly_down_mid_sideways_conflict: '주봉 하락·일/4H 횡보 충돌',
  mixed: '혼합 추세',
  unavailable: '추세 확인 불가',
};

function number(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function signed(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${number(value, digits)}`;
}

function regimeLabel(id: string, isKo: boolean): string {
  return isKo ? REGIME_LABELS[id] || id : id.replace(/_/g, ' ');
}

function exitIntervalLabel(interval: '15m' | '1h' | '2h' | '4h' | '1d', isKo: boolean): string {
  if (isKo) return ({ '15m': '15분봉', '1h': '1시간봉', '2h': '2시간봉', '4h': '4시간봉', '1d': '일봉' } as const)[interval];
  return interval.toUpperCase();
}

function holdLabel(id: string, isKo: boolean, interval?: '15m' | '1h' | '2h' | '4h' | '1d'): string {
  if (isKo) return id === 'actual' ? '실제 청산' : `청산 후 +${id}개 봉`;
  if (id === 'actual') return 'Actual exit';
  return interval ? `After +${id} ${interval.toUpperCase()} candle${id === '1' ? '' : 's'}` : `After +${id} candles`;
}

function holdAxisLabel(id: string, isKo: boolean): string {
  if (id === 'actual') return isKo ? '실제 청산' : 'Actual';
  return isKo ? `+${id}봉` : `+${id}`;
}

function heatTone(score: number | null, intensity: number): React.CSSProperties {
  if (score == null || !Number.isFinite(score)) return {};
  const alpha = 0.06 + Math.min(0.25, Math.max(0, intensity) * 0.23);
  return score >= 0
    ? { backgroundColor: `rgba(52, 211, 153, ${alpha})`, borderColor: `rgba(52, 211, 153, ${0.18 + intensity * 0.3})` }
    : { backgroundColor: `rgba(251, 113, 133, ${alpha})`, borderColor: `rgba(251, 113, 133, ${0.18 + intensity * 0.3})` };
}

function metricDefinition(metric: HeatmapMetric, isKo: boolean): {
  label: string;
  value: (regime: TradeQualityRegime) => number | null | undefined;
  display: (value: number | null | undefined) => string;
  score: (value: number) => number;
} {
  switch (metric) {
    case 'win_rate':
      return { label: isKo ? '승률' : 'Win rate', value: (row) => row.win_rate_pct, display: (value) => `${number(value, 1)}%`, score: (value) => value - 50 };
    case 'profit_factor':
      return { label: 'PF', value: (row) => row.profit_factor, display: (value) => number(value, 2), score: (value) => value - 1 };
    case 'average_r':
      return { label: isKo ? '평균 R' : 'Average R', value: (row) => row.average_r, display: (value) => signed(value), score: (value) => value };
    case 'average_mae':
      return { label: isKo ? '평균 최대 불리 움직임' : 'Average adverse move', value: (row) => row.average_mae_pct, display: (value) => `-${number(Math.abs(value || 0))}%`, score: (value) => -Math.abs(value) };
    default:
      return { label: isKo ? '평균 PnL' : 'Average PnL', value: (row) => row.average_pnl, display: (value) => `${signed(value)} USDT`, score: (value) => value };
  }
}

export function RegimeDirectionHeatmap({
  data,
  isKo,
  onOpenEvidence,
}: {
  data?: JournalQualityAnalysisData;
  isKo: boolean;
  onOpenEvidence: (regimeId: string, direction: Direction, journalIds: number[]) => void;
}) {
  const [metric, setMetric] = useState<HeatmapMetric>('average_pnl');
  const definition = metricDefinition(metric, isKo);
  const rows = useMemo(() => {
    if (!data) return [];
    const regimes = new Map<string, TradeQualityRegime>();
    (['Long', 'Short'] as Direction[]).forEach((direction) => {
      data.direction_breakdown[direction].regimes.forEach((regime) => regimes.set(regime.id, regime));
    });
    return [...regimes.keys()].sort((left, right) => {
      const leftCount = Math.max(
        data.direction_breakdown.Long.regimes.find((item) => item.id === left)?.trade_count || 0,
        data.direction_breakdown.Short.regimes.find((item) => item.id === left)?.trade_count || 0,
      );
      const rightCount = Math.max(
        data.direction_breakdown.Long.regimes.find((item) => item.id === right)?.trade_count || 0,
        data.direction_breakdown.Short.regimes.find((item) => item.id === right)?.trade_count || 0,
      );
      return rightCount - leftCount || left.localeCompare(right);
    });
  }, [data]);
  const scores = useMemo(() => rows.flatMap((id) => (
    (['Long', 'Short'] as Direction[]).flatMap((direction) => {
      const regime = data?.direction_breakdown[direction].regimes.find((item) => item.id === id);
      const value = regime ? definition.value(regime) : null;
      return value != null && Number.isFinite(value) ? [definition.score(value)] : [];
    })
  )), [data, definition, rows]);
  const maxScore = Math.max(1, ...scores.map((value) => Math.abs(value)));

  if (!data) return null;
  return (
    <section className="border border-dark-700 bg-dark-950/25 p-4 sm:p-5" aria-label={isKo ? '시장 상황과 방향별 성과 히트맵' : 'Market regime and direction heatmap'}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">{isKo ? '시장 상황 × 방향 성과' : 'Market regime × direction performance'}</h3>
          <p className="mt-1 text-xs text-dark-500">{isKo ? '같은 기간의 LONG과 SHORT를 나란히 비교합니다. 셀을 누르면 해당 근거 거래를 엽니다.' : 'Compare Long and Short in the same period. Select a cell to open its supporting trades.'}</p>
        </div>
        <label className="text-[11px] text-dark-400">
          {isKo ? '기준' : 'Metric'}
          <select value={metric} onChange={(event) => setMetric(event.target.value as HeatmapMetric)} className="ml-2 border border-dark-700 bg-dark-900 px-2 py-1.5 text-xs text-dark-200">
            {(['average_pnl', 'win_rate', 'profit_factor', 'average_r', 'average_mae'] as HeatmapMetric[]).map((item) => <option key={item} value={item}>{metricDefinition(item, isKo).label}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[600px]">
          <div className="grid grid-cols-[minmax(220px,1.6fr)_minmax(150px,1fr)_minmax(150px,1fr)] gap-2 px-1 pb-2 text-[11px] text-dark-500"><div>{isKo ? '시장 상황' : 'Market regime'}</div><div className="text-center">LONG</div><div className="text-center">SHORT</div></div>
          <div className="space-y-2">
            {rows.map((id) => (
              <div key={id} className="grid grid-cols-[minmax(220px,1.6fr)_minmax(150px,1fr)_minmax(150px,1fr)] gap-2">
                <div className="flex items-center px-2 text-xs text-dark-300" title={regimeLabel(id, isKo)}>{regimeLabel(id, isKo)}</div>
                {(['Long', 'Short'] as Direction[]).map((direction) => {
                  const regime = data.direction_breakdown[direction].regimes.find((item) => item.id === id);
                  const value = regime ? definition.value(regime) : null;
                  const score = value != null && Number.isFinite(value) ? definition.score(value) : null;
                  const ids = data.items.filter((item) => item.direction === direction && item.market_regime.id === id).map((item) => item.journal_id);
                  return <button
                    key={direction}
                    type="button"
                    disabled={!regime || ids.length === 0}
                    onClick={() => onOpenEvidence(id, direction, ids)}
                    style={heatTone(score, score == null ? 0 : Math.abs(score) / maxScore)}
                    className="min-h-[62px] border px-3 py-2 text-center transition-colors disabled:cursor-default disabled:border-dark-800 disabled:bg-dark-900/30"
                    title={regime ? `${regimeLabel(id, isKo)} · ${direction} · ${regime.trade_count}${isKo ? '건' : ' trades'} · ${isKo ? '승률' : 'Win'} ${number(regime.win_rate_pct, 1)}% · PF ${number(regime.profit_factor, 2)} · PnL ${signed(regime.average_pnl)} USDT` : undefined}
                  >
                    <div className={`font-mono text-sm font-semibold ${score == null ? 'text-dark-500' : score >= 0 ? 'text-bull' : 'text-bear'}`}>{regime ? definition.display(value) : '-'}</div>
                    {regime && <div className="mt-1 flex items-center justify-center gap-1.5 text-[10px] text-dark-400"><span>n={regime.trade_count}</span><SampleBadge count={regime.trade_count} isKo={isKo} /></div>}
                  </button>;
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-dark-500">{isKo ? '색 농도는 현재 표 전체에서 같은 기준으로 계산합니다. 표본 부족은 색과 함께 텍스트로 표시됩니다.' : 'Color intensity is normalized across the visible table. Low samples remain explicitly labeled.'}</p>
    </section>
  );
}

export function ExitTimingCurve({
  rows,
  isKo,
  interval,
  onIntervalChange,
  onOpenEvidence,
  isLoading = false,
}: {
  rows: Array<{ id: string } & TradeQualityHoldAggregate>;
  isKo: boolean;
  interval: '15m' | '1h' | '2h' | '4h' | '1d';
  onIntervalChange: (interval: '15m' | '1h' | '2h' | '4h' | '1d') => void;
  onOpenEvidence: (holdId: string) => void;
  isLoading?: boolean;
}) {
  const intervals: Array<{ id: typeof interval; label: string }> = [
    { id: '15m', label: isKo ? '15분' : '15m' },
    { id: '1h', label: isKo ? '1시간' : '1H' },
    { id: '2h', label: isKo ? '2시간' : '2H' },
    { id: '4h', label: isKo ? '4시간' : '4H' },
    { id: '1d', label: isKo ? '1일' : '1D' },
  ];
  const holdIds = ['actual', ...Array.from({ length: 10 }, (_, index) => String(index + 1))];
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const allRows = holdIds.map((id) => rowsById.get(id) || {
    id,
    available_count: 0,
    average_return_pct: null,
    average_r: null,
    r_sample_count: 0,
  });
  const available = allRows.filter((row) => row.average_return_pct != null && Number.isFinite(row.average_return_pct)) as Array<{ id: string } & TradeQualityHoldAggregate & { average_return_pct: number }>;
  const [selectedId, setSelectedId] = useState<string>('actual');
  const selected = available.find((row) => row.id === selectedId) || available[0];
  if (available.length === 0) {
    return <section className="border border-dark-700 bg-dark-950/25 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-white">{isKo ? '청산 후 보유 결과' : 'Results after holding beyond exit'}</h3><p className="mt-1 text-xs text-dark-500">{isKo ? '선택한 완료봉 기준으로 실제 청산 이후 결과를 복기합니다.' : 'Replay results after the recorded exit with the selected completed-candle interval.'}</p></div><ExitIntervalSelector intervals={intervals} interval={interval} onIntervalChange={onIntervalChange} /></div>
      <div className="mt-5 flex min-h-24 items-center justify-center border border-dark-800 bg-dark-900/30 text-xs text-dark-500">{isLoading ? (isKo ? '청산 후 보유 결과를 계산하는 중입니다.' : 'Calculating post-exit holding results.') : (isKo ? '표시할 청산 후 보유 결과가 없습니다.' : 'No post-exit holding results are available.')}</div>
    </section>;
  }

  const values = available.map((row) => row.average_return_pct as number);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = Math.max(0.25, max - min);
  const chartWidth = 800;
  const chartHeight = 320;
  const left = 52;
  const right = 24;
  const top = 22;
  const bottom = 64;
  const width = chartWidth - left - right;
  const height = chartHeight - top - bottom;
  const point = (row: typeof available[number]) => ({
    x: row.id === 'actual' ? left : left + (Number(row.id) / 10) * width,
    y: top + ((max - (row.average_return_pct as number)) / range) * height,
  });
  const points = available.map(point);
  const actual = available.find((row) => row.id === 'actual');
  const actualValue = actual?.average_return_pct ?? null;
  const best = available.reduce((currentBest, row) => (
    row.average_return_pct > currentBest.average_return_pct ? row : currentBest
  ));
  const selectedDelta = selected?.average_return_pct != null && actualValue != null ? selected.average_return_pct - actualValue : null;
  const bestDelta = actualValue != null ? best.average_return_pct - actualValue : null;
  const isBestActual = best.id === 'actual';
  const intervalLabel = exitIntervalLabel(interval, isKo);
  const conclusion = isBestActual
    ? (isKo ? '현재 표본에서는 실제 청산 시점의 평균 결과가 가장 좋았습니다.' : 'The recorded exit had the best average result in the current sample.')
    : (isKo
      ? `평균적으로 실제 청산보다 ${holdLabel(best.id, true)}까지 보유했을 때 수익률이 ${signed(bestDelta)}%p 더 높았습니다.`
      : `On average, holding until ${holdLabel(best.id, false, interval)} was ${signed(bestDelta)} percentage points better than the recorded exit.`);
  const zeroY = top + ((max - 0) / range) * height;

  return <section className="border border-dark-700 bg-dark-950/25 p-4 sm:p-5" aria-label={isKo ? '청산 시점별 추가 보유 결과' : 'Exit timing additional holding curve'}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-white">{isKo ? '청산 후 보유 결과' : 'Results after holding beyond exit'}</h3><span className="border border-dark-700 bg-dark-900/50 px-2 py-1 text-[10px] text-dark-400">{isKo ? '선택 기간 전체 평균' : 'Selected-period average'}</span></div><p className="mt-1 text-xs text-dark-500">{isKo ? `현재 ${intervalLabel} 기준입니다. 선택 기간의 거래들을 실제 청산과 비교해 조금 더 보유했을 때의 평균 가격 수익률을 복기합니다.` : `Uses ${intervalLabel} candles to compare the selected period's average recorded exit with holding the same trades longer.`}</p></div><ExitIntervalSelector intervals={intervals} interval={interval} onIntervalChange={onIntervalChange} /></div>
    <div className="mt-4 border-l-2 border-primary-400/70 bg-primary-500/5 px-3 py-3 text-sm font-medium text-primary-100">{conclusion}</div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <div className="border border-amber-300/35 bg-amber-300/5 px-3 py-2.5"><div className="text-[10px] text-dark-500">{isKo ? '실제 청산 평균 수익률' : 'Recorded exit average'}</div><div className={`mt-1 font-mono text-lg font-semibold ${(actualValue || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{signed(actualValue)}%</div></div>
      <div className="border border-primary-400/35 bg-primary-500/5 px-3 py-2.5"><div className="text-[10px] text-dark-500">{isKo ? '가장 결과가 좋았던 관찰 지점' : 'Best observed point'}</div><div className="mt-1 text-xs font-semibold text-dark-100">{holdLabel(best.id, isKo, interval)}</div><div className={`mt-1 font-mono text-lg font-semibold ${(best.average_return_pct || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{signed(best.average_return_pct)}%</div></div>
      <div className="border border-dark-700 bg-dark-900/35 px-3 py-2.5"><div className="text-[10px] text-dark-500">{isKo ? '실제 청산 대비 차이' : 'Difference vs recorded exit'}</div><div className={`mt-2 font-mono text-lg font-semibold ${(bestDelta || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{bestDelta == null ? '-' : `${signed(bestDelta)}%p`}</div></div>
      <div className="border border-dark-700 bg-dark-900/35 px-3 py-2.5"><div className="text-[10px] text-dark-500">{isKo ? '비교 표본' : 'Comparison sample'}</div><div className="mt-2"><SampleBadge count={actual?.available_count ?? best.available_count} isKo={isKo} /></div></div>
    </div>
    <div className="mt-5 overflow-x-auto"><svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="min-w-[600px] w-full" role="img" aria-label={isKo ? '실제 청산과 청산 후 보유 결과 선 그래프' : 'Line graph comparing recorded exit and holding beyond exit'}>
      <line x1={left} x2={chartWidth - right} y1={zeroY} y2={zeroY} stroke="currentColor" className="text-dark-700" strokeDasharray="4 4" />
      {[min, (min + max) / 2, max].map((value) => { const y = top + ((max - value) / range) * height; return <g key={value}><line x1={left} x2={chartWidth - right} y1={y} y2={y} stroke="currentColor" className="text-dark-800" /><text x={left - 8} y={y + 4} textAnchor="end" className="fill-dark-500 text-[11px]">{signed(value)}%</text></g>; })}
      <polyline fill="none" stroke="#60a5fa" strokeWidth="2.25" points={points.map((item) => `${item.x},${item.y}`).join(' ')} />
      {allRows.map((row) => {
        const x = row.id === 'actual' ? left : left + (Number(row.id) / 10) * width;
        return <text key={`axis-${row.id}`} x={x} y={chartHeight - 26} textAnchor="middle" className={`text-[11px] ${row.available_count > 0 ? 'fill-dark-400' : 'fill-dark-600'}`}>{holdAxisLabel(row.id, isKo)}</text>;
      })}
      {available.map((row, index) => {
        const current = points[index];
        const isActual = row.id === 'actual';
        const isBest = row.id === best.id;
        const chosen = selected?.id === row.id;
        const label = holdLabel(row.id, isKo, interval);
        const delta = actualValue != null ? row.average_return_pct - actualValue : null;
        return <g key={row.id} tabIndex={0} role="button" aria-label={`${label}: ${signed(row.average_return_pct)}%, ${isKo ? '실제 청산 대비' : 'vs recorded exit'} ${delta == null ? '-' : `${signed(delta)}%p`}, n=${row.available_count}`} onFocus={() => setSelectedId(row.id)} onClick={() => { setSelectedId(row.id); onOpenEvidence(row.id); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(row.id); onOpenEvidence(row.id); } }} className="cursor-pointer outline-none"><title>{`${label}\n${isKo ? '평균 수익률' : 'Average return'} ${signed(row.average_return_pct)}%\n${isKo ? '실제 청산 대비' : 'vs recorded exit'} ${delta == null ? '-' : `${signed(delta)}%p`}\nn=${row.available_count}\n${isKo ? '누르면 해당 거래 보기' : 'Select to view trades'}`}</title>{isBest && <circle cx={current.x} cy={current.y} r={10} fill="none" stroke="#a78bfa" strokeWidth="2" strokeDasharray="3 2" />}<circle cx={current.x} cy={current.y} r={chosen ? 7 : 5.5} fill={isActual ? '#fbbf24' : isBest ? '#a78bfa' : '#60a5fa'} stroke="#0b1220" strokeWidth="3" />{isActual && <text x={current.x} y={current.y - 16} textAnchor="middle" className="fill-amber-200 text-[10px] font-semibold">{isKo ? '실제 청산' : 'Recorded exit'}</text>}{isBest && !isActual && <text x={current.x} y={current.y - 16} textAnchor="middle" className="fill-primary-200 text-[10px] font-semibold">{isKo ? '가장 좋았던 지점' : 'Best observed'}</text>}</g>;
      })}
    </svg></div>
    {selected && <div className="mt-4 grid gap-2 border-t border-dark-700 pt-3 text-xs sm:grid-cols-4"><div><span className="text-dark-500">{isKo ? '선택 시점' : 'Point'}</span><b className="ml-2 text-dark-100">{holdLabel(selected.id, isKo, interval)}</b></div><div><span className="text-dark-500">{isKo ? '평균 수익률' : 'Average return'}</span><b className={`ml-2 font-mono ${(selected.average_return_pct || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{signed(selected.average_return_pct)}%</b></div><div><span className="text-dark-500">{isKo ? '실제 청산 대비' : 'vs recorded exit'}</span><b className={`ml-2 font-mono ${(selectedDelta || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{selectedDelta == null ? '-' : `${signed(selectedDelta)}%p`}</b></div><div><span className="text-dark-500">{isKo ? '표본' : 'Sample'}</span><b className="ml-2 font-mono text-dark-100">n={selected.available_count}</b></div></div>}
    <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden border border-dark-700 bg-dark-700 sm:grid-cols-4 xl:grid-cols-6">
      {allRows.map((row) => <button type="button" key={`result-${row.id}`} disabled={row.available_count === 0} onClick={() => onOpenEvidence(row.id)} className="bg-dark-950/80 px-3 py-2.5 text-left transition-colors hover:bg-primary-500/10 disabled:cursor-default disabled:hover:bg-dark-950/80"><div className="text-[10px] text-dark-500">{holdLabel(row.id, isKo, interval)}{row.id !== 'actual' && <span className="ml-1 text-dark-600">({intervalLabel})</span>}</div><div className={`mt-1 font-mono text-sm font-semibold ${row.average_return_pct == null ? 'text-dark-600' : row.average_return_pct >= 0 ? 'text-bull' : 'text-bear'}`}>{row.average_return_pct == null ? (isKo ? '데이터 부족' : 'Unavailable') : `${signed(row.average_return_pct)}%`}</div><div className="mt-1 text-[10px] text-dark-600">n={row.available_count}{row.available_count > 0 ? (isKo ? ' · 거래 보기' : ' · View trades') : ''}</div></button>)}
    </div>
    <p className="mt-3 text-[11px] text-dark-500">{isKo ? `선택한 ${intervals.find((item) => item.id === interval)?.label} 완료봉으로 계산한 사후 복기입니다. 점이나 결과 칸을 누르면 해당 거래를 확인할 수 있으며, 미래를 아는 청산 추천 신호가 아닙니다.` : `This is a post-trade review using completed ${interval} candles. Select a point or result to view its trades; it is not a future-aware exit recommendation.`}</p>
  </section>;
}

function ExitIntervalSelector({
  intervals,
  interval,
  onIntervalChange,
}: {
  intervals: Array<{ id: '15m' | '1h' | '2h' | '4h' | '1d'; label: string }>;
  interval: '15m' | '1h' | '2h' | '4h' | '1d';
  onIntervalChange: (interval: '15m' | '1h' | '2h' | '4h' | '1d') => void;
}) {
  return <div className="flex border border-dark-700 bg-dark-900/45" aria-label="Exit holding interval">
    {intervals.map((item) => <button key={item.id} type="button" onClick={() => onIntervalChange(item.id)} className={`min-h-8 px-2 text-[10px] font-medium transition-colors sm:px-2.5 sm:text-xs ${interval === item.id ? 'bg-primary-500/20 text-primary-100' : 'text-dark-400 hover:text-white'}`}>{item.label}</button>)}
  </div>;
}

export function EntryMovementComparison({
  trades,
  isKo,
  onOpenEvidence,
}: {
  trades: AnalyzedTrade[];
  isKo: boolean;
  onOpenEvidence: (kind: 'win' | 'loss', journalIds: number[]) => void;
}) {
  const validTrades = useMemo(() => trades.flatMap((trade) => {
    const mfe = trade.excursion?.mfe_pct;
    const mae = trade.excursion?.mae_pct;
    const pnl = trade.entry.realized_pnl;
    if (mfe == null || mae == null || pnl == null || !Number.isFinite(mfe) || !Number.isFinite(mae) || !Number.isFinite(pnl) || pnl === 0 || trade.entry.id == null) return [];
    return [{ trade, mfe, mae: Math.abs(mae), pnl }];
  }), [trades]);
  const winners = validTrades.filter((item) => item.pnl > 0);
  const losers = validTrades.filter((item) => item.pnl < 0);
  const aggregate = (items: typeof validTrades) => ({
    count: items.length,
    averageFavorable: items.length === 0 ? null : items.reduce((sum, item) => sum + item.mfe, 0) / items.length,
    averageAdverse: items.length === 0 ? null : items.reduce((sum, item) => sum + item.mae, 0) / items.length,
    ids: items.map((item) => item.trade.entry.id as number),
  });
  const win = aggregate(winners);
  const loss = aggregate(losers);
  const maxValue = Math.max(1, win.averageFavorable || 0, win.averageAdverse || 0, loss.averageFavorable || 0, loss.averageAdverse || 0) * 1.12;
  const hasBothGroups = win.count > 0 && loss.count > 0;
  const conclusion = !hasBothGroups
    ? (isKo ? '승리와 손실 거래가 모두 있어야 진입 후 움직임 차이를 비교할 수 있습니다.' : 'Both winning and losing trades are required to compare post-entry movement.')
    : (loss.averageAdverse ?? 0) > (win.averageAdverse ?? 0)
      ? (isKo ? '손실 거래는 수익 거래보다 진입 후 평균 불리 움직임이 더 컸습니다.' : 'Losing trades experienced a larger average adverse move after entry than winning trades.')
      : (win.averageFavorable ?? 0) > (loss.averageFavorable ?? 0)
        ? (isKo ? '수익 거래는 손실 거래보다 진입 후 평균 유리 움직임이 더 컸습니다.' : 'Winning trades had a larger average favorable move after entry than losing trades.')
        : (isKo ? '현재 표본에서는 승리와 손실 거래의 진입 후 움직임 차이가 뚜렷하지 않습니다.' : 'The current sample does not show a clear post-entry movement difference between wins and losses.');
  const rows = [
    { id: 'win-favorable', group: isKo ? '수익 거래' : 'Winning trades', kind: 'win' as const, label: isKo ? '평균 최대 유리 움직임' : 'Average favorable move', value: win.averageFavorable, count: win.count, ids: win.ids, tone: 'bg-bull/80', textTone: 'text-bull' },
    { id: 'win-adverse', group: isKo ? '수익 거래' : 'Winning trades', kind: 'win' as const, label: isKo ? '평균 최대 불리 움직임' : 'Average adverse move', value: win.averageAdverse, count: win.count, ids: win.ids, tone: 'bg-bull/35', textTone: 'text-bull' },
    { id: 'loss-favorable', group: isKo ? '손실 거래' : 'Losing trades', kind: 'loss' as const, label: isKo ? '평균 최대 유리 움직임' : 'Average favorable move', value: loss.averageFavorable, count: loss.count, ids: loss.ids, tone: 'bg-bear/35', textTone: 'text-bear' },
    { id: 'loss-adverse', group: isKo ? '손실 거래' : 'Losing trades', kind: 'loss' as const, label: isKo ? '평균 최대 불리 움직임' : 'Average adverse move', value: loss.averageAdverse, count: loss.count, ids: loss.ids, tone: 'bg-bear/80', textTone: 'text-bear' },
  ];

  if (validTrades.length === 0) return null;
  return <section className="border border-dark-700 bg-dark-950/25 p-4 sm:p-5" aria-label={isKo ? '수익과 손실 거래의 진입 후 움직임 비교' : 'Post-entry movement comparison for winning and losing trades'}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-white">{isKo ? '좋은 진입과 불리한 진입의 차이' : 'Difference between favorable and unfavorable entries'}</h3><p className="mt-1 text-xs text-dark-500">{isKo ? '수익 거래와 손실 거래가 진입 뒤 얼마나 유리하거나 불리하게 움직였는지 평균으로 비교합니다.' : 'Compare how far winning and losing trades moved favorably or adversely after entry.'}</p></div><span className="border border-dark-700 px-2 py-1 text-[10px] text-dark-500">{isKo ? '수익·손실 확정 거래만' : 'Closed win/loss trades only'}</span></div>
    <div className="mt-4 border-l-2 border-primary-400/70 bg-primary-500/5 px-3 py-3 text-sm font-medium text-primary-100">{conclusion}</div>
    <div className="mt-4 flex flex-wrap gap-2 text-xs"><span className="border border-bull/35 bg-bull/5 px-2.5 py-1.5 text-bull">{isKo ? `수익 거래 표본 n=${win.count}` : `Winning trades n=${win.count}`}</span><span className="border border-bear/35 bg-bear/5 px-2.5 py-1.5 text-bear">{isKo ? `손실 거래 표본 n=${loss.count}` : `Losing trades n=${loss.count}`}</span></div>
    <div className="mt-5 space-y-4" role="img" aria-label={isKo ? '수익 거래와 손실 거래의 평균 유리 및 불리 움직임 막대 비교' : 'Bar comparison of average favorable and adverse moves for wins and losses'}>
      {rows.map((row) => <button key={row.id} type="button" disabled={row.ids.length === 0} onClick={() => onOpenEvidence(row.kind, row.ids)} className="grid w-full gap-2 text-left disabled:cursor-default sm:grid-cols-[150px_minmax(180px,1fr)_112px] sm:items-center">
        <div><div className={`text-xs font-semibold ${row.textTone}`}>{row.group}</div><div className="mt-0.5 text-[11px] text-dark-400">{row.label} · n={row.count}</div></div>
        <div className="h-7 overflow-hidden bg-dark-800/80"><div className={`h-full ${row.tone}`} style={{ width: `${((row.value || 0) / maxValue) * 100}%` }} /></div>
        <div className="flex items-center justify-between gap-2 sm:justify-end"><b className={`font-mono text-base ${row.textTone}`}>{number(row.value)}%</b><span className="text-[11px] text-primary-200">{isKo ? '거래 보기 →' : 'View trades →'}</span></div>
      </button>)}
    </div>
    <div className="mt-4 flex flex-wrap gap-2 border-t border-dark-700 pt-3"><button type="button" disabled={win.ids.length === 0} onClick={() => onOpenEvidence('win', win.ids)} className="border border-bull/35 px-3 py-2 text-xs text-bull hover:border-bull disabled:cursor-default disabled:opacity-50">{isKo ? `수익 거래 ${win.count}건 보기` : `View ${win.count} wins`}</button><button type="button" disabled={loss.ids.length === 0} onClick={() => onOpenEvidence('loss', loss.ids)} className="border border-bear/35 px-3 py-2 text-xs text-bear hover:border-bear disabled:cursor-default disabled:opacity-50">{isKo ? `손실 거래 ${loss.count}건 보기` : `View ${loss.count} losses`}</button></div>
    {!hasBothGroups && <p className="mt-3 text-[11px] text-amber-200">{isKo ? '한쪽 결과만 있는 표본이라 비교 결론을 과장하지 않았습니다.' : 'Only one outcome group is available, so no comparative conclusion is implied.'}</p>}
  </section>;
}
