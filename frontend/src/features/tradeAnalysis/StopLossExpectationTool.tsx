import { useMemo, useState } from 'react';
import { Calculator, Info, Loader2 } from 'lucide-react';

import type { AnalyzedTrade } from './tradeAnalysis';
import {
  calculateStopLossExpectation,
  type StopLossBasis,
} from './stopLossExpectation';

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
  const [basis, setBasis] = useState<StopLossBasis>('margin');
  const [marginStopPct, setMarginStopPct] = useState(10);
  const [priceStopPct, setPriceStopPct] = useState(1);
  const stopPct = basis === 'margin' ? marginStopPct : priceStopPct;
  const minimum = 0.1;
  const maximum = basis === 'margin' ? 100 : 15;
  const step = 0.1;
  const result = useMemo(
    () => calculateStopLossExpectation(trades, stopPct, basis),
    [basis, stopPct, trades],
  );

  const setStopPct = (value: number) => {
    if (!Number.isFinite(value)) return;
    const next = Math.min(maximum, Math.max(minimum, value));
    if (basis === 'margin') setMarginStopPct(next);
    else setPriceStopPct(next);
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
            {isKo ? '선택 기간의 실제 15분봉 MAE 경로를 같은 손절 기준으로 다시 계산' : 'Replays the selected trades with one stop threshold using actual 15m MAE'}
          </p>
        </div>
        <span className="font-mono text-xs text-dark-400">{direction.toUpperCase()} · n={result.tradeCount}</span>
      </div>

      <div className="grid gap-4 border-b border-dark-700 p-4 lg:grid-cols-[280px_minmax(0,1fr)_110px] lg:items-end">
        <div>
          <div className="mb-1.5 text-[10px] text-dark-500">{isKo ? '손절 기준' : 'Stop basis'}</div>
          <div className="grid grid-cols-2 border border-dark-700 bg-dark-900/40 p-1">
            {([
              ['margin', isKo ? '투자금 기준' : 'Margin return'],
              ['price', isKo ? '가격 기준' : 'Price move'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setBasis(id)}
                className={`min-h-8 px-2 text-xs font-medium ${basis === id ? 'bg-primary-500/20 text-primary-200' : 'text-dark-400 hover:text-white'}`}
              >
                {label}
              </button>
            ))}
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
          {isKo ? '선택 방향에서 MAE·레버리지 경로가 모두 확인되는 거래가 없습니다.' : 'No trades have the required MAE and leverage data.'}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 border-b border-dark-700 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label={isKo ? (basis === 'margin' ? '거래당 기대 순수익률' : '거래당 기대 가격수익률') : 'Expected return / trade'} value={`${signed(result.expectancyPct)}%`} tone={(result.expectancyPct || 0) >= 0 ? 'positive' : 'negative'} />
            <Metric label={isKo ? '평균 수익률' : 'Average win'} value={`${signed(result.averageWinPct)}%`} tone="positive" />
            <Metric label={isKo ? '평균 손실률' : 'Average loss'} value={`${signed(result.averageLossPct)}%`} tone="negative" />
            <Metric label={isKo ? '예상 승률' : 'Expected win rate'} value={`${number(result.winRatePct)}%`} />
            <Metric label={isKo ? '손절 발동률' : 'Stop hit rate'} value={`${number(result.stopHitRatePct)}%`} />
            <Metric label="Profit Factor" value={result.profitFactor === Infinity ? '∞' : number(result.profitFactor, 2)} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 text-xs">
            <div className="text-dark-300">
              {isKo ? (basis === 'margin' ? '현재 실제 순수익률 평균' : '실제 가격 움직임 평균') : 'Actual-exit average'} <strong className="font-mono text-white">{signed(result.baselineExpectancyPct)}%</strong>
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

      <details className="border-t border-dark-800 px-4 py-2 text-[10px] leading-4 text-dark-600">
        <summary className="flex cursor-pointer items-center gap-1 text-dark-500"><Info className="h-3 w-3" />{isKo ? '계산 기준과 한계' : 'Method and limitations'}</summary>
        <p className="mt-2">
          {isKo
            ? 'MAE가 손절률에 닿은 거래는 -N%에서 해당 거래의 투자금 대비 수수료율을 추가 차감하고, 닿지 않은 거래는 수수료·펀딩이 반영된 실제 순수익률을 유지합니다. 가격 기준은 비용 전 가격 움직임만 비교합니다. 가상 조기청산 시점의 펀딩·슬리피지와 한 15분봉 안에서의 가격 순서는 알 수 없어 반영하지 않은 과거 경로 시뮬레이션이며 미래 성과를 보장하지 않습니다.'
            : 'A margin stop is set to -N% minus that trade’s fee rate; an untouched trade keeps its realized net return. Price mode compares pre-cost price movement. Funding at the hypothetical exit, slippage, and intrabar ordering are unavailable, so this is a historical path simulation rather than a forecast.'}
        </p>
        {result.excludedTradeCount > 0 && <p className="mt-1 text-amber-400/80">{isKo ? `필수 경로 데이터가 없는 ${result.excludedTradeCount}건은 제외했습니다.` : `${result.excludedTradeCount} trades without required path data were excluded.`}</p>}
      </details>
    </section>
  );
}
