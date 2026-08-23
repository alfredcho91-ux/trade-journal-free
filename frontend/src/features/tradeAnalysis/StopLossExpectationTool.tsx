import { useMemo, useState } from 'react';
import { Calculator, Info, Loader2 } from 'lucide-react';

import type { AnalyzedTrade } from './tradeAnalysis';
import { calculateStopLossExpectation } from './stopLossExpectation';

type Props = {
  trades: AnalyzedTrade[];
  direction: 'Long' | 'Short';
  isLoading: boolean;
  isKo: boolean;
};

function number(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function signed(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${number(value, digits)}`;
}

function Metric({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'positive' | 'negative' | 'neutral' }) {
  const color = tone === 'positive' ? 'text-bull' : tone === 'negative' ? 'text-bear' : 'text-white';
  return (
    <div className="border-b border-dark-800 px-3 py-3 sm:border-r sm:last:border-r-0 lg:border-b-0">
      <div className="text-[10px] text-dark-500">{label}</div>
      <div className={`mt-1 whitespace-nowrap font-mono text-lg ${color}`}>{value}</div>
    </div>
  );
}

export default function StopLossExpectationTool({ trades, direction, isLoading, isKo }: Props) {
  const [stopPct, setStopPctState] = useState(1);
  const minimum = 0.1;
  const maximum = 15;
  const step = 0.1;
  const result = useMemo(
    () => calculateStopLossExpectation(trades, stopPct),
    [stopPct, trades],
  );

  const setStopPct = (value: number) => {
    if (!Number.isFinite(value)) return;
    const next = Math.min(maximum, Math.max(minimum, value));
    setStopPctState(next);
  };
  const changeTone = (result.expectancyDeltaPctPoints || 0) >= 0 ? 'text-bull' : 'text-bear';

  return (
    <section className="border border-dark-700 bg-dark-900/20">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-dark-700 px-4 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Calculator className="h-4 w-4 text-primary-300" />
            {isKo ? 'N% 손절 기대값 계산기' : 'N% Stop Expectancy Calculator'}
          </h2>
          <p className="mt-1 text-[11px] text-dark-500">
            {isKo ? '선택한 기간의 거래를 15분봉 가격 흐름으로 다시 살펴보고, 같은 손절 기준을 적용해 계산합니다' : 'Rechecks the selected trades using 15m price movements and the same stop-loss rule'}
          </p>
        </div>
        <span className="font-mono text-xs text-dark-400">{direction.toUpperCase()} · n={result.tradeCount}</span>
      </div>

      <div className="grid gap-4 border-b border-dark-700 p-4 lg:grid-cols-[220px_minmax(0,1fr)_110px] lg:items-end">
        <div>
          <div className="mb-1.5 text-[10px] text-dark-500">{isKo ? '손절 기준' : 'Stop basis'}</div>
          <div className="flex min-h-10 items-center border border-dark-700 bg-dark-900/40 px-3 text-xs font-medium text-primary-200">
            {isKo ? '코인 가격 변동률' : 'Coin price movement'}
          </div>
        </div>
        <label className="block min-w-0">
          <span className="mb-2 flex justify-between text-[10px] text-dark-500">
            <span>{isKo ? '가상 손절률' : 'Simulated stop'}</span>
            <span>{minimum}% - {maximum}%</span>
          </span>
          <input
            type="range"
            min={minimum}
            max={maximum}
            step={step}
            value={stopPct}
            onChange={(event) => setStopPct(Number(event.target.value))}
            className="h-2 w-full cursor-pointer accent-primary-400"
            aria-label={isKo ? '가상 손절률 슬라이더' : 'Simulated stop slider'}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[10px] text-dark-500">{isKo ? '손절률' : 'Stop rate'}</span>
          <div className="flex items-center border border-dark-700 bg-dark-900/50 px-2">
            <input
              type="number"
              min={minimum}
              max={maximum}
              step={step}
              value={stopPct}
              onChange={(event) => setStopPct(Number(event.target.value))}
              className="min-w-0 flex-1 bg-transparent py-2 text-right font-mono text-sm text-white outline-none"
              aria-label={isKo ? '가상 손절률 입력' : 'Simulated stop input'}
            />
            <span className="ml-1 text-xs text-dark-500">%</span>
          </div>
        </label>
      </div>

      {isLoading ? (
        <div className="flex min-h-32 items-center justify-center text-xs text-dark-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />{isKo ? '거래 경로 계산 중' : 'Calculating trade paths'}
        </div>
      ) : result.tradeCount === 0 ? (
        <div className="px-4 py-6 text-sm text-dark-400">
          {isKo ? '선택 방향에서 가격 기준 MAE 경로가 확인되는 거래가 없습니다.' : 'No trades have the required price-based MAE path.'}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 border-b border-dark-700 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label={isKo ? '거래당 기대 가격수익률' : 'Expected price return / trade'} value={`${signed(result.expectancyPct)}%`} tone={(result.expectancyPct || 0) >= 0 ? 'positive' : 'negative'} />
            <Metric label={isKo ? '평균 수익률' : 'Average win'} value={`${signed(result.averageWinPct)}%`} tone="positive" />
            <Metric label={isKo ? '평균 손실률' : 'Average loss'} value={`${signed(result.averageLossPct)}%`} tone="negative" />
            <Metric label={isKo ? '예상 승률' : 'Expected win rate'} value={`${number(result.winRatePct)}%`} />
            <Metric label={isKo ? '손절 발동률' : 'Stop hit rate'} value={`${number(result.stopHitRatePct)}%`} />
            <Metric label="Profit Factor" value={result.profitFactor === Infinity ? '∞' : number(result.profitFactor, 2)} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 text-xs">
            <div className="text-dark-300">
              {isKo ? '실제 가격 움직임 평균' : 'Actual price-move average'} <strong className="font-mono text-white">{signed(result.baselineExpectancyPct)}%</strong>
              <span className="mx-2 text-dark-700">→</span>
              {stopPct}% Stop <strong className="font-mono text-white">{signed(result.expectancyPct)}%</strong>
              <span className={`ml-2 font-mono ${changeTone}`}>({signed(result.expectancyDeltaPctPoints)}%p)</span>
            </div>
            <div className="text-dark-500">
              {isKo ? '손절' : 'Stops'} {result.stopHitCount}{isKo ? '건' : ''} · {isKo ? '이 중 실제 수익 종료' : 'actual winners stopped'} {result.falseStopCount}{isKo ? '건' : ''} ({number(result.falseStopRatePct)}%)
            </div>
          </div>
        </>
      )}

      <details className="border-t border-dark-800 px-4 py-2 text-[10px] leading-4 text-dark-600" open>
        <summary className="flex cursor-pointer items-center gap-1 text-dark-500"><Info className="h-3 w-3" />{isKo ? '계산 기준과 한계' : 'Method and limitations'}</summary>
        <p className="mt-2">
          {isKo
            ? '진입가 대비 방향 반영 MAE가 N%에 닿으면 -N%, 닿지 않으면 실제 진입가 대비 청산가의 방향 반영 가격 수익률을 사용합니다. 레버리지, 투자금, 수수료, 펀딩은 계산에 넣지 않습니다. 가상 조기청산 시점의 슬리피지와 한 15분봉 안에서의 가격 순서는 알 수 없어 반영하지 않은 과거 경로 시뮬레이션이며 미래 성과를 보장하지 않습니다.'
            : 'If direction-adjusted MAE reaches N% from entry, the result is -N%; otherwise it uses the direction-adjusted entry-to-exit price return. Leverage, margin, fees, and funding are excluded. Slippage and intrabar ordering are unavailable, so this is a historical path simulation rather than a forecast.'}
        </p>
        {result.excludedTradeCount > 0 && <p className="mt-1 text-amber-400/80">{isKo ? `필수 경로 데이터가 없는 ${result.excludedTradeCount}건은 제외했습니다.` : `${result.excludedTradeCount} trades without required path data were excluded.`}</p>}
      </details>
    </section>
  );
}
