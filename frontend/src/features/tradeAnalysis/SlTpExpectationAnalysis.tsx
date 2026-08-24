import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Grid3X3, Info, Loader2, Play, RotateCcw } from 'lucide-react';

import { getJournalSlTpAnalysis, type JournalSlTpParams } from '../../api/journal';
import type { SlTpCandidate, SlTpPerformance } from '../../types';
import { journalQueryKeys } from '../journal/journalQueryKeys';

type Props = {
  startTime: number | null;
  endTime: number | null;
  direction: 'Long' | 'Short';
  isKo: boolean;
};

type GridConfig = Omit<JournalSlTpParams, 'start_time' | 'end_time'>;

const DEFAULT_CONFIG: GridConfig = {
  sl_min: 0.5,
  sl_max: 5,
  sl_step: 0.5,
  tp_min: 0.5,
  tp_max: 10,
  tp_step: 0.5,
};

function number(value?: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function signed(value?: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${number(value, digits)}`;
}

function candidateCount(config: GridConfig): number {
  if (config.sl_step <= 0 || config.tp_step <= 0 || config.sl_min > config.sl_max || config.tp_min > config.tp_max) return 0;
  const slCount = Math.floor((config.sl_max - config.sl_min) / config.sl_step + 1e-9) + 1;
  const tpCount = Math.floor((config.tp_max - config.tp_min) / config.tp_step + 1e-9) + 1;
  return slCount * tpCount;
}

function sameConfig(left: GridConfig, right: GridConfig): boolean {
  return (Object.keys(left) as Array<keyof GridConfig>).every((key) => left[key] === right[key]);
}

function heatColor(value: number | null | undefined, maximum: number): string {
  if (value == null || !Number.isFinite(value)) return 'rgba(71, 85, 105, 0.18)';
  const strength = Math.min(1, Math.abs(value) / Math.max(maximum, 0.01));
  return value >= 0
    ? `rgba(34, 197, 94, ${0.12 + strength * 0.62})`
    : `rgba(239, 68, 68, ${0.12 + strength * 0.62})`;
}

function Metric({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'positive' | 'negative' | 'neutral' }) {
  const color = tone === 'positive' ? 'text-bull' : tone === 'negative' ? 'text-bear' : 'text-white';
  return <div className="border-b border-dark-800 px-3 py-3 lg:border-b-0 lg:border-r lg:last:border-r-0"><div className="text-[10px] text-dark-500">{label}</div><div className={`mt-1 whitespace-nowrap font-mono text-base ${color}`}>{value}</div></div>;
}

function ComparisonRow({ label, actual, simulated, suffix = '%', lowerIsBetter = false }: { label: string; actual?: number | null; simulated?: number | null; suffix?: string; lowerIsBetter?: boolean }) {
  const delta = actual != null && simulated != null ? simulated - actual : null;
  const favorable = delta != null && (lowerIsBetter ? delta <= 0 : delta >= 0);
  return (
    <div className="grid grid-cols-[minmax(80px,1fr)_72px_12px_72px_58px] items-center gap-1.5 border-b border-dark-800 py-2 text-xs last:border-b-0">
      <span className="text-dark-400">{label}</span>
      <span className="text-right font-mono text-dark-300">{signed(actual)}{actual == null ? '' : suffix}</span>
      <span className="text-center text-dark-700">→</span>
      <span className="text-right font-mono text-white">{signed(simulated)}{simulated == null ? '' : suffix}</span>
      <span className={`text-right font-mono ${favorable ? 'text-bull' : 'text-bear'}`}>{delta == null ? '-' : `${signed(delta)}${suffix}`}</span>
    </div>
  );
}

function GridInputs({ draft, setDraft, isKo }: { draft: GridConfig; setDraft: (value: GridConfig) => void; isKo: boolean }) {
  const fields: Array<{ key: keyof GridConfig; label: string; group: 'SL' | 'TP' }> = [
    { key: 'sl_min', label: isKo ? '최소' : 'Min', group: 'SL' },
    { key: 'sl_max', label: isKo ? '최대' : 'Max', group: 'SL' },
    { key: 'sl_step', label: isKo ? '간격' : 'Step', group: 'SL' },
    { key: 'tp_min', label: isKo ? '최소' : 'Min', group: 'TP' },
    { key: 'tp_max', label: isKo ? '최대' : 'Max', group: 'TP' },
    { key: 'tp_step', label: isKo ? '간격' : 'Step', group: 'TP' },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {(['SL', 'TP'] as const).map((group) => (
        <fieldset key={group} className="border border-dark-700 p-3">
          <legend className="px-1 text-xs font-semibold text-dark-200">{group} (%)</legend>
          <div className="grid grid-cols-3 gap-2">
            {fields.filter((field) => field.group === group).map((field) => (
              <label key={field.key} className="block">
                <span className="mb-1 block text-[10px] text-dark-500">{field.label}</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={draft[field.key]}
                  onChange={(event) => setDraft({ ...draft, [field.key]: Number(event.target.value) })}
                  className="w-full border border-dark-700 bg-dark-900/50 px-2 py-2 text-right font-mono text-xs text-white outline-none focus:border-primary-500"
                  aria-label={`${group} ${field.label}`}
                />
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function ExpectancyHeatmap({ candidates, slValues, tpValues, isKo }: { candidates: SlTpCandidate[]; slValues: number[]; tpValues: number[]; isKo: boolean }) {
  const lookup = new Map(candidates.map((candidate) => [`${candidate.sl_pct}:${candidate.tp_pct}`, candidate]));
  const maximum = Math.max(0.01, ...candidates.map((candidate) => Math.abs(candidate.overall.expectancy_pct || 0)));
  const columns = `56px repeat(${tpValues.length}, 46px)`;
  return (
    <div className="overflow-auto border border-dark-800">
      <div className="min-w-max p-2">
        <div className="mb-2 text-[10px] text-dark-500">{isKo ? '셀 값: 거래당 기대수익률(%) · 가로 TP / 세로 SL' : 'Cell: expectancy (%) · TP across / SL down'}</div>
        <div className="grid gap-1" style={{ gridTemplateColumns: columns }}>
          <div className="flex h-8 items-center justify-center text-[10px] text-dark-600">SL\TP</div>
          {tpValues.map((tp) => <div key={`tp-${tp}`} className="flex h-8 items-center justify-center font-mono text-[10px] text-dark-400">{number(tp, 1)}</div>)}
          {slValues.flatMap((sl) => [
            <div key={`sl-${sl}`} className="flex h-8 items-center justify-center font-mono text-[10px] text-dark-400">{number(sl, 1)}</div>,
            ...tpValues.map((tp) => {
              const candidate = lookup.get(`${sl}:${tp}`);
              const value = candidate?.overall.expectancy_pct;
              return (
                <div
                  key={`${sl}:${tp}`}
                  className="flex h-8 w-[46px] items-center justify-center font-mono text-[9px] text-white"
                  style={{ backgroundColor: heatColor(value, maximum) }}
                  title={`SL ${sl}% · TP ${tp}% · ${isKo ? '기대값' : 'Expectancy'} ${signed(value)}% · PF ${number(candidate?.overall.profit_factor)}`}
                >
                  {signed(value, 1)}
                </div>
              );
            }),
          ])}
        </div>
      </div>
    </div>
  );
}

function CandidateTable({ candidates, best, isKo }: { candidates: SlTpCandidate[]; best?: SlTpCandidate | null; isKo: boolean }) {
  const ordered = [...candidates].sort((a, b) => b.score - a.score || a.sl_pct - b.sl_pct || a.tp_pct - b.tp_pct);
  return (
    <div className="max-h-[520px] overflow-auto">
      <table className="w-full min-w-[1120px] text-xs">
        <thead className="sticky top-0 z-10 bg-dark-900 text-dark-500"><tr className="border-b border-dark-700"><th className="py-2 text-left">SL</th><th className="py-2 text-left">TP</th><th className="py-2 text-right">{isKo ? '승률' : 'Win'}</th><th className="py-2 text-right">Stop</th><th className="py-2 text-right">TP Hit</th><th className="py-2 text-right">{isKo ? '평균 수익' : 'Avg win'}</th><th className="py-2 text-right">{isKo ? '평균 손실' : 'Avg loss'}</th><th className="py-2 text-right">{isKo ? '기대값' : 'Expectancy'}</th><th className="py-2 text-right">R</th><th className="py-2 text-right">PF</th><th className="py-2 text-right">{isKo ? '누적' : 'Cumulative'}</th><th className="py-2 text-right">Max DD</th><th className="py-2 text-right">n</th></tr></thead>
        <tbody>{ordered.map((candidate) => {
          const row = candidate.overall;
          const selected = best?.sl_pct === candidate.sl_pct && best?.tp_pct === candidate.tp_pct;
          return <tr key={`${candidate.sl_pct}:${candidate.tp_pct}`} className={`border-b border-dark-800 ${selected ? 'bg-primary-500/10 text-primary-100' : ''}`}><td className="py-2 font-mono">{number(candidate.sl_pct, 2)}%</td><td className="py-2 font-mono">{number(candidate.tp_pct, 2)}%</td><td className="py-2 text-right font-mono">{number(row.win_rate_pct, 1)}%</td><td className="py-2 text-right font-mono">{number(row.stop_hit_pct, 1)}%</td><td className="py-2 text-right font-mono">{number(row.tp_hit_pct, 1)}%</td><td className="py-2 text-right font-mono text-bull">{signed(row.average_win_pct)}%</td><td className="py-2 text-right font-mono text-bear">{signed(row.average_loss_pct)}%</td><td className="py-2 text-right font-mono">{signed(row.expectancy_pct)}%</td><td className="py-2 text-right font-mono">{signed(row.average_r)}</td><td className="py-2 text-right font-mono">{number(row.profit_factor)}</td><td className="py-2 text-right font-mono">{signed(row.cumulative_return_pct)}%</td><td className="py-2 text-right font-mono">{number(row.max_drawdown_pct)}%</td><td className="py-2 text-right font-mono text-dark-500">{row.trade_count}</td></tr>;
        })}</tbody>
      </table>
    </div>
  );
}

function comparisonMetrics(actual: SlTpPerformance, simulated: SlTpPerformance) {
  return [
    ['거래당 기대값', actual.expectancy_pct, simulated.expectancy_pct, '%', false],
    ['승률', actual.win_rate_pct, simulated.win_rate_pct, '%', false],
    ['Profit Factor', actual.profit_factor, simulated.profit_factor, '', false],
    ['누적 수익', actual.cumulative_return_pct, simulated.cumulative_return_pct, '%', false],
    ['Max Drawdown', actual.max_drawdown_pct, simulated.max_drawdown_pct, '%', true],
  ] as const;
}

export default function SlTpExpectationAnalysis({ startTime, endTime, direction, isKo }: Props) {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState<GridConfig>(DEFAULT_CONFIG);
  const [applied, setApplied] = useState<GridConfig>(DEFAULT_CONFIG);
  const count = candidateCount(draft);
  const hasChanges = !sameConfig(draft, applied);
  const inputError = count < 1
    ? (isKo ? '최소·최대·간격을 확인하세요.' : 'Check grid bounds and steps.')
    : count > 800
      ? (isKo ? '조합은 최대 800개까지 계산할 수 있습니다.' : 'The grid is limited to 800 combinations.')
      : null;
  const query = useQuery({
    queryKey: startTime != null && endTime != null
      ? journalQueryKeys.slTpAnalysis(startTime, endTime, applied.sl_min, applied.sl_max, applied.sl_step, applied.tp_min, applied.tp_max, applied.tp_step)
      : ['journal-sl-tp-analysis', 'disabled'],
    queryFn: () => getJournalSlTpAnalysis({ start_time: startTime as number, end_time: endTime as number, ...applied }),
    enabled: open && startTime != null && endTime != null && startTime <= endTime,
    staleTime: 60 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const bundle = query.data?.direction_breakdown[direction];
  const best = bundle?.best_candidate;
  const recommendation = bundle?.recommendation;
  const validationLabel = recommendation?.validation_status === 'passed'
    ? (isKo ? '최근 30% 검증 통과' : 'Passed recent 30% validation')
    : recommendation?.validation_status === 'failed'
      ? (isKo ? '최근 30%에서 개선 재현 안 됨' : 'Not reproduced in recent 30%')
      : recommendation?.validation_status === 'neutral'
        ? (isKo ? '최근 30%에서 기존 방식과 유사' : 'Similar to actual in recent 30%')
        : (isKo ? '검증 표본 부족' : 'Insufficient validation sample');
  const bestTone = (best?.overall.expectancy_pct || 0) >= 0 ? 'positive' : 'negative';
  const bestAtBoundary = Boolean(best && (
    best.sl_pct === applied.sl_min
    || best.sl_pct === applied.sl_max
    || best.tp_pct === applied.tp_min
    || best.tp_pct === applied.tp_max
  ));
  const bestMetrics = useMemo(() => best ? comparisonMetrics(bundle?.actual_overall || best.overall, best.overall) : [], [best, bundle?.actual_overall]);

  const runAnalysis = () => {
    if (inputError) return;
    if (sameConfig(draft, applied)) void query.refetch();
    else setApplied({ ...draft });
  };

  return (
    <details className="group border border-dark-700 bg-dark-900/20" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-dark-900/40">
        <div><h2 className="flex items-center gap-2 text-sm font-semibold text-white"><Grid3X3 className="h-4 w-4 text-primary-300" />SL / TP 기대값 분석</h2><p className="mt-1 text-[11px] text-dark-500">{isKo ? '실제 거래의 5분봉 경로로 손절·익절 선후를 재생' : 'Replay SL/TP order on each trade’s actual 5m path'}</p></div>
        <span className="flex items-center gap-2 font-mono text-xs text-dark-500">{direction.toUpperCase()} · {query.data ? `${bundle?.trade_count || 0}${isKo ? '건' : ''}` : isKo ? '열어서 분석' : 'Open to analyze'}<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></span>
      </summary>

      <div className="border-t border-dark-700">
        <div className="grid gap-3 border-b border-dark-700 p-4 xl:grid-cols-[minmax(0,1fr)_180px] xl:items-end">
          <GridInputs draft={draft} setDraft={setDraft} isKo={isKo} />
          <div>
            <div className={`mb-2 text-[11px] ${inputError ? 'text-bear' : hasChanges ? 'text-amber-300' : 'text-dark-500'}`}>{inputError || `${count}${isKo ? '개 조합' : ' combinations'}${hasChanges ? (isKo ? ' · 적용 필요' : ' · apply changes') : ''}`}</div>
            <button type="button" onClick={runAnalysis} disabled={Boolean(inputError) || query.isFetching} className="btn-primary flex min-h-10 w-full items-center justify-center gap-2 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50">{query.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{query.isFetching ? (isKo ? '경로 계산 중' : 'Calculating') : (isKo ? '이 범위로 분석' : 'Analyze this grid')}</button>
          </div>
        </div>

        {query.isLoading ? (
          <div className="flex min-h-48 items-center justify-center text-sm text-dark-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{isKo ? '5분봉 거래 경로와 조합을 계산하고 있습니다.' : 'Calculating 5m trade paths and combinations.'}</div>
        ) : query.isError ? (
          <div role="alert" className="flex min-h-36 flex-col items-center justify-center gap-3 text-sm text-bear"><span>{isKo ? 'SL/TP 분석 데이터를 불러오지 못했습니다.' : 'SL/TP analysis is unavailable.'}</span><button type="button" onClick={() => void query.refetch()} className="flex items-center gap-1 text-primary-300"><RotateCcw className="h-4 w-4" />{isKo ? '다시 시도' : 'Retry'}</button></div>
        ) : !bundle || !best || !recommendation ? (
          <div className="px-4 py-8 text-sm text-dark-400">{isKo ? '선택 방향에서 완전한 5분봉 경로가 있는 종료 거래가 없습니다.' : 'No closed trades have complete 5m paths for this direction.'}</div>
        ) : (
          <div>
            <div className="grid border-b border-dark-700 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
              <div className="border-b border-dark-700 p-4 xl:border-b-0 xl:border-r">
                <div className="text-[10px] text-dark-500">{validationLabel}</div>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div><div className="text-[11px] text-dark-500">{isKo ? '추천 SL 범위' : 'Recommended SL'}</div><div className="mt-1 font-mono text-xl text-primary-200">{number(recommendation.sl_lower_pct)}% ~ {number(recommendation.sl_upper_pct)}%</div></div>
                  <div><div className="text-[11px] text-dark-500">{isKo ? '추천 TP 범위' : 'Recommended TP'}</div><div className="mt-1 font-mono text-xl text-primary-200">{number(recommendation.tp_lower_pct)}% ~ {number(recommendation.tp_upper_pct)}%</div></div>
                </div>
                <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-dark-800 pt-3"><div><div className="text-[11px] text-dark-500">{isKo ? '최적 단일 후보' : 'Best single candidate'}</div><div className="mt-1 font-mono text-lg text-white">SL {number(best.sl_pct)}% · TP {number(best.tp_pct)}%</div></div><div className="text-right"><div className="text-[10px] text-dark-500">{isKo ? '전체 기대값' : 'Overall expectancy'}</div><div className={`font-mono text-xl ${bestTone === 'positive' ? 'text-bull' : 'text-bear'}`}>{signed(best.overall.expectancy_pct)}%</div></div></div>
                {recommendation.validation_status === 'failed' && <p className="mt-3 text-xs text-bear">{isKo ? '과거 70%에서 선택한 조합이 최근 30%에서는 기존 청산보다 개선되지 않았습니다. 추천값을 실전 기준으로 확정하지 마세요.' : 'The train-selected grid did not improve on actual exits in the recent 30%.'}</p>}
                {recommendation.sample_quality === 'low' && <p className="mt-2 text-xs text-amber-300">{isKo ? '표본이 적어 추천 범위의 신뢰도가 낮습니다.' : 'The recommendation has a small sample.'}</p>}
                {bestAtBoundary && <p className="mt-2 text-xs text-amber-300">{isKo ? '최적 후보가 입력 범위의 경계에 있습니다. 바깥 구간도 확인하려면 해당 최소·최대 범위를 넓혀 다시 분석하세요.' : 'The best candidate is on a grid boundary; widen that range before treating it as an optimum.'}</p>}
              </div>
              <div className="p-4"><div className="mb-2 grid grid-cols-[minmax(80px,1fr)_72px_12px_72px_58px] gap-1.5 text-[10px] text-dark-600"><span>{isKo ? '실제 종료 vs 최적 조합' : 'Actual vs best grid'}</span><span className="text-right">{isKo ? '실제' : 'Actual'}</span><span /><span className="text-right">SL/TP</span><span className="text-right">Δ</span></div>{bestMetrics.map(([label, actual, simulated, suffix, lowerIsBetter]) => <ComparisonRow key={label} label={isKo ? label : label} actual={actual} simulated={simulated} suffix={suffix} lowerIsBetter={lowerIsBetter} />)}</div>
            </div>

            <div className="grid grid-cols-2 border-b border-dark-700 sm:grid-cols-4 lg:grid-cols-8">
              <Metric label={isKo ? '승률' : 'Win rate'} value={`${number(best.overall.win_rate_pct, 1)}%`} />
              <Metric label={isKo ? '손절 적중률' : 'Stop hit rate'} value={`${number(best.overall.stop_hit_pct, 1)}%`} />
              <Metric label={isKo ? '익절 적중률' : 'TP hit rate'} value={`${number(best.overall.tp_hit_pct, 1)}%`} />
              <Metric label={isKo ? '평균 수익률' : 'Average win'} value={`${signed(best.overall.average_win_pct)}%`} tone="positive" />
              <Metric label={isKo ? '평균 손실률' : 'Average loss'} value={`${signed(best.overall.average_loss_pct)}%`} tone="negative" />
              <Metric label={isKo ? '평균 R' : 'Average R'} value={signed(best.overall.average_r)} tone={(best.overall.average_r || 0) >= 0 ? 'positive' : 'negative'} />
              <Metric label="Profit Factor" value={number(best.overall.profit_factor)} />
              <Metric label={isKo ? '판정 불명확' : 'Ambiguous'} value={`${best.overall.ambiguous_count}${isKo ? '건' : ''}`} />
            </div>

            <section className="border-b border-dark-700 p-4"><div className="mb-3"><h3 className="text-xs font-semibold text-white">SL × TP Expectancy Heatmap</h3><p className="mt-1 text-[10px] text-dark-500">{isKo ? '초록은 양의 기대값, 빨강은 음의 기대값입니다.' : 'Green is positive expectancy; red is negative.'}</p></div><ExpectancyHeatmap candidates={bundle.candidates} slValues={query.data?.sl_values || []} tpValues={query.data?.tp_values || []} isKo={isKo} /></section>

            <details className="border-b border-dark-700 p-4" open><summary className="cursor-pointer text-xs font-semibold text-white">{isKo ? `SL/TP 조합별 전체 성과표 (${bundle.candidates.length})` : `All SL/TP combinations (${bundle.candidates.length})`}</summary><div className="mt-3"><CandidateTable candidates={bundle.candidates} best={best} isKo={isKo} /></div></details>

            <details className="px-4 py-3 text-[10px] leading-4 text-dark-600" open><summary className="flex cursor-pointer items-center gap-1 text-dark-500"><Info className="h-3 w-3" />{isKo ? '계산 기준과 데이터 범위' : 'Method and coverage'}</summary><p className="mt-2">{isKo ? '각 거래의 최초 진입부터 실제 종료까지 완전히 포함된 Binance USDT-M Futures 5분봉을 시간순으로 재생합니다. 같은 5분봉에서 SL과 TP가 모두 닿으면 순서를 알 수 없으므로 ambiguous로 기록하고 SL 처리합니다. 결과는 방향성 가격수익률에서 해당 거래의 실제 수수료율을 차감하며, 가상 종료 시점의 펀딩과 슬리피지는 포함하지 않습니다. 누적 수익과 Max Drawdown은 매 거래에 동일 자본을 순차 재투자한 복리 가정입니다.' : 'The simulator replays fully-contained Binance USDT-M Futures 5m candles from entry to exit. Same-bar collisions are marked ambiguous and conservatively stopped. Recorded fee rate is used as a proxy; funding and slippage are excluded.'}</p><p className="mt-1">{isKo ? `경로 ${query.data?.coverage.analyzed_positions || 0}/${query.data?.coverage.closed_positions_considered || 0}건 · 수수료 반영 ${query.data?.coverage.fee_proxy_positions || 0}건 · 과거 70% 선택 / 최근 30% 검증` : `${query.data?.coverage.analyzed_positions || 0}/${query.data?.coverage.closed_positions_considered || 0} paths · fees ${query.data?.coverage.fee_proxy_positions || 0} · 70/30 train-validation`}</p>{(query.data?.warnings.length || 0) > 0 && <div className="mt-1 space-y-0.5 text-amber-400/80">{query.data?.warnings.map((warning) => <div key={warning}>{warning}</div>)}</div>}</details>
          </div>
        )}
      </div>
    </details>
  );
}
