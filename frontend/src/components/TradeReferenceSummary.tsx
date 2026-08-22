import { BarChart3 } from 'lucide-react';

import type { TradeReportVWAPData, VPVRData } from '../types';

function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-';
  const digits = value >= 1_000 ? 2 : value >= 1 ? 4 : 6;
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

const ANCHOR_LABELS: Record<string, { ko: string; en: string }> = {
  day: { ko: '일간 VWAP', en: 'Daily VWAP' },
  week: { ko: '주간 VWAP', en: 'Weekly VWAP' },
  month: { ko: '월간 VWAP', en: 'Monthly VWAP' },
  quarter: { ko: '분기 VWAP', en: 'Quarterly VWAP' },
  year: { ko: '연간 VWAP', en: 'Yearly VWAP' },
};

const VWAP_ZONE_LABELS: Record<string, { ko: string; en: string }> = {
  center: { ko: 'VWAP 중심권', en: 'VWAP center range' },
  upper_expansion: { ko: '상단 확장', en: 'Upper expansion' },
  strong_upper: { ko: '강한 상단 이격', en: 'Strong upper extension' },
  extreme_upper: { ko: '극단적 상단 이격', en: 'Extreme upper extension' },
  lower_expansion: { ko: '하단 확장', en: 'Lower expansion' },
  strong_lower: { ko: '강한 하단 이격', en: 'Strong lower extension' },
  extreme_lower: { ko: '극단적 하단 이격', en: 'Extreme lower extension' },
};

export default function TradeReferenceSummary({
  vpvr,
  vwaps,
  isKo,
}: {
  vpvr: VPVRData | null;
  vwaps: TradeReportVWAPData | null;
  isKo: boolean;
}) {
  const metrics: Array<{ label: string; value: string; tone?: string }> = [];
  if (vpvr) {
    metrics.push(
      {
        label: `POC · ${vpvr.candle_count}${isKo ? '봉' : ' bars'}`,
        value: `${formatPrice(vpvr.poc_price_low)} - ${formatPrice(vpvr.poc_price_high)}`,
        tone: 'text-amber-300',
      },
      {
        label: 'Value Area 70%',
        value: `${formatPrice(vpvr.value_area_low)} - ${formatPrice(vpvr.value_area_high)}`,
        tone: 'text-primary-300',
      },
      {
        label: isKo ? `${vpvr.candle_count}봉 기간 VWAP` : `${vpvr.candle_count}-bar VWAP`,
        value: formatPrice(vpvr.vwap),
        tone: 'text-cyan-300',
      },
    );
  }
  vwaps?.vwaps.forEach(({ anchor, value }) => {
    metrics.push({
      label: ANCHOR_LABELS[anchor]?.[isKo ? 'ko' : 'en'] || `${anchor} VWAP`,
      value: formatPrice(value),
    });
  });
  vwaps?.rolling_vwaps.forEach(({ window, value }) => {
    metrics.push({
      label: isKo ? `${window}봉 VWAP` : `${window}-bar VWAP`,
      value: formatPrice(value),
      tone: 'text-bull',
    });
  });
  if (vwaps?.vwap_deviation) {
    const { sigma, zone } = vwaps.vwap_deviation;
    metrics.push({
      label: isKo ? '월간 VWAP 편차' : 'Monthly VWAP deviation',
      value: `${sigma == null ? '-' : `${sigma >= 0 ? '+' : ''}${sigma.toFixed(2)}σ`} · ${VWAP_ZONE_LABELS[zone]?.[isKo ? 'ko' : 'en'] || zone}`,
      tone: 'text-primary-300',
    });
  }

  return (
    <section className="border border-dark-700 bg-dark-900/35">
      <header className="flex items-center gap-2 border-b border-dark-700 px-4 py-3 text-sm font-semibold text-white">
        <BarChart3 className="h-4 w-4 text-amber-300" />
        {isKo ? 'VPVR · VWAP 기준값' : 'VPVR · VWAP References'}
      </header>
      {metrics.length ? (
        <dl className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
          {metrics.map(({ label, value, tone }) => (
            <div key={label} className="border-b border-dark-800 px-4 py-3 sm:border-r xl:last:border-r-0">
              <dt className="text-[11px] text-dark-500">{label}</dt>
              <dd className={`mt-1 font-mono text-sm font-semibold ${tone || 'text-dark-100'}`}>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="px-4 py-6 text-center text-xs text-dark-500">
          {isKo ? '선택 시점의 기준값이 없습니다.' : 'No point-in-time references are available.'}
        </div>
      )}
    </section>
  );
}
