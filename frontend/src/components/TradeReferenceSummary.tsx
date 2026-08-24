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
  const vwapDeviations = vwaps?.vwap_deviations?.length
    ? vwaps.vwap_deviations
    : vwaps?.vwap_deviation ? [vwaps.vwap_deviation] : [];
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

  return (
    <section className="border border-dark-700 bg-dark-900/35">
      <header className="flex items-center gap-2 border-b border-dark-700 px-4 py-3 text-sm font-semibold text-white">
        <BarChart3 className="h-4 w-4 text-amber-300" />
        {isKo ? 'VPVR · VWAP 기준값' : 'VPVR · VWAP References'}
      </header>
      {metrics.length ? <dl className="grid grid-cols-1">{metrics.map(({ label, value, tone }) => (
        <div key={label} className="border-b border-dark-800 px-4 py-3 last:border-b-0">
          <dt className="text-[11px] text-dark-500">{label}</dt>
          <dd className={`mt-1 font-mono text-sm font-semibold ${tone || 'text-dark-100'}`}>{value}</dd>
        </div>
      ))}</dl> : (
        <div className="px-4 py-6 text-center text-xs text-dark-500">
          {isKo ? '선택 시점의 기준값이 없습니다.' : 'No point-in-time references are available.'}
        </div>
      )}
      {vwapDeviations.length > 0 && (
        <section className="border-t border-dark-700 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-white">{isKo ? '일간 · 주간 · 월간 Anchored VWAP 표준편차' : 'Daily · Weekly · Monthly Anchored VWAP deviation'}</h3>
              <p className="mt-1 text-[10px] text-dark-500">{isKo ? '각 앵커의 VWAP 대비 현재 위치입니다. HLC3 · 최근 완료봉 14개 표준편차 기준.' : 'Current location relative to each anchored VWAP. HLC3 with a 14 completed-candle deviation window.'}</p>
            </div>
          </div>
          <div className="mt-3 grid gap-2">{vwapDeviations.map((vwapDeviation) => {
            const gapPct = vwapDeviation.vwap !== 0 ? (vwapDeviation.current_price - vwapDeviation.vwap) / vwapDeviation.vwap * 100 : null;
            return <article key={vwapDeviation.anchor} className="border border-dark-800 bg-dark-950/35 p-3 text-xs"><div className="flex items-center justify-between gap-2"><strong className="text-dark-100">{ANCHOR_LABELS[vwapDeviation.anchor]?.[isKo ? 'ko' : 'en'] || `${vwapDeviation.anchor} VWAP`}</strong><span className="font-mono font-semibold text-primary-300">{vwapDeviation.sigma == null ? '—' : `${vwapDeviation.sigma >= 0 ? '+' : ''}${vwapDeviation.sigma.toFixed(2)}σ`}</span></div><div className="mt-1 text-[10px] text-dark-500">{anchoredVwapZoneLabel(vwapDeviation.zone, isKo)} · {anchoredVwapSampleLabel(vwapDeviation, isKo)}</div><dl className="mt-3 grid grid-cols-2 gap-y-2"><div><dt className="text-dark-500">VWAP</dt><dd className="mt-0.5 font-mono text-dark-100">{formatPrice(vwapDeviation.vwap)}</dd></div><div><dt className="text-dark-500">{isKo ? 'VWAP 대비' : 'vs VWAP'}</dt><dd className={`mt-0.5 font-mono ${gapPct != null && gapPct >= 0 ? 'text-bull' : 'text-bear'}`}>{gapPct == null ? '-' : `${gapPct >= 0 ? '+' : ''}${gapPct.toFixed(2)}%`}</dd></div></dl><div className="mt-3 grid grid-cols-2 gap-1 text-[10px]"><span className="text-bear">-1σ {formatPrice(vwapDeviation.bands['-1'])}</span><span className="text-bull">+1σ {formatPrice(vwapDeviation.bands['1'])}</span><span className="text-bear">-2σ {formatPrice(vwapDeviation.bands['-2'])}</span><span className="text-bull">+2σ {formatPrice(vwapDeviation.bands['2'])}</span><span className="text-bear">-3σ {formatPrice(vwapDeviation.bands['-3'])}</span><span className="text-bull">+3σ {formatPrice(vwapDeviation.bands['3'])}</span></div></article>;
          })}</div>
        </section>
      )}
    </section>
  );
}
