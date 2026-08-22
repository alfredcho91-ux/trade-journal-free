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
  const segmentTone = (index: number): string => {
    const value = v[index];
    const currentVolume = volumeValues[index];
    if (typeof value !== 'number' || Number.isNaN(value) || currentVolume == null) return '#3b82f6';
    const recentVolumes = volumeValues
      .slice(Math.max(0, index - 19), index + 1)
      .filter((item): item is number => item != null);
    const averageVolume = recentVolumes.reduce((sum, item) => sum + item, 0) / recentVolumes.length;
    const hasVolumeExpansion = averageVolume > 0 && currentVolume / averageVolume >= 1.5;
    if (!hasVolumeExpansion) return '#3b82f6';
    if (value >= 70) return '#22c55e';
    if (value <= 30) return '#ef4444';
    return '#3b82f6';
  };

  const rsiSegments = v.slice(1).flatMap((value, index) => {
    const previous = v[index];
    if (typeof previous !== 'number' || Number.isNaN(previous) || typeof value !== 'number' || Number.isNaN(value)) return [];
    return [
      <line
        key={`${t[index]}-${t[index + 1]}`}
        x1={toX(index)}
        y1={toY(previous)}
        x2={toX(index + 1)}
        y2={toY(value)}
        stroke={segmentTone(index + 1)}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />,
    ];
  });

  return (
    <div className="relative w-full" style={{ height: `${height}px` }}>
      <svg viewBox={`0 0 100 ${height}`} className="block h-full w-full" preserveAspectRatio="none">
        {rsiSegments}
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
