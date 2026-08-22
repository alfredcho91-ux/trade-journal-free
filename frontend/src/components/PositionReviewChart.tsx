import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';

import type { EntryTimeConfidence } from '../utils/positionReview';
import type { OHLCV, TradeExecutionMarker } from '../types';

interface PositionReviewChartProps {
  data: OHLCV[];
  direction?: string;
  entryTime: string | null;
  entryTimeConfidence?: EntryTimeConfidence;
  exitTime: string;
  entryPrice?: number;
  exitPrice?: number;
  entryEvents?: TradeExecutionMarker[];
  takeProfitEvents?: TradeExecutionMarker[];
  pathEvents?: TradePathChartMarker[];
  height?: number;
}

export interface TradePathChartMarker {
  datetime: string;
  price: number;
  label: string;
  position: 'aboveBar' | 'belowBar' | 'inBar';
  color: string;
}

interface PriceAxisState {
  baseMin: number;
  baseMax: number;
  center: number;
  zoom: number;
}

interface DragState {
  active: boolean;
  pointerId: number | null;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  mode: 'horizontal' | 'vertical' | null;
}

function formatPrice(value: number): string {
  const digits = value >= 1_000 ? 0 : value >= 1 ? 2 : 4;
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function candleTimeAt(data: OHLCV[], datetime: string | null): UTCTimestamp | null {
  if (!datetime || data.length === 0) return null;
  const target = new Date(datetime).getTime();
  if (!Number.isFinite(target) || target < data[0].open_time) return null;

  let selected = data[0].open_time;
  for (const candle of data) {
    if (candle.open_time > target) break;
    selected = candle.open_time;
  }
  return Math.floor(selected / 1000) as UTCTimestamp;
}

function basePriceAxis(
  data: OHLCV[],
  entryPrice?: number,
  exitPrice?: number,
  eventPrices: number[] = [],
): PriceAxisState {
  const values = [
    ...data.flatMap((candle) => [candle.low, candle.high]),
    ...(entryPrice != null ? [entryPrice] : []),
    ...(exitPrice != null ? [exitPrice] : []),
    ...eventPrices,
  ].filter(Number.isFinite);
  if (values.length === 0) {
    return { baseMin: 0, baseMax: 1, center: 0.5, zoom: 1 };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * 0.06, max * 0.001, 1);
  const baseMin = Math.max(0, min - padding);
  const baseMax = max + padding;
  return {
    baseMin,
    baseMax,
    center: data[data.length - 1]?.close ?? (baseMin + baseMax) / 2,
    zoom: 1,
  };
}

export default function PositionReviewChart({
  data,
  direction,
  entryTime,
  entryTimeConfidence = 'confirmed',
  exitTime,
  entryPrice,
  exitPrice,
  entryEvents = [],
  takeProfitEvents = [],
  pathEvents = [],
  height = 520,
}: PositionReviewChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markerRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const candleDataRef = useRef<CandlestickData<UTCTimestamp>[]>([]);
  const candleCountRef = useRef(0);
  const horizontalZoomRef = useRef(1);
  const priceAxisRef = useRef<PriceAxisState>({ baseMin: 0, baseMax: 1, center: 0.5, zoom: 1 });
  const dragRef = useRef<DragState>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    mode: null,
  });

  const applyPriceAxis = () => {
    const series = seriesRef.current;
    if (!series) return;
    const state = priceAxisRef.current;
    const halfRange = (state.baseMax - state.baseMin) / (state.zoom * 2);
    const minValue = Math.max(0, state.center - halfRange);
    const maxValue = state.center + halfRange;
    series.applyOptions({
      autoscaleInfoProvider: () => ({ priceRange: { minValue, maxValue } }),
    });
  };

  const applyHorizontalZoom = () => {
    const chart = chartRef.current;
    const candleCount = candleCountRef.current;
    if (!chart || candleCount === 0) return;
    const visibleBars = Math.max(20, candleCount / horizontalZoomRef.current);
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(-0.5, candleCount - visibleBars),
      to: candleCount - 0.5,
    });
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#0b1220' },
        textColor: '#94a3b8',
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: 'rgba(51, 65, 85, 0.35)' },
        horzLines: { color: 'rgba(51, 65, 85, 0.35)' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#334155', scaleMargins: { top: 0, bottom: 0 } },
      timeScale: {
        borderColor: '#334155',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
      },
      handleScroll: {
        mouseWheel: false,
        pressedMouseMove: false,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: false,
        pinch: true,
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#4ade80',
      wickDownColor: '#f87171',
      priceLineVisible: false,
      lastValueVisible: true,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const legend = document.createElement('div');
    legend.className = 'pointer-events-none absolute left-2 top-1 z-20 text-[10px] font-mono text-dark-300';
    container.appendChild(legend);
    legendRef.current = legend;
    const setLegend = (bar?: CandlestickData<UTCTimestamp>) => {
      if (!bar) return;
      legend.textContent = `O ${formatPrice(bar.open)}  H ${formatPrice(bar.high)}  L ${formatPrice(bar.low)}  C ${formatPrice(bar.close)}`;
    };
    chart.subscribeCrosshairMove((param) => {
      const bar = param.seriesData.get(series) as CandlestickData<UTCTimestamp> | undefined;
      setLegend(bar || candleDataRef.current[candleDataRef.current.length - 1]);
    });

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.18 : 1 / 1.18;
      if (event.shiftKey) {
        horizontalZoomRef.current = Math.max(0.35, Math.min(20, horizontalZoomRef.current * factor));
        applyHorizontalZoom();
        return;
      }
      priceAxisRef.current.zoom = Math.max(0.35, Math.min(12, priceAxisRef.current.zoom * factor));
      applyPriceAxis();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      dragRef.current = {
        active: true,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        mode: null,
      };
      container.setPointerCapture(event.pointerId);
      container.style.cursor = 'grabbing';
    };
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag.active) return;
      if (drag.mode == null) {
        const totalX = event.clientX - drag.startX;
        const totalY = event.clientY - drag.startY;
        if (Math.max(Math.abs(totalX), Math.abs(totalY)) < 3) return;
        drag.mode = Math.abs(totalX) > Math.abs(totalY) ? 'horizontal' : 'vertical';
      }

      const deltaX = event.clientX - drag.lastX;
      const deltaY = event.clientY - drag.lastY;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      if (drag.mode === 'horizontal') {
        horizontalZoomRef.current = Math.max(
          0.35,
          Math.min(20, horizontalZoomRef.current * Math.exp(-deltaX / 220)),
        );
        applyHorizontalZoom();
      } else {
        const state = priceAxisRef.current;
        const visibleRange = (state.baseMax - state.baseMin) / state.zoom;
        state.center += deltaY * (visibleRange / height);
        applyPriceAxis();
      }
    };
    const finishDrag = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag.active) return;
      drag.active = false;
      drag.mode = null;
      drag.pointerId = null;
      if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
      container.style.cursor = 'grab';
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', finishDrag);
    container.addEventListener('pointercancel', finishDrag);
    const resizeObserver = new ResizeObserver(([entry]) => {
      chart.resize(Math.floor(entry.contentRect.width), height);
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', finishDrag);
      container.removeEventListener('pointercancel', finishDrag);
      legend.remove();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markerRef.current = null;
      priceLinesRef.current = [];
      legendRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series || data.length === 0) return;

    const candleData: CandlestickData<UTCTimestamp>[] = data.map((candle) => ({
      time: Math.floor(candle.open_time / 1000) as UTCTimestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
    candleDataRef.current = candleData;
    candleCountRef.current = candleData.length;
    series.setData(candleData);
    if (legendRef.current) {
      const last = candleData[candleData.length - 1];
      legendRef.current.textContent = `O ${formatPrice(last.open)}  H ${formatPrice(last.high)}  L ${formatPrice(last.low)}  C ${formatPrice(last.close)}`;
    }

    const isLong = direction === 'Long';
    const isCompact = containerRef.current ? containerRef.current.clientWidth < 560 : false;
    const markers: SeriesMarker<UTCTimestamp>[] = [];
    const entryMarkerTime = candleTimeAt(data, entryTime);
    const exitMarkerTime = candleTimeAt(data, exitTime);
    const visibleEntryEvents = entryEvents.flatMap((event) => {
      const time = candleTimeAt(data, event.datetime);
      return time == null ? [] : [{ ...event, time }];
    });
    if (visibleEntryEvents.length > 0) {
      visibleEntryEvents.forEach((event, index) => {
        const label = index === 0 ? 'ENTRY' : event.label;
        const confidenceLabel = index === 0 && entryTimeConfidence === 'estimated' ? ' ~' : '';
        const priceLabel = formatPrice(event.price);
        markers.push({
          time: event.time,
          position: isLong ? 'belowBar' : 'aboveBar',
          color: index === 0 ? (isLong ? '#22c55e' : '#ef4444') : '#60a5fa',
          shape: isLong ? 'arrowUp' : 'arrowDown',
          text: isCompact ? label : `${label}${confidenceLabel} ${priceLabel}`,
        });
      });
    } else if (entryMarkerTime != null) {
      const confidenceLabel = entryTimeConfidence === 'estimated' ? ' ~' : '';
      markers.push({
        time: entryMarkerTime,
        position: isLong ? 'belowBar' : 'aboveBar',
        color: isLong ? '#22c55e' : '#ef4444',
        shape: isLong ? 'arrowUp' : 'arrowDown',
        text: isCompact ? '' : `${isLong ? 'LONG' : 'SHORT'} ENTRY${confidenceLabel}`,
      });
    }

    const visibleTakeProfits = takeProfitEvents.flatMap((event) => {
      const time = candleTimeAt(data, event.datetime);
      return time == null ? [] : [{ ...event, time }];
    });
    visibleTakeProfits.forEach((event) => {
      markers.push({
        time: event.time,
        position: isLong ? 'aboveBar' : 'belowBar',
        color: '#22d3ee',
        shape: isLong ? 'arrowDown' : 'arrowUp',
        text: isCompact ? event.label : `${event.label} ${formatPrice(event.price)}`,
      });
    });
    const visiblePathEvents = pathEvents.flatMap((event) => {
      const time = candleTimeAt(data, event.datetime);
      return time == null ? [] : [{ ...event, time }];
    });
    visiblePathEvents.forEach((event) => {
      markers.push({
        time: event.time,
        position: event.position,
        color: event.color,
        shape: 'circle',
        text: isCompact ? '' : `${event.label} ${formatPrice(event.price)}`,
      });
    });
    const exitIsTakeProfit = exitMarkerTime != null && visibleTakeProfits.some(
      (event) => event.time === exitMarkerTime,
    );
    if (exitMarkerTime != null && !exitIsTakeProfit) {
      markers.push({
        time: exitMarkerTime,
        position: isLong ? 'aboveBar' : 'belowBar',
        color: '#fbbf24',
        shape: isLong ? 'arrowDown' : 'arrowUp',
        text: isCompact ? '' : 'EXIT',
      });
    }
    markers.sort((a, b) => Number(a.time) - Number(b.time));
    if (markerRef.current) markerRef.current.setMarkers(markers);
    else markerRef.current = createSeriesMarkers(series, markers);

    for (const priceLine of priceLinesRef.current) series.removePriceLine(priceLine);
    priceLinesRef.current = [];
    if (entryPrice != null && Number.isFinite(entryPrice)) {
      priceLinesRef.current.push(series.createPriceLine({
        price: entryPrice,
        color: isLong ? '#22c55e' : '#ef4444',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: entryTimeConfidence === 'estimated' ? 'ENTRY ~' : 'ENTRY',
      }));
    }
    if (exitPrice != null && Number.isFinite(exitPrice)) {
      priceLinesRef.current.push(series.createPriceLine({
        price: exitPrice,
        color: '#fbbf24',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'EXIT',
      }));
    }
    const takeProfitLines = new Map<string, TradeExecutionMarker>();
    takeProfitEvents.forEach((event) => {
      if (Number.isFinite(event.price) && !takeProfitLines.has(event.label)) {
        takeProfitLines.set(event.label, event);
      }
    });
    takeProfitLines.forEach((event) => {
      priceLinesRef.current.push(series.createPriceLine({
        price: event.price,
        color: '#22d3ee',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: event.label,
      }));
    });

    priceAxisRef.current = basePriceAxis(
      data,
      entryPrice,
      exitPrice,
      [...entryEvents, ...takeProfitEvents, ...pathEvents].map((event) => event.price),
    );
    horizontalZoomRef.current = 1;
    applyPriceAxis();
    chart.timeScale().fitContent();
  }, [
    data,
    direction,
    entryEvents,
    entryPrice,
    entryTime,
    entryTimeConfidence,
    exitPrice,
    exitTime,
    height,
    pathEvents,
    takeProfitEvents,
  ]);

  return (
    <div className="overflow-hidden border border-dark-700 bg-dark-800/30">
      <div
        ref={containerRef}
        className="relative w-full"
        style={{ height, cursor: 'grab', touchAction: 'none' }}
        title="Wheel: vertical zoom · Shift + wheel: horizontal zoom · Drag up/down: move price axis · Drag left/right: horizontal zoom"
      />
    </div>
  );
}
