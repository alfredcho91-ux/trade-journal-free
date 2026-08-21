export interface IndicatorTimeMarker {
  datetime: string | null;
  label: string;
  color: string;
}

function markerIndex(times: string[], datetime: string | null): number | null {
  if (!datetime || times.length === 0) return null;
  const target = new Date(datetime).getTime();
  if (!Number.isFinite(target)) return null;

  const first = new Date(times[0]).getTime();
  if (!Number.isFinite(first) || target < first) return null;
  let selected = 0;
  for (let index = 0; index < times.length; index += 1) {
    const timestamp = new Date(times[index]).getTime();
    if (!Number.isFinite(timestamp)) continue;
    if (timestamp > target) break;
    selected = index;
  }
  return selected;
}

export function IndicatorTimeMarkers({
  times,
  markers,
}: {
  times: string[];
  markers?: IndicatorTimeMarker[];
}) {
  if (!markers?.length || times.length === 0) return null;
  const resolved = markers.flatMap((marker) => {
    const index = markerIndex(times, marker.datetime);
    return index == null ? [] : [{ ...marker, index }];
  });
  if (!resolved.length) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {resolved.map((marker, markerOrder) => {
        const sameIndex = resolved.filter((candidate) => candidate.index === marker.index);
        const duplicateOrder = sameIndex.findIndex((candidate) => candidate.label === marker.label);
        const baseLeft = (marker.index / Math.max(times.length - 1, 1)) * 100;
        const left = Math.max(0, Math.min(100, baseLeft + (sameIndex.length > 1 ? duplicateOrder * 0.5 - 0.25 : 0)));
        const labelShift = sameIndex.length > 1
          ? duplicateOrder === 0 ? 'translateX(-100%)' : 'translateX(0)'
          : 'translateX(-50%)';
        return (
          <div key={`${marker.label}-${marker.index}-${markerOrder}`} className="absolute inset-y-0" style={{ left: `${left}%` }}>
            <span
              className="absolute inset-y-0 border-l border-dashed"
              style={{ borderColor: marker.color, opacity: 0.78 }}
            />
            <span
              className="absolute top-0 whitespace-nowrap text-[9px] font-bold"
              style={{ color: marker.color, transform: labelShift, textShadow: '0 0 3px #0b1220, 0 0 3px #0b1220' }}
            >
              {marker.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
