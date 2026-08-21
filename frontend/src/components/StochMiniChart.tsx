import { IndicatorTimeMarkers, type IndicatorTimeMarker } from './IndicatorTimeMarkers';

/** K·D 두 선을 함께 그리는 Slow Stochastic 차트 */
export function StochMiniChart({
  tk,
  vk,
  td,
  vd,
  yRefs = [],
  showCrossLabels = false,
  histogram,
  markers,
  height = 100,
}: {
  tk: string[];
  vk: number[];
  td?: string[];
  vd?: number[];
  yRefs?: number[];
  showCrossLabels?: boolean;
  histogram?: { t: string[]; v: number[] };
  markers?: IndicatorTimeMarker[];
  height?: number;
}) {
  const validK = (vk || []).filter((x) => typeof x === 'number' && !Number.isNaN(x));
  const validD = (vd || []).filter((x) => typeof x === 'number' && !Number.isNaN(x));
  const hasK = (tk?.length ?? 0) > 0 && validK.length > 0;
  if (!hasK) return <div className="h-12 bg-dark-800/50 rounded flex items-center justify-center text-dark-500 text-xs">No data</div>;

  const validHistogram = (histogram?.v || []).filter((x) => typeof x === 'number' && !Number.isNaN(x));
  const allV = [...validK, ...validD, ...validHistogram, ...yRefs];
  const min = Math.min(...allV);
  const max = Math.max(...allV);
  const range = max - min || 1;
  const h = height - 16;
  const toY = (val: number) => 12 + (max - val) / range * (h - 8);
  const toX = (index: number) => (index / (vk.length - 1 || 1)) * 100;

  const ptsK = vk.map((val, i) => {
    const x = toX(i);
    const y = typeof val === 'number' && !Number.isNaN(val) ? toY(val) : 12 + h / 2;
    return `${x},${y}`;
  }).join(' ');

  const vdArr = vd || [];
  const ptsD = vdArr.map((val, i) => {
    const x = (i / (vdArr.length - 1 || 1)) * 100;
    const y = typeof val === 'number' && !Number.isNaN(val) ? toY(val) : 12 + h / 2;
    return `${x},${y}`;
  }).join(' ');

  const histogramByTime = new Map<string, number>();
  if (histogram) {
    for (let index = 0; index < Math.min(histogram.t.length, histogram.v.length); index += 1) {
      const value = histogram.v[index];
      if (typeof value === 'number' && !Number.isNaN(value)) {
        histogramByTime.set(histogram.t[index], value);
      }
    }
  }
  const zeroY = toY(0);
  const barWidth = Math.max(0.12, Math.min(1.6, 65 / Math.max(vk.length, 1)));

  const dByTime = new Map<string, number>();
  const dTimes = td ?? tk;
  for (let index = 0; index < Math.min(dTimes.length, vdArr.length); index += 1) {
    const value = vdArr[index];
    if (typeof value === 'number' && !Number.isNaN(value)) {
      dByTime.set(dTimes[index], value);
    }
  }

  const crossLabels: Array<{ index: number; value: number; state: 'golden' | 'dead' }> = [];
  let previous: { k: number; d: number } | null = null;
  for (let index = 0; index < Math.min(tk.length, vk.length); index += 1) {
    const k = vk[index];
    const d = dByTime.get(tk[index]);
    if (typeof k !== 'number' || Number.isNaN(k) || d == null) continue;

    if (previous && previous.k <= previous.d && k > d) {
      crossLabels.push({ index, value: (k + d) / 2, state: 'golden' });
    } else if (previous && previous.k >= previous.d && k < d) {
      crossLabels.push({ index, value: (k + d) / 2, state: 'dead' });
    }
    previous = { k, d };
  }

  const visibleCrossLabels = showCrossLabels ? crossLabels.slice(-8) : [];

  return (
    <div className="relative w-full" style={{ height: `${height}px` }}>
      <svg viewBox={`0 0 100 ${height}`} className="block h-full w-full" preserveAspectRatio="none">
        {histogram && tk.map((time, index) => {
          const value = histogramByTime.get(time);
          if (value == null) return null;
          const valueY = toY(value);
          return (
            <rect
              key={`${time}-histogram`}
              x={Math.max(0, toX(index) - barWidth / 2)}
              y={Math.min(zeroY, valueY)}
              width={barWidth}
              height={Math.max(0.6, Math.abs(zeroY - valueY))}
              fill={value >= 0 ? '#34d399' : '#f87171'}
              fillOpacity="0.38"
            />
          );
        })}
        <polyline fill="none" stroke="#3b82f6" strokeWidth="1" vectorEffect="non-scaling-stroke" points={ptsK} />
        {vdArr.length > 0 && <polyline fill="none" stroke="#f59e0b" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="3,2" points={ptsD} />}
        {yRefs.map((r, i) => (
          <line key={i} x1="0" y1={toY(r)} x2="100" y2={toY(r)} stroke="#6b7280" strokeWidth="0.5" strokeDasharray="2,2" />
        ))}
      </svg>
      {visibleCrossLabels.map(({ index, value, state }) => {
        const y = toY(value);
        const top = Math.max(0, Math.min(height - 7, state === 'golden' ? y - 7 : y));
        const tone = state === 'golden' ? 'bg-emerald-400/55' : 'bg-red-400/55';
        const triangle = state === 'golden'
          ? 'border-x-[5px] border-x-transparent border-b-[7px] border-b-emerald-400'
          : 'border-x-[5px] border-x-transparent border-t-[7px] border-t-red-400';
        return (
          <div key={`${tk[index]}-${state}`} className="pointer-events-none absolute inset-y-0" style={{ left: `${toX(index)}%` }}>
            <span className={`absolute inset-y-0 w-px ${tone}`} />
            <span className={`absolute -translate-x-1/2 ${triangle}`} style={{ top: `${top}px` }}>
              <span className="sr-only">{state === 'golden' ? '골든크로스' : '데드크로스'}</span>
            </span>
          </div>
        );
      })}
      <IndicatorTimeMarkers times={tk} markers={markers} />
    </div>
  );
}
