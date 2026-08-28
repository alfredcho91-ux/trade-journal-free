import { useState } from 'react';
import { X } from 'lucide-react';

import TradeReportModal from '../journal/TradeReportModal';
import type { JournalEntry, PlanEvaluation, TradingPlan } from '../../types';

function signed(value: number | null | undefined, digits = 2, suffix = ''): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}${suffix}`;
}

function price(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value);
}

function dateLabel(value: string | null | undefined, isKo: boolean): string {
  if (!value) return '-';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '-';
  return new Intl.DateTimeFormat(isKo ? 'ko-KR' : 'en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function actualResultLabel(entry?: JournalEntry): string {
  if (!entry) return '-';
  if (entry.r_multiple != null && Number.isFinite(entry.r_multiple)) return signed(entry.r_multiple, 2, 'R');
  if (entry.pnl_pct != null && Number.isFinite(entry.pnl_pct)) return signed(entry.pnl_pct, 2, '%');
  if (entry.realized_pnl != null && Number.isFinite(entry.realized_pnl)) return signed(entry.realized_pnl, 2, ' USDT');
  return '-';
}

function holdingLabel(entry: JournalEntry | undefined, isKo: boolean): string {
  if (!entry?.entry_datetime || !entry.datetime) return '-';
  const minutes = Math.round((new Date(entry.datetime).getTime() - new Date(entry.entry_datetime).getTime()) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 0) return '-';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return isKo ? (hours ? `${hours}시간 ${rest}분` : `${rest}분`) : (hours ? `${hours}h ${rest}m` : `${rest}m`);
}

function Metric({ label, value, tone = 'text-dark-100' }: { label: string; value: string; tone?: string }) {
  return <div className="border border-dark-800 bg-dark-950/45 px-3 py-2"><div className="text-[10px] text-dark-500">{label}</div><div className={`mt-1 break-words font-mono text-sm font-semibold ${tone}`}>{value}</div></div>;
}

function PriceLevelView({ entry, exit, stop, tp1, tp2, isKo }: {
  entry?: number | null;
  exit?: number | null;
  stop?: number | null;
  tp1?: number | null;
  tp2?: number | null;
  isKo: boolean;
}) {
  const split = tp2 != null && Number.isFinite(tp2);
  const levels = [
    { id: 'tp2', label: isKo ? 'TP2 · 잔여 50%' : 'TP2 · remaining 50%', value: tp2, lineClass: 'border-primary-300', textClass: 'text-primary-200' },
    { id: 'tp1', label: split ? (isKo ? 'TP1 · 50%' : 'TP1 · 50%') : (isKo ? 'TP1 · 100%' : 'TP1 · 100%'), value: tp1, lineClass: 'border-bull', textClass: 'text-bull' },
    { id: 'exit', label: isKo ? '실제 청산' : 'Actual exit', value: exit, lineClass: 'border-amber-300', textClass: 'text-amber-200' },
    { id: 'entry', label: isKo ? '실제 진입' : 'Actual entry', value: entry, lineClass: 'border-dark-300', textClass: 'text-dark-100' },
    { id: 'stop', label: isKo ? '계획 손절' : 'Plan stop', value: stop, lineClass: 'border-bear', textClass: 'text-bear' },
  ].filter((item): item is typeof item & { value: number } => item.value != null && Number.isFinite(item.value));
  if (levels.length < 2) return <div className="flex h-48 items-center justify-center border border-dark-800 text-xs text-dark-500">{isKo ? '가격 레벨을 표시할 데이터가 부족합니다.' : 'Not enough price levels to display.'}</div>;
  const values = levels.map((item) => item.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, Math.abs(max || 1) * 0.002);
  return <div className="relative h-60 overflow-hidden border border-dark-800 bg-dark-950/45 px-4 py-5">
    {levels.map((item) => {
      const top = 8 + ((max - item.value) / span) * 82;
      return <div key={item.id} className="absolute left-4 right-4" style={{ top: `${top}%` }}><div className={`border-t ${item.lineClass}`} /><div className={`-mt-5 flex items-center justify-between text-[10px] ${item.textClass}`}><span className="bg-dark-950 pr-2">{item.label}</span><b className="bg-dark-950 pl-2 font-mono">{price(item.value)}</b></div></div>;
    })}
  </div>;
}

function legLabel(type: string, isKo: boolean): string {
  const ko: Record<string, string> = { TP1: '1차 익절', TP2: '2차 익절', SL: '계획 손절', HORIZON: '관찰 종료 청산' };
  const en: Record<string, string> = { TP1: 'First target', TP2: 'Second target', SL: 'Plan stop', HORIZON: 'Horizon exit' };
  return (isKo ? ko : en)[type] || type;
}

function splitExplanation(legs: NonNullable<PlanEvaluation['plan_legs']>, isKo: boolean): string {
  if (!legs.length) return isKo ? '공식 실행 결과를 계산할 수 없습니다.' : 'The official execution result is unavailable.';
  if (legs.length === 1 && legs[0].type === 'SL') return isKo ? 'TP1 도달 전 계획 손절가에서 전체 포지션이 청산된 것으로 계산되었습니다.' : 'The full position exited at the plan stop before TP1.';
  if (legs.length === 1 && legs[0].type === 'HORIZON') return isKo ? 'TP1과 손절가에 도달하지 않아 관찰 종료 가격에서 전체 포지션이 청산된 것으로 계산되었습니다.' : 'Neither TP1 nor the stop was reached, so the full position exited at the horizon.';
  const finalType = legs[legs.length - 1].type;
  if (finalType === 'TP2') return isKo ? 'TP1에서 50% 청산 후 남은 50%가 TP2에서 청산된 것으로 계산되었습니다.' : '50% exited at TP1 and the remaining 50% exited at TP2.';
  if (finalType === 'SL') return isKo ? 'TP1에서 50% 청산 후 남은 50%가 원래 계획 손절가에서 청산된 것으로 계산되었습니다.' : '50% exited at TP1 and the remaining 50% exited at the original plan stop.';
  return isKo ? 'TP1에서 50% 청산 후 남은 50%는 TP2와 손절가에 도달하지 않아 관찰 종료 가격에서 청산된 것으로 계산되었습니다.' : '50% exited at TP1 and the remaining 50% exited at the horizon.';
}

function ambiguityLabel(reason: string | null | undefined, isKo: boolean): string | null {
  if (!reason) return null;
  const ko: Record<string, string> = {
    TP1_SL_SAME_CANDLE: '같은 완료봉에서 TP1과 손절가가 모두 닿아 선후를 확인할 수 없습니다.',
    TP2_SL_SAME_CANDLE_AFTER_TP1: 'TP1 이후 같은 완료봉에서 TP2와 손절가가 모두 닿아 잔여 50%의 청산 순서를 확인할 수 없습니다.',
    BOUNDARY_PARTIAL_CANDLE: '관찰 경계의 일부 봉이 포함되어 목표가와 손절가의 선후를 안전하게 판단할 수 없습니다.',
    HORIZON_PARTIAL_CANDLE: '관찰 종료 시점의 봉이 완성되지 않아 종료 가격을 공식 결과로 사용할 수 없습니다.',
  };
  const en: Record<string, string> = {
    TP1_SL_SAME_CANDLE: 'TP1 and the stop were touched in the same completed candle, so their order is unknown.',
    TP2_SL_SAME_CANDLE_AFTER_TP1: 'After TP1, TP2 and the stop were touched in the same completed candle, so the remaining exit order is unknown.',
    BOUNDARY_PARTIAL_CANDLE: 'A boundary candle is partial, so target and stop ordering cannot be verified safely.',
    HORIZON_PARTIAL_CANDLE: 'The horizon candle is incomplete, so its close cannot be used as an official result.',
  };
  return (isKo ? ko : en)[reason] || reason;
}

export function TradeAnalysisSummary({ entry, evaluation, entries, isKo, onClose }: {
  entry?: JournalEntry;
  evaluation?: PlanEvaluation;
  entries: JournalEntry[];
  isKo: boolean;
  onClose?: () => void;
}) {
  const [reportOpen, setReportOpen] = useState(false);
  const actualTone = (entry?.r_multiple ?? entry?.pnl_pct ?? entry?.realized_pnl ?? 0) >= 0 ? 'text-bull' : 'text-bear';
  return <>
    {!entry ? <p className="py-8 text-center text-xs text-dark-500">{isKo ? '연결된 실제 거래를 찾을 수 없습니다.' : 'The linked actual trade is unavailable.'}</p> : <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label={isKo ? '실제 진입' : 'Actual entry'} value={price(entry.entry_price)} />
        <Metric label={isKo ? '실제 청산' : 'Actual exit'} value={price(entry.exit_price)} />
        <Metric label={isKo ? '실제 결과' : 'Actual result'} value={actualResultLabel(entry)} tone={actualTone} />
        <Metric label={isKo ? '보유 시간' : 'Holding time'} value={holdingLabel(entry, isKo)} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Metric label={isKo ? '진입 후 최대 유리 움직임' : 'Maximum favorable move'} value={signed(evaluation?.mfe_r, 2, 'R')} tone="text-bull" />
        <Metric label={isKo ? '진입 후 최대 불리 움직임' : 'Maximum adverse move'} value="-" />
      </div>
      <p className="mt-4 text-[11px] leading-5 text-dark-500">{isKo ? '현재 연결된 거래와 기존 분석 결과만 표시합니다. 새 분석이나 추가 시장 데이터 요청은 실행하지 않습니다.' : 'Uses the linked trade and existing analysis only. No new analysis or market-data request is started.'}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => setReportOpen(true)} className="border border-primary-400/40 px-3 py-2 text-xs text-primary-200">{isKo ? '전체 거래 리포트 보기 ↗' : 'Open full trade report ↗'}</button>
        {onClose && <button type="button" onClick={onClose} className="border border-dark-700 px-3 py-2 text-xs text-dark-300">{isKo ? '닫기' : 'Close'}</button>}
      </div>
    </>}
    {reportOpen && entry && <TradeReportModal entry={entry} allEntries={entries} isKo={isKo} onClose={() => setReportOpen(false)} />}
  </>;
}

export function PlanDetailsDrawer({ plan, entry, evaluation, entries, analysisRequested, analysisLoading, isKo, onClose, onRevise, onLoadAnalysis }: {
  plan: TradingPlan;
  entry?: JournalEntry;
  evaluation?: PlanEvaluation;
  entries: JournalEntry[];
  analysisRequested: boolean;
  analysisLoading: boolean;
  isKo: boolean;
  onClose: () => void;
  onRevise?: () => void;
  onLoadAnalysis: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'comparison' | 'analysis'>('comparison');
  const [reportOpen, setReportOpen] = useState(false);
  const revision = plan.latest_revision;
  const splitPlan = revision.take_profit_2 != null;
  const planLegs = evaluation?.plan_legs || [];
  return <div className="fixed inset-0 z-[80] bg-black/60" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <aside className="ml-auto h-full w-full max-w-[980px] overflow-y-auto border-l border-dark-700 bg-dark-950 shadow-2xl">
      <header className="sticky top-0 z-10 border-b border-dark-700 bg-dark-950/95 px-5 py-5 backdrop-blur sm:px-7"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-bold text-white">{entry ? `${entry.symbol || plan.symbol} · ${entry.direction?.toUpperCase() || plan.side.toUpperCase()}` : `${plan.symbol} · ${plan.side.toUpperCase()}`}</h2><p className="mt-2 text-xs text-dark-400">{entry && <>{dateLabel(entry.entry_datetime, isKo)}<span className="mx-2 text-dark-700">|</span></>}{isKo ? '실제 진입' : 'Entry'} <b className="font-mono text-white">{price(entry?.entry_price)}</b><span className="mx-2 text-dark-700">|</span>{isKo ? '실제 청산' : 'Exit'} <b className="font-mono text-white">{price(entry?.exit_price)}</b><span className="mx-2 text-dark-700">|</span><b className={(entry?.r_multiple ?? entry?.pnl_pct ?? entry?.realized_pnl ?? 0) >= 0 ? 'text-bull' : 'text-bear'}>{actualResultLabel(entry)}</b></p></div><div className="flex items-center gap-2">{entry && <button type="button" onClick={() => setReportOpen(true)} className="border border-primary-400/40 px-3 py-2 text-xs text-primary-200">{isKo ? '전체 리포트' : 'Full report'}</button>}<button type="button" onClick={onClose} aria-label={isKo ? '닫기' : 'Close'} className="border border-dark-700 p-2 text-dark-300"><X className="h-4 w-4" /></button></div></div><div className="mt-5 flex gap-6"><button type="button" onClick={() => setActiveTab('comparison')} className={`border-b-2 pb-3 text-xs ${activeTab === 'comparison' ? 'border-primary-400 text-primary-200' : 'border-transparent text-dark-400'}`}>{isKo ? '계획 비교' : 'Plan comparison'}</button><button type="button" onClick={() => setActiveTab('analysis')} className={`border-b-2 pb-3 text-xs ${activeTab === 'analysis' ? 'border-primary-400 text-primary-200' : 'border-transparent text-dark-400'}`}>{isKo ? '거래 분석' : 'Trade analysis'}</button></div></header>
      <div className="p-5 sm:p-7">{activeTab === 'analysis' ? <TradeAnalysisSummary entry={entry} evaluation={evaluation} entries={entries} isKo={isKo} /> : <>
        <div className="flex flex-wrap gap-2"><span className={`border px-2 py-1 text-[10px] ${plan.source === 'VERIFIED_PRETRADE' ? 'border-bull/40 text-bull' : plan.source === 'IN_TRADE' ? 'border-primary-400/40 text-primary-200' : 'border-amber-300/40 text-amber-200'}`}>{plan.source === 'VERIFIED_PRETRADE' ? (isKo ? '사전 기록 확인됨' : 'Verified pre-trade') : plan.source === 'IN_TRADE' ? (isKo ? '진입 후 기록' : 'Recorded in trade') : (isKo ? '회고 입력' : 'Retrospective')}</span><span className="border border-dark-700 px-2 py-1 text-[10px] text-dark-400">v{revision.version}</span></div>
        <h3 className="mt-5 text-sm font-semibold text-white">Actual vs Plan</h3><div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3"><Metric label={isKo ? '실제 결과' : 'Actual'} value={signed(evaluation?.actual_r, 2, 'R')} tone={(evaluation?.actual_r || 0) >= 0 ? 'text-bull' : 'text-bear'} /><Metric label={isKo ? '계획대로 실행' : 'Plan result'} value={signed(evaluation?.planned_result_r, 2, 'R')} tone={(evaluation?.planned_result_r || 0) >= 0 ? 'text-bull' : 'text-bear'} /><Metric label={isKo ? '실행 차이' : 'Execution delta'} value={signed(evaluation?.execution_delta_r, 2, 'R')} tone={(evaluation?.execution_delta_r || 0) >= 0 ? 'text-bull' : 'text-bear'} /></div>{evaluation?.planned_result_pnl != null && <p className="mt-2 text-right text-[10px] text-dark-500">{isKo ? '계획 순손익' : 'Plan net PnL'} <b className="font-mono text-dark-200">{signed(evaluation.planned_result_pnl, 2, ' USDT')}</b></p>}
        <div className="mt-6"><h3 className="text-sm font-semibold text-white">{isKo ? '입력한 계획' : 'Recorded plan'}</h3><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label={isKo ? '계획 손절' : 'Plan stop'} value={price(revision.stop_loss)} /><Metric label={splitPlan ? (isKo ? 'TP1 · 50%' : 'TP1 · 50%') : (isKo ? 'TP1 · 100%' : 'TP1 · 100%')} value={price(revision.take_profit)} /><Metric label={isKo ? 'TP2 · 잔여 50%' : 'TP2 · remaining 50%'} value={revision.take_profit_2 == null ? (isKo ? '미설정' : 'Not set') : price(revision.take_profit_2)} /><Metric label={isKo ? '최대 보유시간' : 'Maximum hold'} value={revision.max_hold_hours == null ? '-' : `${revision.max_hold_hours}h`} /></div></div>
        {splitPlan && <div className="mt-6"><h3 className="text-sm font-semibold text-white">{isKo ? '계획 실행 결과' : 'Plan execution result'}</h3>{planLegs.length ? <div className="mt-4 space-y-3">{planLegs.map((leg, index) => <div key={`${leg.type}-${index}`} className="grid gap-3 border border-dark-800 bg-dark-950/45 p-4 sm:grid-cols-[1.2fr,0.7fr,0.8fr,0.9fr,auto] sm:items-center"><div><b className="text-sm text-white">{legLabel(leg.type, isKo)}</b><span className="mt-1 block text-[10px] text-dark-500">{isKo ? `청산 가격 ${price(leg.exit_price)}` : `Exit ${price(leg.exit_price)}`}</span></div><span><small className="block text-dark-500">{isKo ? '청산 비중' : 'Exit fraction'}</small><b className="font-mono text-xs">{Math.round(leg.fraction * 100)}%</b></span><span><small className="block text-dark-500">{isKo ? '해당 가격의 R' : 'Price R'}</small><b className="font-mono text-xs">{signed(leg.price_r, 2, 'R')}</b></span><span><small className="block text-dark-500">{isKo ? '전체 결과 기여 R' : 'Weighted contribution R'}</small><b className="font-mono text-xs">{signed(leg.contribution_r, 2, 'R')}</b></span><span className="border border-dark-700 px-2 py-1 text-[10px] text-dark-300">{leg.status}</span></div>)}</div> : <p className="mt-3 text-xs text-dark-500">{analysisRequested ? (analysisLoading ? (isKo ? '공식 실행 결과를 계산하고 있습니다.' : 'Calculating official execution result.') : (isKo ? '평가 가능한 가격 경로가 없습니다.' : 'No evaluable price path is available.')) : (isKo ? '공식 분석을 불러오면 청산 구간별 결과가 표시됩니다.' : 'Load official analysis to view each exit leg.')}</p>}</div>}
        <div className="mt-6 grid gap-6 lg:grid-cols-[0.85fr_1.15fr]"><div>{(revision.entry_note || revision.exit_note || revision.memo) && <details className="border border-dark-800 p-3"><summary className="cursor-pointer text-xs text-dark-300">{isKo ? '계획 메모 보기' : 'View plan notes'}</summary><div className="mt-3 space-y-3 text-xs text-dark-300">{revision.entry_note && <p className="whitespace-pre-wrap"><span className="text-dark-500">{isKo ? '진입 근거' : 'Entry'} · </span>{revision.entry_note}</p>}{revision.exit_note && <p className="whitespace-pre-wrap"><span className="text-dark-500">{isKo ? '청산 조건' : 'Exit'} · </span>{revision.exit_note}</p>}{revision.memo && <p className="whitespace-pre-wrap"><span className="text-dark-500">Memo · </span>{revision.memo}</p>}</div></details>}<div className="mt-3 border border-dark-800 p-4"><b className="text-xs text-white">{splitPlan ? (isKo ? 'TP2가 있는 Plan' : 'Plan with TP2') : (isKo ? 'TP2가 없는 기존 Plan' : 'Legacy plan without TP2')}</b><p className="mt-2 text-[11px] leading-5 text-dark-500">{splitPlan ? (isKo ? 'TP1에서 50% 청산하고 TP2에서 남은 50%를 청산합니다. TP1 이후에도 원래 계획 손절가를 유지합니다.' : '50% exits at TP1 and the remaining 50% at TP2. The original stop remains after TP1.') : (isKo ? '기존 방식 그대로 TP1에서 100% 청산합니다.' : 'The full position exits at TP1 as before.')}</p></div></div><div><h3 className="text-sm font-semibold text-white">{isKo ? '가격 레벨 비교' : 'Price-level comparison'}</h3><div className="mt-4"><PriceLevelView entry={entry?.entry_price} exit={entry?.exit_price} stop={revision.stop_loss} tp1={revision.take_profit} tp2={revision.take_profit_2} isKo={isKo} /></div></div></div>
        <div className="mt-5 border-l-2 border-primary-400 bg-primary-500/5 px-4 py-3 text-xs leading-5 text-dark-200"><span className="mb-1 block text-[10px] text-primary-300">{isKo ? '계획 결과 해석' : 'Plan result explanation'}</span>{evaluation ? (ambiguityLabel(evaluation.simulation_ambiguity_reason, isKo) || (splitPlan ? splitExplanation(planLegs, isKo) : (isKo ? 'TP1에서 전체 포지션을 청산하는 기존 계획 방식으로 계산했습니다.' : 'Calculated with the legacy rule that exits the full position at TP1.'))) : analysisRequested ? (analysisLoading ? (isKo ? '공식 비교 결과를 계산하고 있습니다.' : 'Calculating official comparison.') : (isKo ? '비교 가능한 가격 경로가 없습니다.' : 'No comparable price path is available.')) : (isKo ? '공식 비교를 불러오면 실제 실행과 입력 계획의 차이를 확인할 수 있습니다.' : 'Load official analysis to compare actual execution with the recorded plan.')}</div>
        {!analysisRequested && <button type="button" onClick={onLoadAnalysis} className="mt-4 border border-primary-400/40 px-4 py-2 text-xs text-primary-200">{isKo ? '공식 분석 불러오기' : 'Load official analysis'}</button>}
        <div className="mt-6 grid gap-3 sm:grid-cols-2"><button type="button" onClick={() => setActiveTab('analysis')} className="border border-dark-700 p-4 text-left hover:border-primary-400"><b className="text-sm text-white">{isKo ? '거래 분석' : 'Trade analysis'}</b><span className="mt-1 block text-xs text-dark-500">{isKo ? '실제 진입·청산과 보유 결과를 확인합니다.' : 'Review the actual entry, exit, and holding result.'}</span></button>{onRevise && <button type="button" onClick={onRevise} className="border border-dark-700 p-4 text-left hover:border-primary-400"><b className="text-sm text-white">{isKo ? '계획 수정 이력 추가' : 'Add plan revision'}</b><span className="mt-1 block text-xs text-dark-500">{isKo ? '기존 기록을 보존하고 새 버전을 추가합니다.' : 'Keep history and add a new version.'}</span></button>}</div>
      </>}</div>
    </aside>
    {reportOpen && entry && <TradeReportModal entry={entry} allEntries={entries} isKo={isKo} onClose={() => setReportOpen(false)} />}
  </div>;
}
