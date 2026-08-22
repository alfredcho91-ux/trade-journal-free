import { useMemo, useState } from 'react';
import { GitCompareArrows, RotateCcw, TrendingDown, TrendingUp } from 'lucide-react';

import { useLanguage } from '../store/useStore';
import { BASE_FEE_PERCENT, calculateHoldReentry, MAX_LEVERAGE, type HoldReentryInputs, type TradeDirection } from '../utils/holdReentry';

const DEFAULT_INPUTS: HoldReentryInputs = {
  direction: 'long', entryPrice: 64_000, currentPrice: 63_600, reentryPrice: 63_000,
  targetPrice: 65_000, marginUsd: 1_000, leverage: 1, feePercent: BASE_FEE_PERCENT,
};

type Field = keyof HoldReentryInputs;

function money(value: number): string {
  const digits = Math.abs(value) >= 1_000 ? 0 : 2;
  return `${value >= 0 ? '+' : '-'}$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: digits })}`;
}

function pct(value: number): string { return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`; }
function tone(value: number): string { return value > 0 ? 'text-bull' : value < 0 ? 'text-bear' : 'text-dark-300'; }

function Row({ label, value, className = 'text-white' }: { label: string; value: string; className?: string }) {
  return <div className="flex items-baseline justify-between gap-3 border-b border-dark-800 py-2 last:border-0"><span className="text-dark-400">{label}</span><strong className={`font-mono ${className}`}>{value}</strong></div>;
}

export default function HoldReentryPage() {
  const isKo = useLanguage() === 'ko';
  const [inputs, setInputs] = useState<HoldReentryInputs>(DEFAULT_INPUTS);
  const result = useMemo(() => calculateHoldReentry(inputs), [inputs]);
  const setNumber = (field: Exclude<Field, 'direction'>, value: number) => setInputs((previous) => ({ ...previous, [field]: Number.isFinite(value) ? value : 0 }));
  const fields: Array<{ field: Exclude<Field, 'direction'>; label: string; max?: number }> = [
    { field: 'entryPrice', label: isKo ? '기존 진입가' : 'Initial entry' },
    { field: 'currentPrice', label: isKo ? '현재가' : 'Current price' },
    { field: 'reentryPrice', label: isKo ? '예상 재진입가' : 'Expected re-entry' },
    { field: 'targetPrice', label: isKo ? '목표가' : 'Target price' },
    { field: 'marginUsd', label: isKo ? '투입금 (USDT)' : 'Margin (USDT)' },
    { field: 'leverage', label: isKo ? '레버리지 (배)' : 'Leverage (x)', max: MAX_LEVERAGE },
    { field: 'feePercent', label: isKo ? '편도 수수료 (%)' : 'One-way fee (%)', max: 10 },
  ];
  const verdict = result.netReentryAdvantage === 0
    ? (isKo ? '두 선택의 최종 손익이 같습니다.' : 'Both choices have the same result.')
    : result.netReentryAdvantage > 0
      ? (isKo ? '재진입이 수수료를 빼고도 더 유리합니다.' : 'Re-entry is favorable after fees.')
      : (isKo ? '재진입에 성공해도 홀딩이 더 유리합니다.' : 'Holding remains favorable even after re-entry.');

  return <div className="mx-auto max-w-6xl space-y-5">
    <header className="border-b border-dark-700 pb-4"><h1 className="flex items-center gap-2 text-xl font-bold text-white"><GitCompareArrows className="h-5 w-5 text-primary-400" />{isKo ? '홀딩 / 재진입 계산기' : 'Hold / Re-entry Calculator'}</h1></header>
    <div className="grid items-start gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
      <section className="border border-dark-700 bg-dark-900/20 p-4">
        <div className="flex items-center justify-between border-b border-dark-700 pb-3"><h2 className="text-sm font-semibold text-white">{isKo ? '가격과 비용' : 'Prices and costs'}</h2><button type="button" onClick={() => setInputs(DEFAULT_INPUTS)} className="p-1.5 text-dark-400 hover:text-white" title={isKo ? '예시 값으로 초기화' : 'Reset'}><RotateCcw className="h-4 w-4" /></button></div>
        <div className="mt-4 grid grid-cols-2 gap-3">{fields.map(({ field, label, max }) => <label key={field}><span className="mb-1.5 block text-xs text-dark-400">{label}</span><input type="number" min={field === 'leverage' ? 1 : 0} max={max} step="any" value={inputs[field]} onChange={(event) => setNumber(field, event.target.valueAsNumber)} className="w-full border border-dark-600 bg-dark-950 px-3 py-2 font-mono text-sm text-white outline-none focus:border-primary-400" /></label>)}</div>
        <div className="mt-4"><div className="mb-1.5 text-xs text-dark-400">{isKo ? '포지션 방향' : 'Direction'}</div><div className="grid grid-cols-2 gap-2">{(['long', 'short'] as TradeDirection[]).map((direction) => <button key={direction} type="button" onClick={() => setInputs((previous) => ({ ...previous, direction }))} className={`flex items-center justify-center gap-2 border px-3 py-2 text-sm font-semibold ${inputs.direction === direction ? direction === 'long' ? 'border-bull bg-bull/10 text-bull' : 'border-bear bg-bear/10 text-bear' : 'border-dark-600 text-dark-400 hover:text-white'}`}>{direction === 'long' ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}{direction.toUpperCase()}</button>)}</div></div>
        <p className="mt-4 text-[11px] text-dark-500">{isKo ? '입력한 편도 수수료가 각 청산·재진입 체결 비용에 적용됩니다.' : 'The entered one-way fee is applied to each exit and re-entry fill.'}</p>
      </section>
      <section className="border border-dark-700 bg-dark-900/20 p-4">
        {!result.isValid ? <div className="py-12 text-center text-sm text-dark-400">{isKo ? `가격과 투입금은 0보다 커야 하고 레버리지는 1~${MAX_LEVERAGE}배, 수수료는 0~10%여야 합니다.` : `Prices and margin must be positive; leverage must be 1-${MAX_LEVERAGE}x and the fee must be 0-10%.`}</div> : <>
          <div className="flex flex-wrap justify-between gap-3 border-b border-dark-700 pb-3"><h2 className="text-sm font-semibold text-white">{isKo ? '비교 결과' : 'Comparison'}</h2><span className="text-sm text-dark-400">{isKo ? '현재 손익' : 'Current P&L'} <strong className={`font-mono ${tone(result.currentPnl)}`}>{pct(result.currentPnlPercent)}</strong></span></div>
          <div className="mt-4 grid gap-5 md:grid-cols-2"><div><h3 className="text-sm font-semibold text-white">{isKo ? '계속 홀딩' : 'Keep holding'}</h3><div className="mt-2"><Row label={isKo ? '목표가 도달 시 수익률' : 'Return at target'} value={pct(result.holdingPnlPercent)} className={tone(result.holdingPnl)} /><Row label={isKo ? '최종 손익' : 'Final P&L'} value={money(result.holdingPnl)} className={tone(result.holdingPnl)} /></div></div><div><h3 className="text-sm font-semibold text-white">{isKo ? '지금 종료 후 재진입' : 'Exit then re-enter'}</h3><div className="mt-2"><Row label={isKo ? '지금 확정되는 손익' : 'P&L realized now'} value={money(result.realizedPnl)} className={tone(result.realizedPnl)} /><Row label={isKo ? '재진입 뒤 수익' : 'P&L after re-entry'} value={money(result.reentryPnl)} className={tone(result.reentryPnl)} /><Row label={isKo ? '최종 손익' : 'Final P&L'} value={money(result.reentryFinalPnl)} className={tone(result.reentryFinalPnl)} /></div></div></div>
          <div className="mt-5 grid gap-px border border-dark-700 bg-dark-700 sm:grid-cols-3"><div className="bg-dark-950 p-3"><div className="text-xs text-dark-500">{isKo ? '재진입으로 늘어나는 수익' : 'Gross re-entry gain'}</div><div className={`mt-1 font-mono text-lg font-bold ${tone(result.grossReentryAdvantage)}`}>{money(result.grossReentryAdvantage)}</div></div><div className="bg-dark-950 p-3"><div className="text-xs text-dark-500">{isKo ? '추가 거래비용' : 'Additional fees'}</div><div className="mt-1 font-mono text-lg font-bold text-bear">-{money(result.incrementalFees).slice(1)}</div></div><div className="bg-dark-950 p-3"><div className="text-xs text-dark-500">{isKo ? '수수료 제외 후 차이' : 'Net difference'}</div><div className={`mt-1 font-mono text-lg font-bold ${tone(result.netReentryAdvantage)}`}>{money(result.netReentryAdvantage)}</div></div></div>
          <div className={`mt-5 border-l-2 py-1 pl-3 text-sm font-semibold ${tone(result.netReentryAdvantage).replace('text-', 'border-')}`}>{verdict}</div>
        </>}
      </section>
    </div>
  </div>;
}
