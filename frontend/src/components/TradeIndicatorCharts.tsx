import { Activity, Gauge, Waves } from 'lucide-react';

import type { IndicatorSeriesData } from '../types';
import { MiniChart } from './MiniChart';
import { StochMiniChart } from './StochMiniChart';

interface TradeIndicatorChartsProps {
  series: Record<string, IndicatorSeriesData>;
  latest: Record<string, number | null> | null;
  entryTime: string | null;
  exitTime: string | null;
  referenceLabel: 'ENTRY' | 'EXIT';
}

function formatValue(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function IndicatorPanel({
  title,
  icon,
  values,
  referenceLabel,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  values: Array<{ label: string; value: string; tone?: string }>;
  referenceLabel: 'ENTRY' | 'EXIT';
  children: React.ReactNode;
}) {
  return (
    <section className="border border-dark-700 bg-dark-900/35 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
        {icon}
        {title}
      </div>
      <div className="relative">
        <div
          className="pointer-events-none absolute right-2 top-1 z-30 flex flex-wrap justify-end gap-x-3 gap-y-0.5 text-[10px]"
          style={{ textShadow: '0 1px 3px #020617, 0 0 5px #020617' }}
        >
          <span className="font-semibold text-dark-400">{referenceLabel}</span>
          {values.map(({ label, value, tone }) => (
            <span key={label}>
              <span className="text-dark-400">{label} </span>
              <span className={`font-mono ${tone || 'text-dark-100'}`}>{value}</span>
            </span>
          ))}
        </div>
        {children}
      </div>
    </section>
  );
}

export default function TradeIndicatorCharts({
  series,
  latest,
  entryTime,
  exitTime,
  referenceLabel,
}: TradeIndicatorChartsProps) {
  const volume = series.volume;
  const rsi = series.rsi;
  const macd = series.macd;
  const stochRsi = series.stoch_rsi_k;
  const slowSettings = [
    { key: '5', label: '5-3-3' },
    { key: '10', label: '10-6-6' },
    { key: '20', label: '20-12-12' },
  ];
  const timeMarkers = [
    { datetime: entryTime, label: 'ENTRY', color: '#22c55e' },
    { datetime: exitTime, label: 'EXIT', color: '#fbbf24' },
  ];

  return (
    <div className="flex flex-col gap-3">
      <IndicatorPanel
        title="RSI (14)"
        icon={<Gauge className="h-4 w-4 text-primary-400" />}
        values={[{ label: 'RSI', value: formatValue(latest?.rsi, 1) }]}
        referenceLabel={referenceLabel}
      >
        <MiniChart t={rsi?.t || []} v={rsi?.v || []} volume={volume} yRefs={[30, 50, 70]} markers={timeMarkers} height={130} />
      </IndicatorPanel>

      <IndicatorPanel
        title="MACD (12, 26, 9)"
        icon={<Activity className="h-4 w-4 text-primary-400" />}
        values={[
          { label: 'Line', value: formatValue(latest?.macd, 4), tone: 'text-primary-300' },
          { label: 'Signal', value: formatValue(latest?.macd_signal, 4), tone: 'text-amber-300' },
          {
            label: 'Histogram',
            value: formatValue(latest?.macd_hist, 4),
            tone: (latest?.macd_hist || 0) >= 0 ? 'text-bull' : 'text-bear',
          },
        ]}
        referenceLabel={referenceLabel}
      >
        <StochMiniChart
          tk={macd?.t || []}
          vk={macd?.v || []}
          td={series.macd_signal?.t}
          vd={series.macd_signal?.v}
          histogram={series.macd_hist}
          yRefs={[0]}
          showCrossLabels
          markers={timeMarkers}
          height={140}
        />
      </IndicatorPanel>

      <IndicatorPanel
        title="Stoch RSI (14, 14, 3, 3)"
        icon={<Waves className="h-4 w-4 text-primary-400" />}
        values={[
          { label: 'K', value: formatValue(latest?.stoch_rsi_k, 1), tone: 'text-primary-300' },
          { label: 'D', value: formatValue(latest?.stoch_rsi_d, 1), tone: 'text-amber-300' },
        ]}
        referenceLabel={referenceLabel}
      >
        <StochMiniChart
          tk={stochRsi?.t || []}
          vk={stochRsi?.v || []}
          td={series.stoch_rsi_d?.t}
          vd={series.stoch_rsi_d?.v}
          yRefs={[20, 80]}
          showCrossLabels
          markers={timeMarkers}
          height={130}
        />
      </IndicatorPanel>

      {slowSettings.map(({ key, label }) => {
        const kSeries = series[`slow_stoch_${key}k`];
        return (
          <IndicatorPanel
            key={key}
            title={`Slow Stochastic (${label})`}
            icon={<Waves className="h-4 w-4 text-primary-400" />}
            values={[
              { label: 'K', value: formatValue(latest?.[`slow_stoch_${key}k`], 1), tone: 'text-primary-300' },
              { label: 'D', value: formatValue(latest?.[`slow_stoch_${key}d`], 1), tone: 'text-amber-300' },
            ]}
            referenceLabel={referenceLabel}
          >
            <StochMiniChart
              tk={kSeries?.t || []}
              vk={kSeries?.v || []}
              td={series[`slow_stoch_${key}d`]?.t}
              vd={series[`slow_stoch_${key}d`]?.v}
              yRefs={[20, 80]}
              markers={timeMarkers}
              height={130}
            />
          </IndicatorPanel>
        );
      })}
    </div>
  );
}
