import type { PlanBehaviorCost, PlanCurvePoint, PlanDeltaBucket, PlanSetupStats } from '../../types';

function finite(values: Array<number | null | undefined>): number[] {
  return values.filter((value): value is number => value != null && Number.isFinite(value));
}

export function CumulativeRChart({ points, onSelect, isKo }: {
  points: PlanCurvePoint[];
  onSelect: (journalId: number) => void;
  isKo: boolean;
}) {
  if (!points.length) return <div className="flex h-72 items-center justify-center text-xs text-dark-500">{isKo ? '동일 표본으로 비교할 계획 거래가 없습니다.' : 'No comparable plan trades.'}</div>;
  const width = 960;
  const height = 280;
  const padding = 34;
  const values = finite(points.flatMap((point) => [point.actual_cumulative_r, point.plan_cumulative_r]));
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = Math.max(1, max - min);
  const x = (index: number) => padding + (index / Math.max(1, points.length - 1)) * (width - padding * 2);
  const y = (value: number) => padding + ((max - value) / span) * (height - padding * 2);
  const path = (key: 'actual_cumulative_r' | 'plan_cumulative_r') => points.map((point, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(point[key])}`).join(' ');
  return <div>
    <div className="mb-3 flex items-center gap-5 text-xs"><span className="flex items-center gap-2 text-dark-300"><i className="h-0.5 w-6 bg-primary-400" />Actual</span><span className="flex items-center gap-2 text-dark-300"><i className="h-0.5 w-6 bg-bull" />Plan</span><span className="text-dark-500">n={points.length}</span></div>
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[300px] w-full" role="img" aria-label={isKo ? '실제와 계획 누적 R 비교' : 'Actual versus plan cumulative R'}>
      <line x1={padding} x2={width - padding} y1={y(0)} y2={y(0)} className="stroke-dark-700" strokeDasharray="5 5" />
      <path d={path('actual_cumulative_r')} fill="none" className="stroke-primary-400" strokeWidth="3" />
      <path d={path('plan_cumulative_r')} fill="none" className="stroke-bull" strokeWidth="3" />
      {points.map((point, index) => <g key={point.journal_id} onClick={() => onSelect(point.journal_id)} className="cursor-pointer">
        <circle cx={x(index)} cy={y(point.actual_cumulative_r)} r="7" fill="transparent"><title>{`${point.symbol || ''} Actual ${point.actual_r.toFixed(2)}R · 누적 ${point.actual_cumulative_r.toFixed(2)}R`}</title></circle>
        <circle cx={x(index)} cy={y(point.actual_cumulative_r)} r="2.5" className="fill-primary-300" />
        <circle cx={x(index)} cy={y(point.plan_cumulative_r)} r="7" fill="transparent"><title>{`${point.symbol || ''} Plan ${point.plan_r.toFixed(2)}R · 누적 ${point.plan_cumulative_r.toFixed(2)}R`}</title></circle>
        <circle cx={x(index)} cy={y(point.plan_cumulative_r)} r="2.5" className="fill-bull" />
      </g>)}
      <text x={padding} y={18} className="fill-dark-500 text-[10px]">{max.toFixed(1)}R</text>
      <text x={padding} y={height - 8} className="fill-dark-500 text-[10px]">{min.toFixed(1)}R</text>
    </svg>
  </div>;
}

export function DeltaBars({ rows, label, onSelect, isKo }: {
  rows: PlanBehaviorCost[];
  label: (id: string) => string;
  onSelect: (row: PlanBehaviorCost) => void;
  isKo: boolean;
}) {
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.total_execution_delta_r || 0)));
  if (!rows.length) return <div className="py-12 text-center text-xs text-dark-500">{isKo ? '분류 가능한 공식 R 표본이 없습니다.' : 'No official-R sample to classify.'}</div>;
  return <div className="space-y-3">{rows.map((row) => {
    const value = row.total_execution_delta_r || 0;
    return <button key={row.id} type="button" onClick={() => onSelect(row)} className="grid w-full grid-cols-[180px,1fr,100px] items-center gap-4 text-left">
      <span className="text-xs text-dark-200">{label(row.id)} <small className="text-dark-500">n={row.trade_count}</small></span>
      <span className="relative h-7 bg-dark-800/70"><i className="absolute left-1/2 top-0 h-full w-px bg-dark-600" /><i className={`absolute top-1/2 h-2 -translate-y-1/2 ${value >= 0 ? 'left-1/2 bg-bull' : 'right-1/2 bg-bear'}`} style={{ width: `${Math.abs(value) / max * 48}%` }} /></span>
      <span className={`text-right font-mono text-xs ${value >= 0 ? 'text-bull' : 'text-bear'}`}>{value >= 0 ? '+' : ''}{value.toFixed(2)}R →</span>
    </button>;
  })}</div>;
}

export function DeltaDistribution({ buckets, onSelect, isKo: _isKo }: {
  buckets: PlanDeltaBucket[];
  onSelect: (bucket: PlanDeltaBucket) => void;
  isKo: boolean;
}) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.trade_count));
  return <div className="flex h-56 items-end gap-3 border-b border-dark-700 px-3 pb-3">{buckets.map((bucket) => <button key={bucket.id} type="button" onClick={() => onSelect(bucket)} className="flex h-full flex-1 flex-col justify-end gap-2 group">
    <span className="text-center font-mono text-xs text-dark-300">{bucket.trade_count}</span>
    <span className={`mx-auto w-3/5 ${bucket.id.includes('-') || bucket.id.startsWith('lte') ? 'bg-bear/70' : 'bg-bull/70'} group-hover:opacity-80`} style={{ height: `${Math.max(4, bucket.trade_count / max * 150)}px` }} />
    <span className="text-[10px] text-dark-500">{bucket.label}</span>
  </button>)}</div>;
}

export function ActualPlanRows({ rows, onSelect, isKo }: {
  rows: PlanSetupStats[];
  onSelect: (row: PlanSetupStats) => void;
  isKo: boolean;
}) {
  const max = Math.max(1, ...finite(rows.flatMap((row) => [Math.abs(row.actual_expectancy_r || 0), Math.abs(row.plan_expectancy_r || 0)])));
  if (!rows.length) return <div className="py-10 text-center text-xs text-dark-500">{isKo ? '비교할 표본이 없습니다.' : 'No sample to compare.'}</div>;
  return <div className="space-y-4">{rows.map((row) => <button key={row.id} type="button" onClick={() => onSelect(row)} className="grid w-full grid-cols-[170px,1fr,80px] items-center gap-4 text-left">
    <span className="truncate text-xs text-dark-200">{row.id} <small className="text-dark-500">n={row.official_r_count}</small></span>
    <span className="space-y-1"><i className="block h-2 bg-primary-400" style={{ width: `${Math.abs(row.actual_expectancy_r || 0) / max * 100}%` }} /><i className="block h-2 bg-bull" style={{ width: `${Math.abs(row.plan_expectancy_r || 0) / max * 100}%` }} /></span>
    <span className="font-mono text-[10px] text-dark-400">{(row.actual_expectancy_r ?? 0).toFixed(2)} / {(row.plan_expectancy_r ?? 0).toFixed(2)}R →</span>
  </button>)}</div>;
}
