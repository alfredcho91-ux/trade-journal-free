import type { AnchoredVwapDeviation, AnchoredVwapZone } from '../types';

const VWAP_ZONE_LABELS: Record<AnchoredVwapZone, { ko: string; en: string }> = {
  center: { ko: 'VWAP 중심권', en: 'VWAP center range' },
  upper_expansion: { ko: '상단 확장', en: 'Upper expansion' },
  strong_upper: { ko: '강한 상단 이격', en: 'Strong upper extension' },
  extreme_upper: { ko: '극단적 상단 이격', en: 'Extreme upper extension' },
  lower_expansion: { ko: '하단 확장', en: 'Lower expansion' },
  strong_lower: { ko: '강한 하단 이격', en: 'Strong lower extension' },
  extreme_lower: { ko: '극단적 하단 이격', en: 'Extreme lower extension' },
};

export function anchoredVwapZoneLabel(zone: AnchoredVwapDeviation['zone'], isKo: boolean): string {
  return VWAP_ZONE_LABELS[zone]?.[isKo ? 'ko' : 'en'] ?? zone;
}

export function anchoredVwapSampleLabel(value: AnchoredVwapDeviation, isKo: boolean): string {
  return isKo
    ? `HLC3 · 완료봉 ${value.sample_count}/${value.length}개 기준`
    : `HLC3 · ${value.sample_count}/${value.length} completed bars`;
}
