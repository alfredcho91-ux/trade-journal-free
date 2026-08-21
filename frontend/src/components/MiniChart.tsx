import { IndicatorTimeMarkers, type IndicatorTimeMarker } from './IndicatorTimeMarkers';

interface MiniChartProps {
  t: string[];
  v: number[];
  volume?: { t: string[]; v: number[] };
  yRefs?: number[];
  height?: number;
  markers?: IndicatorTimeMarker[];
}

export function MiniChart({ t, v, volume, yRefs = [], height = 80, markers }: MiniChartProps) {
  const validV = (v || []).filter((x) => typeof x === 'number' && !Number.isNaN(x));
  if (!t?.length || validV.length === 0) return <div className="h-12 bg-dark-800/50 rounded flex items-center justify-center text-dark-500 text-xs">No data</div>;
  const min = Math.min(...validV);
  const max = Math.max(...validV);
  const range = max - min || 1;
  const h = height - 16;
  const toX = (index: number) => (index / (v.length - 1 || 1)) * 100;
  const toY = (value: number) => 12 + (max - value) / range * (h - 8);
  const pts = v.map((val, i) => {
    const x = toX(i);
    const y = typeof val === 'number' && !Number.isNaN(val) ? toY(val) : 12 + h / 2;
    return `${x},${y}`;
  }).join(' ');

  const volumeByTime = new Map<string, number>();
  if (volume) {
    const length = Math.min(volume.t.length, volume.v.length);
    for (let index = 0; index < length; index += 1) {
      const value = volume.v[index];
      if (typeof value === 'number' && !Number.isNaN(value)) {
        volumeByTime.set(volume.t[index], value);
      }
    }
  }

  const volumeValues = t.map((time) => volumeByTime.get(time));
  const rsiVolumeMarkers = volume
    ? v.flatMap((value, index) => {
      if (typeof value !== 'number' || Number.isNaN(value) || (value > 30 && value < 70)) return [];

      const currentVolume = volumeValues[index];
      if (currentVolume == null) return [];

      const recentVolumes = volumeValues
        .slice(Math.max(0, index - 19), index + 1)
        .filter((item): item is number => item != null);
      const averageVolume = recentVolumes.reduce((sum, item) => sum + item, 0) / recentVolumes.length;
      const volumeRatio = averageVolume > 0 ? currentVolume / averageVolume : 1;
      const intensity = Math.max(0.35, Math.min(1, 0.35 + volumeRatio * 0.3));
      const radius = Math.max(1.2, Math.min(3.6, 1.2 + volumeRatio));
      const isOverbought = value >= 70;

      return (
        <circle
          key={`${t[index]}-${value}`}
          cx={toX(index)}
          cy={toY(value)}
          r={radius}
          fill={isOverbought ? '#f87171' : '#34d399'}
          fillOpacity={intensity}
          stroke={isOverbought ? '#fecaca' : '#a7f3d0'}
          strokeWidth="0.45"
        >
          <title>{`${isOverbought ? 'Overbought' : 'Oversold'} · ${volumeRatio.toFixed(1)}x volume`}</title>
        </circle>
      );
    })
    : [];

  return (
    <div className="relative w-full" style={{ height: `${height}px` }}>
      <svg viewBox={`0 0 100 ${height}`} className="block h-full w-full" preserveAspectRatio="none">
        {rsiVolumeMarkers}
        <polyline fill="none" stroke="#3b82f6" strokeWidth="1" vectorEffect="non-scaling-stroke" points={pts} />
        {yRefs.map((r, i) => {
          const y = toY(r);
          const isMid = r === 50;
          const isBand = r === 30 || r === 70;
          return (
            <line
              key={i}
              x1="0"
              y1={y}
              x2="100"
              y2={y}
              stroke={isMid ? '#9ca3af' : '#6b7280'}
              strokeWidth={isBand ? '1.2' : '0.7'}
              strokeDasharray={isMid ? undefined : '2,2'}
            />
          );
        })}
      </svg>
      <IndicatorTimeMarkers times={t} markers={markers} />
    </div>
  );
}
