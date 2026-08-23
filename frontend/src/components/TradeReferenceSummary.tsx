import { BarChart3 } from 'lucide-react';

import type { TradeReportVWAPData, VPVRData } from '../types';
import { anchoredVwapSampleLabel, anchoredVwapZoneLabel } from '../utils/indicatorLabels';

function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-';
  const digits = value >= 1_000 ? 2 : value >= 1 ? 4 : 6;
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

const ANCHOR_LABELS: Record<string, { ko: string; en: string }> = {
  day: { ko: '일간 VWAP', en: 'Daily VWAP' },
  week: { ko: '주간 VWAP', en: 'Weekly VWAP' },
  month: { ko: '월간 VWAP', en: 'Monthly VWAP' },
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
  const vwapDeviation = vwaps?.vwap_deviation;
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
  const gapPct = vwapDeviation && vwapDeviation.vwap !== 0
    ? (vwapDeviation.current_price - vwapDeviation.vwap) / vwapDeviation.vwap * 100
    : null;

  return (
    <section className="border border-dark-700 bg-dark-900/35">
      <header className="flex items-center gap-2 border-b border-dark-700 px-4 py-3 text-sm font-semibold text-white">
        <BarChart3 className="h-4 w-4 text-amber-300" />
        {isKo ? 'VPVR · VWAP 기준값' : 'VPVR · VWAP References'}
      </header>
      {metrics.length ? <dl className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">{metrics.map(({ label, value, tone }) => (
        <div key={label} className="border-b border-dark-800 px-4 py-3 sm:border-r xl:last:border-r-0">
          <dt className="text-[11px] text-dark-500">{label}</dt>
          <dd className={`mt-1 font-mono text-sm font-semibold ${tone || 'text-dark-100'}`}>{value}</dd>
        </div>
      ))}</dl> : (
        <div className="px-4 py-6 text-center text-xs text-dark-500">
          {isKo ? '선택 시점의 기준값이 없습니다.' : 'No point-in-time references are available.'}
        </div>
      )}
      {vwapDeviation && (
        <section className="border-t border-dark-700 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-white">{isKo ? '월간 Anchored VWAP · 표준편차 밴드' : 'Monthly Anchored VWAP · deviation bands'}</h3>
              <p className="mt-1 text-[10px] text-dark-500">{anchoredVwapSampleLabel(vwapDeviation, isKo)}</p>
            </div>
            <span className="font-mono text-sm font-semibold text-primary-300">{vwapDeviation.sigma == null ? '—' : `${vwapDeviation.sigma >= 0 ? '+' : ''}${vwapDeviation.sigma.toFixed(2)}σ`} · {anchoredVwapZoneLabel(vwapDeviation.zone, isKo)}</span>
          </div>
          <dl className="mt-3 grid grid-cols-3 border border-dark-800 text-xs">
            <div className="px-3 py-2"><dt className="text-dark-500">VWAP</dt><dd className="mt-1 font-mono font-semibold text-dark-100">{formatPrice(vwapDeviation.vwap)}</dd></div>
            <div className="border-x border-dark-800 px-3 py-2"><dt className="text-dark-500">{isKo ? '기준 시점 가격' : 'Reference price'}</dt><dd className="mt-1 font-mono font-semibold text-white">{formatPrice(vwapDeviation.current_price)}</dd></div>
            <div className="px-3 py-2"><dt className="text-dark-500">{isKo ? 'VWAP 대비' : 'vs VWAP'}</dt><dd className={`mt-1 font-mono font-semibold ${gapPct != null && gapPct >= 0 ? 'text-bull' : 'text-bear'}`}>{gapPct == null ? '-' : `${gapPct >= 0 ? '+' : ''}${gapPct.toFixed(2)}%`}</dd></div>
          </dl>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[1, 2, 3].map((band) => <div key={band} className="grid grid-cols-2 gap-2 border border-dark-800 bg-dark-950/35 px-3 py-2 text-[11px]"><span className="text-bear">-{band}σ <strong className="ml-1 font-mono text-dark-200">{formatPrice(vwapDeviation.bands[String(-band)])}</strong></span><span className="text-right text-bull">+{band}σ <strong className="ml-1 font-mono text-dark-200">{formatPrice(vwapDeviation.bands[String(band)])}</strong></span></div>)}
          </div>
        </section>
      )}
    </section>
  );
}
