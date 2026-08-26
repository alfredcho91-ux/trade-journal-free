import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, ClipboardCheck, History, Link as LinkIcon, X } from 'lucide-react';

import {
  addPlanRevision,
  createPlan,
  createRetrospectivePlan,
  getJournal,
  getPlanLab,
  getPlans,
  linkPlanToTrade,
  updatePlanStatus,
} from '../api/client';
import { CumulativeRChart, ActualPlanRows, DeltaBars, DeltaDistribution } from '../features/planLab/PlanLabCharts';
import {
  nextMissingTrade,
  planEntryLabel,
  revisionPayload,
  shouldLoadPlanLabAnalysis,
  type PlanDraft,
} from '../features/planLab/pastTradePlan';
import { isClosedPosition } from '../features/journal/journalEntries';
import {
  buildJournalPeriod,
  dateBoundaryTimestamp,
  toDateInputValue,
  type JournalPeriod,
} from '../features/journal/journalPeriod';
import { journalQueryKeys } from '../features/journal/journalQueryKeys';
import TradeReportModal from '../features/journal/TradeReportModal';
import { SampleBadge } from '../features/tradeAnalysis/SampleBadge';
import { useLanguage } from '../store/useStore';
import type {
  JournalEntry,
  PlanDeltaBucket,
  PlanEvaluation,
  PlanOptimizerVariant,
  PlanSetupStats,
  PlanSide,
  PlanSource,
  TradingPlan,
} from '../types';

const DEFAULT_DAYS = 90;
const EMPTY_PLANS: TradingPlan[] = [];

type DirectionFilter = 'ALL' | PlanSide;
type SourceFilter = 'ALL' | Exclude<PlanSource, 'UNLINKED'>;
type PlanStatusFilter = 'ALL' | 'NO_PLAN' | 'RECORDED';

const EMPTY_DRAFT: PlanDraft = {
  exchange: 'deepcoin', symbol: 'BTC/USDT', side: 'Long', entryMode: 'exact',
  entryPrice: '', entryMin: '', entryMax: '', stopLoss: '', takeProfit: '',
  maxHoldHours: '', setup: '', entryNote: '', exitNote: '', memo: '',
};

function draftFromHistoricalTrade(trade: JournalEntry): PlanDraft {
  return {
    ...EMPTY_DRAFT,
    exchange: trade.exchange?.toLowerCase() === 'deepcoin' ? 'deepcoin' : 'binance',
    symbol: trade.symbol || EMPTY_DRAFT.symbol,
    side: trade.direction === 'Short' ? 'Short' : 'Long',
    entryPrice: '',
  };
}

function draftFromPlan(plan: TradingPlan): PlanDraft {
  const revision = plan.latest_revision;
  return {
    exchange: plan.exchange === 'binance' ? 'binance' : 'deepcoin',
    symbol: plan.symbol, side: plan.side,
    entryMode: revision.entry_price != null ? 'exact' : 'range',
    entryPrice: revision.entry_price?.toString() || '',
    entryMin: revision.entry_min?.toString() || '',
    entryMax: revision.entry_max?.toString() || '',
    stopLoss: revision.stop_loss.toString(), takeProfit: revision.take_profit.toString(),
    maxHoldHours: revision.max_hold_hours?.toString() || '',
    setup: revision.setup || '', entryNote: revision.entry_note || '',
    exitNote: revision.exit_note || '', memo: revision.memo || '',
  };
}

function normalizeSymbol(value: string | null | undefined): string {
  return String(value || '').toUpperCase().split(':', 1)[0].replace(/[^A-Z0-9]/g, '');
}

function signed(value: number | null | undefined, digits = 2, suffix = ''): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}${suffix}`;
}

function price(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value);
}

function actualResultLabel(entry: JournalEntry): string {
  if (entry.r_multiple != null && Number.isFinite(entry.r_multiple)) return signed(entry.r_multiple, 2, 'R');
  if (entry.pnl_pct != null && Number.isFinite(entry.pnl_pct)) return signed(entry.pnl_pct, 2, '%');
  if (entry.realized_pnl != null && Number.isFinite(entry.realized_pnl)) return signed(entry.realized_pnl, 2, ' USDT');
  return '-';
}

function dateLabel(value: string | null | undefined, isKo: boolean): string {
  if (!value) return '-';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '-';
  return new Intl.DateTimeFormat(isKo ? 'ko-KR' : 'en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function Kpi({ label, value, detail, tone = 'neutral' }: {
  label: string;
  value: string;
  detail?: string;
  tone?: 'neutral' | 'positive' | 'negative' | 'primary';
}) {
  const toneClass = tone === 'positive' ? 'text-bull' : tone === 'negative' ? 'text-bear' : tone === 'primary' ? 'text-primary-300' : 'text-white';
  return <div className="border border-dark-700 bg-dark-900/35 p-4"><div className="text-[11px] text-dark-500">{label}</div><div className={`mt-2 font-mono text-xl font-bold ${toneClass}`}>{value}</div>{detail && <div className="mt-1 text-[10px] text-dark-500">{detail}</div>}</div>;
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return <div><h2 className="text-base font-semibold text-white">{title}</h2><p className="mt-1 text-xs leading-5 text-dark-500">{description}</p></div>;
}

function diagnosisText(code: string, isKo: boolean): string {
  const behavior = code.startsWith('BEHAVIOR_GAP:') ? behaviorLabel(code.split(':')[1], isKo) : '';
  if (behavior) return isKo ? `${behavior}에서 가장 큰 음의 실행 차이가 관찰됐습니다.` : `The largest negative execution gap was observed in ${behavior}.`;
  const ko: Record<string, string> = {
    INSUFFICIENT_PLANS: '동일 표본으로 비교할 계획 거래가 더 필요합니다.',
    PLAN_OUTPERFORMED_ACTUAL: '입력 계획대로 실행한 과거 결과가 실제 실행보다 높았습니다.',
    DISCRETION_OUTPERFORMED_PLAN: '실제 재량 실행 결과가 입력 계획보다 높았습니다.',
    NO_CLEAR_GAP: '현재 표본에서는 계획과 실제 실행의 뚜렷한 차이가 확인되지 않았습니다.',
  };
  const en: Record<string, string> = {
    INSUFFICIENT_PLANS: 'More comparable plan trades are needed.',
    PLAN_OUTPERFORMED_ACTUAL: 'Historical plan execution outperformed actual execution.',
    DISCRETION_OUTPERFORMED_PLAN: 'Actual discretionary execution outperformed the entered plans.',
    NO_CLEAR_GAP: 'No clear plan-versus-actual gap was observed.',
  };
  return (isKo ? ko : en)[code] || code;
}

function behaviorLabel(id: string, isKo: boolean): string {
  const ko: Record<string, string> = {
    EARLY_TP_EXIT: 'TP 이전 조기청산', STOP_OVERRUN: '계획 SL 초과보유',
    DISCRETIONARY_EARLY_STOP: 'SL 이전 재량 손절', TARGET_GIVEBACK: 'TP 도달 후 이익 반납',
    HOLD_AFTER_TP: 'TP 이후 추가보유', PLAN_LIKE: '계획과 유사한 실행',
    OTHER: '기타 실행', NOT_EVALUABLE: '평가 불가',
    POST_EXIT_TP: '청산 후 TP 도달', POST_EXIT_SL: '청산 후 SL 방향 도달',
    NO_BARRIER: '둘 다 미도달', AMBIGUOUS: '같은 봉 동시 도달',
  };
  const en: Record<string, string> = {
    EARLY_TP_EXIT: 'Exit before TP', STOP_OVERRUN: 'Held beyond plan SL',
    DISCRETIONARY_EARLY_STOP: 'Discretionary early stop', TARGET_GIVEBACK: 'Gave back after TP',
    HOLD_AFTER_TP: 'Held beyond TP', PLAN_LIKE: 'Plan-like execution',
    OTHER: 'Other execution', NOT_EVALUABLE: 'Not evaluable',
    POST_EXIT_TP: 'TP after exit', POST_EXIT_SL: 'SL direction after exit',
    NO_BARRIER: 'Neither barrier', AMBIGUOUS: 'Same-bar collision',
  };
  return (isKo ? ko : en)[id] || id;
}

function sourceLabel(source: PlanSource, isKo: boolean): string {
  if (source === 'VERIFIED_PRETRADE') return isKo ? '사전 기록' : 'Verified pre-trade';
  if (source === 'RETROSPECTIVE') return isKo ? '회고 입력' : 'Retrospective';
  return isKo ? '미연결' : 'Unlinked';
}

export function PlanForm({ draft, isKo, trade, revisionTarget, pending, error, saved, evaluation, hasNextMissing, onChange, onSubmit, onCancel, onViewAnalysis, onNextMissing }: {
  draft: PlanDraft;
  isKo: boolean;
  trade?: JournalEntry;
  revisionTarget?: TradingPlan;
  pending: boolean;
  error: string | null;
  saved: boolean;
  evaluation?: PlanEvaluation;
  hasNextMissing: boolean;
  onChange: (draft: PlanDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onViewAnalysis: () => void;
  onNextMissing: () => void;
}) {
  const inputClass = 'mt-1 h-9 w-full border border-dark-700 bg-dark-950 px-2.5 text-xs text-dark-100 outline-none focus:border-primary-400';
  const retrospective = Boolean(trade);
  const content = <section className="border border-primary-400/30 bg-primary-500/5 p-5">
    <div className="flex items-start justify-between">
      <SectionHeading
        title={revisionTarget ? (isKo ? `계획 #${revisionTarget.id} 수정 이력 추가` : 'Add plan revision') : retrospective ? (isKo ? '과거 거래의 당시 계획 입력' : 'Enter the plan for this historical trade') : (isKo ? '사전 계획 기록' : 'Record a pre-trade plan')}
        description={retrospective ? (isKo ? '결과를 보며 계획을 끼워 맞추지 않도록 저장 전에는 실제 청산과 손익을 표시하지 않습니다.' : 'Actual exit and result stay hidden until the plan is saved.') : (isKo ? '서버 수신 시각이 실제 최초 진입보다 빠를 때만 사전 기록으로 검증됩니다.' : 'Verified only when server receipt precedes the first actual entry.')}
      />
      <button type="button" onClick={onCancel} className="text-xs text-dark-400 hover:text-white">{isKo ? '닫기' : 'Close'}</button>
    </div>
    {trade && <div className="mt-4 grid grid-cols-1 gap-2 border-y border-dark-700 py-3 text-xs sm:grid-cols-[1fr,auto,auto]"><strong className="text-white">{trade.symbol} · {trade.direction?.toUpperCase()}</strong><span className="text-dark-400">{dateLabel(trade.entry_datetime, isKo)}</span><span className="font-mono text-dark-300">{isKo ? '실제 진입가' : 'Actual entry'} {price(trade.entry_price)}</span><span className="rounded-sm border border-amber-300/30 px-2 py-1 text-[10px] text-amber-200 sm:col-span-3">{isKo ? '회고 입력 · 과거 거래에 대해 지금 입력한 계획입니다.' : 'Retrospective · This plan is entered after the historical trade.'}</span></div>}
    <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
      {!trade && !revisionTarget && <>
        <label className="text-[10px] text-dark-500">{isKo ? '거래소' : 'Exchange'}<select value={draft.exchange} onChange={(event) => onChange({ ...draft, exchange: event.target.value as PlanDraft['exchange'] })} className={inputClass}><option value="deepcoin">Deepcoin</option><option value="binance">Binance</option></select></label>
        <label className="col-span-2 text-[10px] text-dark-500">Symbol<input value={draft.symbol} onChange={(event) => onChange({ ...draft, symbol: event.target.value })} className={inputClass} /></label>
        <label className="text-[10px] text-dark-500">{isKo ? '방향' : 'Side'}<select value={draft.side} onChange={(event) => onChange({ ...draft, side: event.target.value as PlanSide })} className={inputClass}><option value="Long">LONG</option><option value="Short">SHORT</option></select></label>
      </>}
      {!retrospective && <>
        <div className="col-span-2 text-[10px] text-dark-500"><div>{isKo ? '진입 방식' : 'Entry mode'}</div><div className="mt-1 grid h-9 grid-cols-2 border border-dark-700 p-0.5">{(['exact', 'range'] as const).map((mode) => <button key={mode} type="button" onClick={() => onChange({ ...draft, entryMode: mode })} className={`text-xs ${draft.entryMode === mode ? 'bg-primary-500/20 text-primary-200' : 'text-dark-400'}`}>{mode === 'exact' ? (isKo ? '단일 가격' : 'Exact') : (isKo ? '가격 범위' : 'Range')}</button>)}</div></div>
        {draft.entryMode === 'exact'
          ? <label className="col-span-2 text-[10px] text-dark-500">Plan Entry<input inputMode="decimal" value={draft.entryPrice} onChange={(event) => onChange({ ...draft, entryPrice: event.target.value })} className={`${inputClass} font-mono`} /></label>
          : <><label className="text-[10px] text-dark-500">Entry min<input inputMode="decimal" value={draft.entryMin} onChange={(event) => onChange({ ...draft, entryMin: event.target.value })} className={`${inputClass} font-mono`} /></label><label className="text-[10px] text-dark-500">Entry max<input inputMode="decimal" value={draft.entryMax} onChange={(event) => onChange({ ...draft, entryMax: event.target.value })} className={`${inputClass} font-mono`} /></label></>}
      </>}
      <label className="col-span-2 text-[10px] text-dark-500">Stop Loss<input inputMode="decimal" value={draft.stopLoss} onChange={(event) => onChange({ ...draft, stopLoss: event.target.value })} className={`${inputClass} font-mono`} /></label>
      <label className="col-span-2 text-[10px] text-dark-500">Take Profit<input inputMode="decimal" value={draft.takeProfit} onChange={(event) => onChange({ ...draft, takeProfit: event.target.value })} className={`${inputClass} font-mono`} /></label>
      <label className="col-span-2 text-[10px] text-dark-500">{isKo ? '최대 보유시간(선택)' : 'Maximum hold hours'}<input inputMode="decimal" value={draft.maxHoldHours} onChange={(event) => onChange({ ...draft, maxHoldHours: event.target.value })} className={`${inputClass} font-mono`} /></label>
      <label className="col-span-2 text-[10px] text-dark-500">Setup<input value={draft.setup} onChange={(event) => onChange({ ...draft, setup: event.target.value })} className={inputClass} /></label>
      <label className="col-span-3 text-[10px] text-dark-500">{isKo ? '진입 근거' : 'Entry rationale'}<textarea value={draft.entryNote} onChange={(event) => onChange({ ...draft, entryNote: event.target.value })} className="mt-1 h-20 w-full border border-dark-700 bg-dark-950 p-2 text-xs" /></label>
      <label className="col-span-3 text-[10px] text-dark-500">{isKo ? '계획 청산 조건' : 'Planned exit condition'}<textarea value={draft.exitNote} onChange={(event) => onChange({ ...draft, exitNote: event.target.value })} className="mt-1 h-20 w-full border border-dark-700 bg-dark-950 p-2 text-xs" /></label>
      <label className="col-span-2 text-[10px] text-dark-500 lg:col-span-6">Memo ({isKo ? '선택' : 'optional'})<textarea value={draft.memo} onChange={(event) => onChange({ ...draft, memo: event.target.value })} className="mt-1 h-20 w-full border border-dark-700 bg-dark-950 p-2 text-xs" /></label>
    </div>
    {retrospective && <div className="mt-3 text-[10px] text-amber-200">{isKo ? '회고 입력은 기억 편향 또는 사후 편향을 포함할 수 있으며 사전 기록으로 표시되지 않습니다.' : 'Retrospective plans may contain hindsight bias and are never labelled pre-trade.'}</div>}
    {error && <div className="mt-3 text-xs text-bear">{error}</div>}
    {saved && retrospective ? <div className="mt-5 border border-bull/30 bg-bull/5 p-4"><b className="text-sm text-white">{isKo ? '회고 계획이 저장되었습니다.' : 'Retrospective plan saved.'}</b><div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-4"><span>{isKo ? '실제' : 'Actual'} <strong className="font-mono text-white">{signed(evaluation?.actual_r, 2, 'R')}</strong></span><span>{isKo ? '계획' : 'Plan'} <strong className="font-mono text-white">{signed(evaluation?.planned_result_r, 2, 'R')}</strong></span><span>{isKo ? '차이' : 'Delta'} <strong className="font-mono text-white">{signed(evaluation?.execution_delta_r, 2, 'R')}</strong></span><span>{isKo ? '실행' : 'Execution'} <strong className="text-white">{evaluation ? behaviorLabel(evaluation.primary_execution_category || '', isKo) : (isKo ? '공식 결과 계산 중' : 'Calculating')}</strong></span></div>{!hasNextMissing && <p className="mt-4 text-xs text-bull">{isKo ? '현재 필터 범위의 계획 미입력 거래를 모두 입력했습니다.' : 'All trades without plans in the current filter have been completed.'}</p>}<div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={onViewAnalysis} className="btn-primary px-3 py-2 text-xs">{isKo ? '상세 분석 보기' : 'View analysis'}</button><button type="button" disabled={!hasNextMissing} onClick={onNextMissing} className="border border-dark-700 px-3 py-2 text-xs text-dark-200 disabled:cursor-not-allowed disabled:opacity-40">{isKo ? '다음 미입력 거래' : 'Next trade without plan'}</button>{!hasNextMissing && <button type="button" onClick={onCancel} className="border border-dark-700 px-3 py-2 text-xs text-dark-200">{isKo ? '목록으로 돌아가기' : 'Back to list'}</button>}</div></div> : <button type="button" disabled={pending} onClick={onSubmit} className="btn-primary mt-4 px-4 py-2 text-xs disabled:opacity-50">{pending ? (isKo ? '저장 중' : 'Saving') : (isKo ? '계획 저장' : 'Save plan')}</button>}
  </section>;
  if (!retrospective) return content;
  return <div className="fixed inset-0 z-[80] bg-black/60" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}><aside className="ml-auto h-full w-full max-w-[620px] overflow-y-auto border-l border-dark-700 bg-dark-950 p-4 sm:p-6">{content}</aside></div>;
}

function EvidenceDrawer({ title, evaluations, entries, isKo, onClose, onSelect }: {
  title: string;
  evaluations: PlanEvaluation[];
  entries: JournalEntry[];
  isKo: boolean;
  onClose: () => void;
  onSelect: (evaluation: PlanEvaluation) => void;
}) {
  const entryById = new Map(entries.flatMap((entry) => entry.id == null ? [] : [[entry.id, entry]]));
  return <div className="fixed inset-0 z-[70] bg-black/60" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <aside className="ml-auto h-full w-full max-w-[760px] overflow-y-auto border-l border-dark-700 bg-dark-950 p-4 sm:p-6">
      <div className="flex items-start justify-between"><div><h2 className="text-lg font-bold text-white">{title}</h2><p className="mt-1 text-xs text-dark-500">{isKo ? `근거 거래 ${evaluations.length}건` : `${evaluations.length} evidence trades`}</p></div><button type="button" onClick={onClose}><X className="h-5 w-5" /></button></div>
      <div className="mt-5 space-y-2">{evaluations.map((item) => { const entry = entryById.get(item.journal_id); return <button key={item.journal_id} type="button" onClick={() => onSelect(item)} className="grid w-full grid-cols-[1fr,80px,80px,24px] items-center gap-3 border border-dark-700 p-3 text-left hover:border-primary-400"><span><b className="block text-xs text-white">{item.symbol} · {item.side.toUpperCase()}</b><small className="text-dark-500">{dateLabel(item.exit_datetime, isKo)} · {behaviorLabel(item.primary_execution_category || '', isKo)}</small></span><span className="font-mono text-xs">{signed(item.actual_r, 2, 'R')}</span><span className="font-mono text-xs">{signed(item.planned_result_r, 2, 'R')}</span><ChevronRight className="h-4 w-4 text-dark-500" />{!entry && <span />}</button>; })}</div>
    </aside>
  </div>;
}

function EvaluationModal({ evaluation, entry, entries, isKo, onClose }: {
  evaluation: PlanEvaluation;
  entry?: JournalEntry;
  entries: JournalEntry[];
  isKo: boolean;
  onClose: () => void;
}) {
  const [reportOpen, setReportOpen] = useState(false);
  const revision = evaluation.plan_effective_at_entry;
  return <><div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-2 sm:p-8" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="max-h-full w-[1000px] overflow-y-auto border border-dark-700 bg-dark-950 p-4 sm:p-6">
    <div className="flex items-start justify-between"><div><h2 className="text-lg font-bold text-white">{evaluation.symbol} · {evaluation.side.toUpperCase()}</h2><p className="mt-1 text-xs text-dark-500">{dateLabel(evaluation.exit_datetime, isKo)} · {sourceLabel(evaluation.plan_source, isKo)}</p></div><button type="button" onClick={onClose}><X className="h-5 w-5" /></button></div>
    <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4"><Kpi label="Plan Entry / SL / TP" value={revision ? `${planEntryLabel(revision)} / ${revision.stop_loss} / ${revision.take_profit}` : '-'} /><Kpi label="Actual R" value={signed(evaluation.actual_r, 2, 'R')} /><Kpi label="Plan R" value={signed(evaluation.planned_result_r, 2, 'R')} /><Kpi label="Execution Delta" value={signed(evaluation.execution_delta_r, 2, 'R')} tone={(evaluation.execution_delta_r || 0) >= 0 ? 'positive' : 'negative'} /></div>
    <div className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-3"><div className="border border-dark-700 p-4"><span className="block text-dark-500">{isKo ? '시뮬레이션' : 'Simulation'}</span><b className="mt-2 block text-white">{evaluation.evaluation_status}</b></div><div className="border border-dark-700 p-4"><span className="block text-dark-500">{isKo ? '대표 실행 행동' : 'Primary behavior'}</span><b className="mt-2 block text-white">{behaviorLabel(evaluation.primary_execution_category || '', isKo)}</b></div><div className="border border-dark-700 p-4"><span className="block text-dark-500">{isKo ? '관찰 구간' : 'Horizon'}</span><b className="mt-2 block text-white">{evaluation.simulation_horizon_hours?.toFixed(1) || '-'}h</b></div></div>
    <p className="mt-4 border-l-2 border-primary-400 pl-3 text-xs text-dark-300">{isKo ? `입력 계획 기준 결과와 실제 결과의 차이는 ${signed(evaluation.execution_delta_r, 2, 'R')}였습니다. 이는 과거 경로에 대한 사후 비교입니다.` : `The actual-minus-plan execution delta was ${signed(evaluation.execution_delta_r, 2, 'R')}. This is a historical counterfactual review.`}</p>
    {entry && <button type="button" onClick={() => setReportOpen(true)} className="mt-5 border border-primary-400/40 px-4 py-2 text-xs text-primary-200">{isKo ? '거래 차트 복기 열기 →' : 'Open chart review →'}</button>}
  </section></div>{reportOpen && entry && <TradeReportModal entry={entry} allEntries={entries} isKo={isKo} onClose={() => setReportOpen(false)} />}</>;
}

function PlanDetailsDrawer({ plan, entry, evaluation, analysisRequested, analysisLoading, isKo, onClose, onRevise, onLoadAnalysis }: {
  plan: TradingPlan;
  entry?: JournalEntry;
  evaluation?: PlanEvaluation;
  analysisRequested: boolean;
  analysisLoading: boolean;
  isKo: boolean;
  onClose: () => void;
  onRevise: () => void;
  onLoadAnalysis: () => void;
}) {
  const revision = plan.latest_revision;
  return <div className="fixed inset-0 z-[80] bg-black/60" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="ml-auto h-full w-full max-w-[620px] overflow-y-auto border-l border-dark-700 bg-dark-950 p-4 sm:p-6">
    <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-bold text-white">{isKo ? '입력한 거래 계획' : 'Recorded trade plan'}</h2><p className="mt-1 text-xs text-dark-500">{entry ? `${dateLabel(entry.entry_datetime, isKo)} · ${entry.direction?.toUpperCase()} · ${entry.symbol}` : `${plan.symbol} · ${plan.side.toUpperCase()}`}</p></div><button type="button" onClick={onClose}><X className="h-5 w-5" /></button></div>
    <div className="mt-5 flex flex-wrap gap-2"><span className={`border px-2 py-1 text-[10px] ${plan.source === 'VERIFIED_PRETRADE' ? 'border-bull/40 text-bull' : 'border-amber-300/40 text-amber-200'}`}>{plan.source === 'VERIFIED_PRETRADE' ? (isKo ? '사전 기록 확인됨' : 'Verified pre-trade') : (isKo ? '회고 입력' : 'Retrospective')}</span><span className="border border-dark-700 px-2 py-1 text-[10px] text-dark-400">v{revision.version}</span></div>
    <p className="mt-3 text-xs leading-5 text-dark-400">{plan.source === 'VERIFIED_PRETRADE' ? (isKo ? '실제 진입 전에 서버에 저장된 계획입니다.' : 'This plan was server-recorded before the actual entry.') : (isKo ? '과거 거래에 대해 나중에 입력한 계획입니다.' : 'This plan was entered after the historical trade.')}</p>
    <div className="mt-5 grid grid-cols-2 gap-3"><Kpi label="Stop Loss" value={price(revision.stop_loss)} /><Kpi label="Take Profit" value={price(revision.take_profit)} /><Kpi label={isKo ? '최대 보유시간' : 'Maximum hold'} value={revision.max_hold_hours == null ? '-' : `${revision.max_hold_hours}h`} /><Kpi label="Setup" value={revision.setup || '-'} /></div>
    {(revision.entry_note || revision.exit_note || revision.memo) && <div className="mt-5 space-y-3 text-xs"><div className="border border-dark-700 p-3"><span className="block text-dark-500">{isKo ? '진입 근거' : 'Entry rationale'}</span><p className="mt-1 whitespace-pre-wrap text-dark-200">{revision.entry_note || '-'}</p></div><div className="border border-dark-700 p-3"><span className="block text-dark-500">{isKo ? '계획 청산 조건' : 'Planned exit condition'}</span><p className="mt-1 whitespace-pre-wrap text-dark-200">{revision.exit_note || '-'}</p></div>{revision.memo && <div className="border border-dark-700 p-3"><span className="block text-dark-500">Memo</span><p className="mt-1 whitespace-pre-wrap text-dark-200">{revision.memo}</p></div>}</div>}
    <div className="mt-5 border border-primary-400/30 bg-primary-500/5 p-4"><b className="text-sm text-white">{isKo ? 'Actual vs Plan' : 'Actual vs plan'}</b>{evaluation ? <div className="mt-3 grid grid-cols-3 gap-2 text-xs"><span>{isKo ? '실제' : 'Actual'} <strong className="block font-mono text-white">{signed(evaluation.actual_r, 2, 'R')}</strong></span><span>{isKo ? '계획' : 'Plan'} <strong className="block font-mono text-white">{signed(evaluation.planned_result_r, 2, 'R')}</strong></span><span>{isKo ? '차이' : 'Delta'} <strong className="block font-mono text-white">{signed(evaluation.execution_delta_r, 2, 'R')}</strong></span></div> : <div><p className="mt-2 text-xs text-dark-400">{analysisRequested ? (analysisLoading ? (isKo ? '공식 비교 결과를 계산하고 있습니다.' : 'Calculating the official comparison.') : (isKo ? '비교 가능한 가격 경로가 없습니다.' : 'No comparable price path is available.')) : (isKo ? '공식 비교는 요청할 때만 계산합니다.' : 'The official comparison is calculated on request.')}</p>{!analysisRequested && <button type="button" onClick={onLoadAnalysis} className="mt-3 border border-primary-400/40 px-3 py-2 text-xs text-primary-200">{isKo ? '공식 분석 불러오기' : 'Load official analysis'}</button>}</div>}</div>
    <button type="button" onClick={onRevise} className="mt-5 border border-dark-700 px-3 py-2 text-xs text-dark-200">{isKo ? '수정 이력 추가' : 'Add revision'}</button>
  </aside></div>;
}

function OptimizerRows({ variants, isKo }: { variants: PlanOptimizerVariant[]; isKo: boolean }) {
  const labels: Record<string, string> = {
    ACTUAL: isKo ? '실제 실행' : 'Actual',
    PLAN: isKo ? '계획 그대로' : 'Plan',
    PLAN_TP_ON_EARLY_EXIT: isKo ? '조기청산 거래만 Plan TP 유지' : 'Plan TP on early exits',
    PLAN_SL_ON_OVERRUN: isKo ? 'SL 초과 거래만 Plan SL 적용' : 'Plan SL on overruns',
    KEEP_EARLY_STOP_PLAN_TP: isKo ? '재량 조기손절 유지 + Plan TP' : 'Keep early stops + Plan TP',
  };
  return <div className="space-y-3">{variants.map((variant) => <div key={variant.id} className="grid grid-cols-1 items-center gap-3 border-b border-dark-800 py-3 text-xs sm:grid-cols-2 xl:grid-cols-[230px,1fr,1fr,150px] xl:gap-4"><b className="text-dark-200">{labels[variant.id] || variant.id}</b><span><small className="block text-dark-500">Discovery n={variant.discovery.trade_count} · {variant.discovery.sample_confidence}</small><strong className="font-mono">{signed(variant.discovery.expectancy_r, 2, 'R')}</strong></span><span><small className="block text-dark-500">Validation n={variant.validation.trade_count} · {variant.validation.sample_confidence}</small><strong className="font-mono">{signed(variant.validation.expectancy_r, 2, 'R')}</strong></span><span className={variant.validation_status === 'supported' ? 'text-bull' : variant.validation_status === 'observed_low_sample' ? 'text-amber-300' : 'text-dark-500'}>{variant.validation_status === 'supported' ? (isKo ? '검증 표본에서도 유지' : 'Maintained') : variant.validation_status === 'observed_low_sample' ? (isKo ? '같은 방향 · 표본 부족' : 'Same direction · low n') : (isKo ? '검증에서 유지 안 됨' : 'Not maintained')}</span></div>)}</div>;
}

export default function PlanLabPage() {
  const isKo = useLanguage() === 'ko';
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<JournalPeriod>(() => buildJournalPeriod(DEFAULT_DAYS));
  const [draftPeriod, setDraftPeriod] = useState<JournalPeriod>(() => buildJournalPeriod(DEFAULT_DAYS));
  const [direction, setDirection] = useState<DirectionFilter>('ALL');
  const [planStatus, setPlanStatus] = useState<PlanStatusFilter>('ALL');
  const [setup, setSetup] = useState('');
  const [symbol, setSymbol] = useState('');
  const [source, setSource] = useState<SourceFilter>('ALL');
  const [draft, setDraft] = useState<PlanDraft>(EMPTY_DRAFT);
  const [historicalTradeId, setHistoricalTradeId] = useState<number | null>(() => {
    const value = Number(new URLSearchParams(window.location.search).get('journalId'));
    return Number.isFinite(value) && value > 0 ? value : null;
  });
  const [revisionTarget, setRevisionTarget] = useState<TradingPlan>();
  const [showPretrade, setShowPretrade] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedTradeId, setSavedTradeId] = useState<number | null>(null);
  const [viewPlan, setViewPlan] = useState<TradingPlan | null>(null);
  const [analysisRequested, setAnalysisRequested] = useState(false);
  const [linkSelections, setLinkSelections] = useState<Record<number, string>>({});
  const [evidence, setEvidence] = useState<{ title: string; ids: number[] } | null>(null);
  const [selectedEvaluation, setSelectedEvaluation] = useState<PlanEvaluation | null>(null);

  const startTime = dateBoundaryTimestamp(period.start);
  const endTime = dateBoundaryTimestamp(period.end, true);
  const enabled = startTime != null && endTime != null && startTime <= endTime;
  const entriesQuery = useQuery({ queryKey: journalQueryKeys.entries, queryFn: getJournal });
  const plansQuery = useQuery({ queryKey: journalQueryKeys.plans, queryFn: getPlans });
  const analysisQuery = useQuery({
    queryKey: journalQueryKeys.planLab(startTime, endTime, direction, setup || undefined, symbol || undefined, source),
    queryFn: () => getPlanLab({
      start_time: startTime as number, end_time: endTime as number,
      direction: direction === 'ALL' ? undefined : direction,
      setup: setup || undefined, symbol: symbol || undefined,
      plan_source: source === 'ALL' ? undefined : source,
    }),
    enabled: shouldLoadPlanLabAnalysis(analysisRequested, enabled), staleTime: 5 * 60_000, retry: false,
  });

  const entries = useMemo(() => entriesQuery.data || [], [entriesQuery.data]);
  const plans = plansQuery.data || EMPTY_PLANS;
  const data = analysisQuery.data;
  const evaluations = data?.evaluations || [];
  const planByJournalId = useMemo(() => new Map(plans.flatMap((plan) => plan.link?.journal_entry_id ? [[plan.link.journal_entry_id, plan] as const] : [])), [plans]);
  const linkedJournalIds = useMemo(() => new Set(planByJournalId.keys()), [planByJournalId]);
  const closedInPeriod = useMemo(() => entries.filter((entry) => {
    if (!isClosedPosition(entry) || entry.id == null) return false;
    const close = new Date(entry.datetime || 0).getTime();
    const matchesDirection = direction === 'ALL' || entry.direction === direction;
    const matchesSymbol = !symbol || entry.symbol === symbol;
    return enabled && close >= (startTime as number) && close <= (endTime as number) && matchesDirection && matchesSymbol;
  }).sort((left, right) => new Date(right.entry_datetime || 0).getTime() - new Date(left.entry_datetime || 0).getTime()), [direction, enabled, endTime, entries, startTime, symbol]);
  const missingPlans = useMemo(() => closedInPeriod.filter((entry) => entry.id != null && !linkedJournalIds.has(entry.id)), [closedInPeriod, linkedJournalIds]);
  const listedTrades = useMemo(() => closedInPeriod.filter((entry) => {
    const linkedPlan = entry.id == null ? undefined : planByJournalId.get(entry.id);
    if (planStatus === 'NO_PLAN') return !linkedPlan;
    if (planStatus === 'RECORDED') return linkedPlan != null;
    return true;
  }), [closedInPeriod, planByJournalId, planStatus]);
  const selectedTrade = entries.find((entry) => entry.id === historicalTradeId);
  const setupOptions = [...new Set(plans.map((plan) => plan.latest_revision.setup).filter((value): value is string => Boolean(value)))].sort();
  const symbolOptions = [...new Set(closedInPeriod.map((entry) => entry.symbol).filter((value): value is string => Boolean(value)))].sort();

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: journalQueryKeys.plans }),
      queryClient.invalidateQueries({ queryKey: ['plan-lab'] }),
    ]);
  };
  const saveMutation = useMutation({
    mutationFn: async () => {
      const revision = revisionPayload(draft, Boolean(historicalTradeId));
      if (!revision) throw new Error(historicalTradeId
        ? (isKo ? 'Stop과 TP 값을 확인하세요.' : 'Check Stop and TP.')
        : (isKo ? '계획 Entry, Stop, TP 값을 확인하세요.' : 'Check Plan Entry, Stop and TP.'));
      if (historicalTradeId) return createRetrospectivePlan(historicalTradeId, revision);
      if (revisionTarget) return addPlanRevision(revisionTarget.id, revision);
      return createPlan({ exchange: draft.exchange, symbol: draft.symbol, side: draft.side, revision });
    },
    onSuccess: async () => {
      if (historicalTradeId) setAnalysisRequested(true);
      setSavedTradeId(historicalTradeId); setRevisionTarget(undefined); setShowPretrade(false); setFormError(null);
      await invalidate();
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : String(error)),
  });
  const linkMutation = useMutation({ mutationFn: ({ planId, journalId }: { planId: number; journalId: number }) => linkPlanToTrade(planId, journalId), onSuccess: invalidate });
  const statusMutation = useMutation({ mutationFn: ({ planId, status }: { planId: number; status: 'active' | 'cancelled' }) => updatePlanStatus(planId, status), onSuccess: invalidate });

  const matchingEntries = (plan: TradingPlan) => closedInPeriod.filter((entry) => entry.id != null && entry.external_id && !linkedJournalIds.has(entry.id) && entry.direction === plan.side && normalizeSymbol(entry.symbol) === plan.symbol_key && (!entry.exchange || entry.exchange.toLowerCase() === plan.exchange));
  const openEvidence = (title: string, row: { journal_ids: number[] }) => setEvidence({ title, ids: row.journal_ids });
  const selectEvaluation = (journalId: number) => {
    const evaluation = evaluations.find((item) => item.journal_id === journalId);
    if (evaluation) setSelectedEvaluation(evaluation);
  };
  const openHistoricalTrade = (entry: JournalEntry | undefined) => {
    if (!entry?.id) return;
    setHistoricalTradeId(entry.id); setDraft(draftFromHistoricalTrade(entry)); setSavedTradeId(null);
    setRevisionTarget(undefined); setShowPretrade(false); setFormError(null);
  };
  const openNextMissing = (current?: JournalEntry) => openHistoricalTrade(nextMissingTrade(current, missingPlans));
  const applyPeriod = () => {
    const start = dateBoundaryTimestamp(draftPeriod.start);
    const end = dateBoundaryTimestamp(draftPeriod.end, true);
    if (start != null && end != null && start <= end) setPeriod(draftPeriod);
  };
  const requestAnalysis = () => {
    setAnalysisRequested(true);
    window.setTimeout(() => {
      document.getElementById('plan-lab-analysis')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };
  const summary = data?.summary;
  const coverageItems = data ? [
    { label: isKo ? '종료 거래' : 'Closed', value: data.coverage.closed_trades },
    { label: isKo ? 'Plan 입력' : 'Plans', value: data.coverage.plan_recorded },
    { label: isKo ? '공식 USDT R' : 'Official USDT R', value: data.coverage.official_r },
    { label: isKo ? '가격 R만 가능' : 'Price R only', value: data.coverage.price_r_only },
    { label: isKo ? 'R 계산 불가' : 'R unavailable', value: data.coverage.r_unavailable },
    { label: isKo ? '동일 봉 충돌' : 'Ambiguous', value: data.coverage.ambiguous },
    { label: isKo ? '경계·경로 불확실' : 'Not evaluable', value: data.coverage.not_evaluable },
    { label: isKo ? '사전 기록' : 'Verified', value: data.coverage.verified_pretrade },
    { label: isKo ? '회고 입력' : 'Retrospective', value: data.coverage.retrospective },
  ] : [];
  const evidenceEvaluations = evidence ? evaluations.filter((item) => evidence.ids.includes(item.journal_id)) : [];
  const selectedTradeEvaluation = selectedTrade?.id == null ? undefined : evaluations.find((item) => item.journal_id === selectedTrade.id);
  const hasNextMissing = nextMissingTrade(selectedTrade, missingPlans) != null;

  return <div className="space-y-6">
    <header className="flex flex-col items-stretch justify-between gap-4 lg:flex-row lg:items-end"><div><h1 className="flex items-center gap-2 text-xl font-bold text-white"><ClipboardCheck className="h-5 w-5 text-primary-300" />{isKo ? '과거 거래 계획 입력' : 'Historical trade plan input'}</h1><p className="mt-1 text-xs text-dark-500">{isKo ? '과거 거래를 선택하고 당시 의도했던 계획을 직접 입력하세요.' : 'Select a closed trade and enter the plan you intended at the time.'}</p></div><div className="grid grid-cols-2 gap-2 sm:flex sm:items-end"><button type="button" onClick={() => { const next = buildJournalPeriod(DEFAULT_DAYS); setDraftPeriod(next); setPeriod(next); }} className="border border-dark-700 px-3 py-2 text-xs">90{isKo ? '일' : 'D'}</button><input type="date" value={draftPeriod.start} max={toDateInputValue(new Date())} onChange={(event) => setDraftPeriod({ ...draftPeriod, start: event.target.value })} className="min-w-0 border border-dark-700 bg-dark-900 px-2 py-2 text-xs" /><input type="date" value={draftPeriod.end} max={toDateInputValue(new Date())} onChange={(event) => setDraftPeriod({ ...draftPeriod, end: event.target.value })} className="min-w-0 border border-dark-700 bg-dark-900 px-2 py-2 text-xs" /><button type="button" onClick={applyPeriod} className="btn-primary px-3 py-2 text-xs">{isKo ? '적용' : 'Apply'}</button></div></header>

    <section className="flex flex-col gap-3 border-y border-dark-700 py-3 lg:flex-row lg:items-center lg:justify-between"><div className="text-xs text-dark-400">{period.start} ~ {period.end} · {isKo ? '목록 범위: 기간·방향·종목' : 'List scope: period, side, symbol'}</div><div className="grid grid-cols-2 gap-2"><select value={direction} onChange={(event) => setDirection(event.target.value as DirectionFilter)} className="h-9 min-w-0 border border-dark-700 bg-dark-900 px-2 text-xs"><option value="ALL">{isKo ? '전체 방향' : 'All sides'}</option><option value="Long">LONG</option><option value="Short">SHORT</option></select><select value={symbol} onChange={(event) => setSymbol(event.target.value)} className="h-9 min-w-0 border border-dark-700 bg-dark-900 px-2 text-xs"><option value="">{isKo ? '전체 종목' : 'All symbols'}</option>{symbolOptions.map((value) => <option key={value}>{value}</option>)}</select></div></section>

    <section className="grid grid-cols-1 gap-3 sm:grid-cols-3"><Kpi label={isKo ? '종료 거래' : 'Closed trades'} value={String(closedInPeriod.length)} detail={isKo ? '현재 목록 범위' : 'Current list scope'} /><Kpi label={isKo ? '계획 입력 완료' : 'Plans recorded'} value={String(closedInPeriod.length - missingPlans.length)} detail={isKo ? '현재 목록 범위' : 'Current list scope'} tone="positive" /><Kpi label={isKo ? '계획 미입력' : 'Plans missing'} value={String(missingPlans.length)} detail={isKo ? '현재 목록 범위' : 'Current list scope'} tone="primary" /></section>

    <section className="border border-dark-700 bg-dark-900/25 p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><SectionHeading title={isKo ? '종료 거래에서 계획 입력' : 'Enter plans from closed trades'} description={isKo ? '계획이 없는 거래는 분석 불가 상태일 뿐, 실패나 규칙 위반으로 처리하지 않습니다.' : 'A missing plan only means the trade is not yet comparable; it is not a failure or rule violation.'} /></div><button type="button" onClick={() => setShowPretrade(true)} className="self-start border border-dark-700 px-3 py-2 text-xs text-dark-300">{isKo ? '사전 계획 기록' : 'Record pre-trade'}</button></div><div className="mt-4 flex flex-wrap gap-2">{([{ id: 'ALL', ko: '전체', en: 'All' }, { id: 'NO_PLAN', ko: '계획 미입력', en: 'Missing plans' }, { id: 'RECORDED', ko: '입력 완료', en: 'Recorded' }] as const).map((item) => <button key={item.id} type="button" onClick={() => setPlanStatus(item.id)} className={`border px-3 py-2 text-xs ${planStatus === item.id ? 'border-primary-400 bg-primary-500/10 text-primary-200' : 'border-dark-700 text-dark-400 hover:text-white'}`}>{isKo ? item.ko : item.en}</button>)}</div><div className="mt-4 overflow-x-auto"><table className="min-w-[780px] w-full text-left text-xs"><thead className="border-y border-dark-700 text-[10px] text-dark-500"><tr><th className="px-3 py-3 font-medium">{isKo ? '날짜' : 'Date'}</th><th className="px-3 py-3 font-medium">{isKo ? '방향' : 'Side'}</th><th className="px-3 py-3 font-medium">{isKo ? '실제 진입가' : 'Actual entry'}</th><th className="px-3 py-3 font-medium">{isKo ? '실제 결과' : 'Actual result'}</th><th className="px-3 py-3 font-medium">{isKo ? 'Plan 상태' : 'Plan status'}</th><th className="px-3 py-3 text-right font-medium">{isKo ? '액션' : 'Action'}</th></tr></thead><tbody>{listedTrades.map((entry) => { const plan = entry.id == null ? undefined : planByJournalId.get(entry.id); return <tr key={entry.id} className="border-b border-dark-800/80"><td className="px-3 py-3 text-dark-300">{dateLabel(entry.entry_datetime, isKo)}</td><td className="px-3 py-3"><b className={entry.direction === 'Long' ? 'text-bull' : 'text-bear'}>{entry.direction?.toUpperCase() || '-'}</b></td><td className="px-3 py-3 font-mono text-dark-200">{price(entry.entry_price)}</td><td className={`px-3 py-3 font-mono ${(entry.r_multiple ?? entry.pnl_pct ?? entry.realized_pnl ?? 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{actualResultLabel(entry)}</td><td className="px-3 py-3">{plan ? <span className={`border px-2 py-1 text-[10px] ${plan.source === 'VERIFIED_PRETRADE' ? 'border-bull/40 text-bull' : 'border-amber-300/40 text-amber-200'}`}>{sourceLabel(plan.source, isKo)}</span> : <span className="border border-dark-700 px-2 py-1 text-[10px] text-dark-400">{isKo ? '미입력' : 'No plan'}</span>}</td><td className="px-3 py-3 text-right">{plan ? <button type="button" onClick={() => setViewPlan(plan)} className="border border-dark-700 px-3 py-1.5 text-xs text-dark-200 hover:border-primary-400 hover:text-white">{isKo ? '계획 보기' : 'View plan'}</button> : <button type="button" onClick={() => openHistoricalTrade(entry)} className="btn-primary px-3 py-1.5 text-xs">{isKo ? '계획 입력' : 'Enter plan'}</button>}</td></tr>; })}</tbody></table></div>{!listedTrades.length && <p className="py-10 text-center text-xs text-dark-500">{isKo ? '현재 조건에 맞는 종료 거래가 없습니다.' : 'No closed trades match these filters.'}</p>}</section>

    {(selectedTrade || revisionTarget || showPretrade) && <PlanForm draft={draft} isKo={isKo} trade={selectedTrade} revisionTarget={revisionTarget} pending={saveMutation.isPending} error={formError} saved={selectedTrade?.id != null && savedTradeId === selectedTrade.id} evaluation={selectedTradeEvaluation} hasNextMissing={hasNextMissing} onChange={setDraft} onSubmit={() => saveMutation.mutate()} onCancel={() => { setHistoricalTradeId(null); setSavedTradeId(null); setRevisionTarget(undefined); setShowPretrade(false); setDraft(EMPTY_DRAFT); }} onViewAnalysis={() => { setHistoricalTradeId(null); setSavedTradeId(null); requestAnalysis(); }} onNextMissing={() => openNextMissing(selectedTrade)} />}

    {!analysisRequested && <section id="plan-lab-analysis" className="border border-dark-700 bg-dark-900/25 p-5"><SectionHeading title={isKo ? '기존 Plan Lab 분석' : 'Existing Plan Lab analysis'} description={isKo ? '가격 경로·품질·Optimizer 계산은 목록을 보는 동안 실행하지 않습니다. 필요할 때만 공식 분석을 불러옵니다.' : 'Path, quality, and optimizer calculations stay idle while browsing the list and load only on request.'} /><button type="button" onClick={requestAnalysis} className="btn-primary mt-4 px-4 py-2 text-xs">{isKo ? '공식 분석 불러오기' : 'Load official analysis'}</button></section>}

    {analysisRequested && <>
    <section className="flex flex-col gap-3 border border-dark-700 bg-dark-900/25 p-4 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-[10px] font-medium text-primary-300">{isKo ? '분석 전용 조건' : 'Analysis-only filters'}</div><p className="mt-1 text-xs text-dark-500">{isKo ? '아래 조건은 종료 거래 입력 목록과 상단 Plan 개수에는 적용되지 않습니다.' : 'These filters do not change the closed-trade list or plan counts above.'}</p></div><div className="grid grid-cols-2 gap-2"><select value={setup} onChange={(event) => setSetup(event.target.value)} className="h-9 min-w-0 border border-dark-700 bg-dark-950 px-2 text-xs"><option value="">{isKo ? '전체 Setup' : 'All setups'}</option>{setupOptions.map((value) => <option key={value}>{value}</option>)}</select><select value={source} onChange={(event) => setSource(event.target.value as SourceFilter)} className="h-9 min-w-0 border border-dark-700 bg-dark-950 px-2 text-xs"><option value="ALL">{isKo ? '전체 기록 유형' : 'All sources'}</option><option value="RETROSPECTIVE">{isKo ? '회고 입력' : 'Retrospective'}</option><option value="VERIFIED_PRETRADE">{isKo ? '사전 기록' : 'Verified pre-trade'}</option></select></div></section>

    <section id="plan-lab-analysis" className="border border-primary-400/30 bg-primary-500/5 px-5 py-4"><div className="text-[10px] font-medium text-primary-300">{isKo ? '기존 Plan Lab 분석' : 'Existing Plan Lab analysis'}</div><div className="mt-1 text-base font-semibold text-white">{data ? diagnosisText(data.diagnosis, isKo) : analysisQuery.isLoading ? (isKo ? '계획 데이터를 분석하고 있습니다.' : 'Analyzing plan data.') : (isKo ? '계획 분석을 불러오지 못했습니다.' : 'Could not load Plan Lab.')}</div><div className="mt-2 text-[10px] text-dark-500">{isKo ? '과거 데이터에 대한 사후 분석이며 미래 성과를 보장하지 않습니다.' : 'Historical analysis only; it does not guarantee future performance.'}</div></section>

    <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"><Kpi label="Actual Expectancy" value={signed(summary?.actual_expectancy_r, 2, 'R')} tone={(summary?.actual_expectancy_r || 0) >= 0 ? 'positive' : 'negative'} /><Kpi label="Plan Expectancy" value={signed(summary?.plan_expectancy_r, 2, 'R')} tone={(summary?.plan_expectancy_r || 0) >= 0 ? 'positive' : 'negative'} /><Kpi label="Execution Delta / trade" value={signed(summary?.execution_delta_r, 2, 'R')} tone={(summary?.execution_delta_r || 0) >= 0 ? 'positive' : 'negative'} /><Kpi label="Actual PF" value={summary?.actual.profit_factor?.toFixed(2) || '-'} /><Kpi label="Plan PF" value={summary?.plan.profit_factor?.toFixed(2) || '-'} /><Kpi label={isKo ? '공식 비교 표본' : 'Comparable sample'} value={String(summary?.official_r_count || 0)} detail={`${data?.coverage.plan_recorded || 0}/${data?.coverage.closed_trades || 0} Plan coverage`} /></section>

    <section className="border border-dark-700 bg-dark-900/25 p-5"><SectionHeading title={isKo ? '실제 실행 vs 계획 실행 누적 R' : 'Actual vs plan cumulative R'} description={isKo ? '같은 거래 표본에서 두 결과가 언제부터 벌어졌는지 확인합니다. 점을 누르면 거래를 엽니다.' : 'Uses the same trades to show where outcomes diverged.'} /><div className="mt-5"><CumulativeRChart points={data?.cumulative_curve || []} onSelect={selectEvaluation} isKo={isKo} /></div></section>

    <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className="border border-dark-700 bg-dark-900/25 p-5"><SectionHeading title={isKo ? '성과 차이는 어디서 발생했나?' : 'Where did the execution gap occur?'} description={isKo ? '한 거래당 하나의 대표 행동만 사용하므로 합계가 전체 실행 차이와 중복되지 않습니다.' : 'One primary behavior per trade prevents double counting.'} /><div className="mt-5"><DeltaBars rows={data?.primary_attribution || []} label={(id) => behaviorLabel(id, isKo)} onSelect={(row) => openEvidence(behaviorLabel(row.id, isKo), row)} isKo={isKo} /></div></div>
      <div className="border border-dark-700 bg-dark-900/25 p-5"><SectionHeading title={isKo ? '거래별 실행 차이 분포' : 'Execution delta distribution'} description={isKo ? '여러 작은 차이인지, 몇 건의 큰 실수인지 구분합니다.' : 'Distinguishes frequent small gaps from a few large ones.'} /><div className="mt-5"><DeltaDistribution buckets={data?.delta_distribution || []} onSelect={(row: PlanDeltaBucket) => openEvidence(row.label, row)} isKo={isKo} /></div></div>
    </section>

    <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className="border border-dark-700 bg-dark-900/25 p-5"><SectionHeading title={isKo ? '조기청산 이후 경로' : 'What happened after early exits?'} description={isKo ? '실제 청산 후 TP·SL 방향 중 어디가 먼저 나타났는지 봅니다.' : 'Tracks which plan barrier appeared first after the actual exit.'} /><div className="mt-4"><DeltaBars rows={data?.early_exit_analysis || []} label={(id) => behaviorLabel(id, isKo)} onSelect={(row) => openEvidence(behaviorLabel(row.id, isKo), row)} isKo={isKo} /></div></div>
      <div className="border border-dark-700 bg-dark-900/25 p-5"><SectionHeading title={isKo ? '손절 행동 분석' : 'Stop behavior'} description={isKo ? '재량 조기손절과 계획 SL 초과보유 결과를 분리합니다.' : 'Separates discretionary early stops from SL overruns.'} /><div className="mt-4"><DeltaBars rows={data?.stop_behavior_analysis || []} label={(id) => behaviorLabel(id, isKo)} onSelect={(row) => openEvidence(behaviorLabel(row.id, isKo), row)} isKo={isKo} /></div></div>
    </section>

    <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="border border-dark-700 bg-dark-900/25 p-5"><SectionHeading title="Setup · Actual vs Plan" description={isKo ? 'Setup 문자열은 계획 Revision에 스냅샷으로 보존됩니다.' : 'Setup text is preserved in each plan revision.'} /><div className="mt-4"><ActualPlanRows rows={(data?.setup_stats || []).slice(0, 8)} onSelect={(row: PlanSetupStats) => openEvidence(row.id, row)} isKo={isKo} /></div></div>
      <div className="border border-dark-700 bg-dark-900/25 p-5"><SectionHeading title="LONG / SHORT" description={isKo ? '방향별 실행 차이를 같은 R 기준으로 비교합니다.' : 'Compares execution gaps by side.'} /><div className="mt-4"><ActualPlanRows rows={data?.side_stats || []} onSelect={(row) => openEvidence(row.id, row)} isKo={isKo} /></div></div>
      <div className="border border-dark-700 bg-dark-900/25 p-5"><SectionHeading title={isKo ? '시장상황 · Actual vs Plan' : 'Regime · Actual vs Plan'} description={isKo ? '기존 Weekly/Daily/4H 시장상황 분류를 재사용합니다.' : 'Reuses the existing Weekly/Daily/4H regime.'} /><div className="mt-4"><ActualPlanRows rows={(data?.regime_stats || []).slice(0, 8)} onSelect={(row) => openEvidence(row.id, row)} isKo={isKo} /></div></div>
    </section>

    <section className="border border-dark-700 bg-dark-900/25 p-5"><SectionHeading title={isKo ? '트레이딩 스타일 개선 후보' : 'Trading style improvement candidates'} description={isKo ? '과거 70%에서 관찰하고 이후 30%에서 같은 방향이 유지되는지 확인합니다. 전체 표본의 신뢰도를 분할 표본에 재사용하지 않습니다.' : 'Chronological 70/30 discovery and validation with separate confidence.'} /><div className="mt-5"><OptimizerRows variants={data?.optimizer.variants || []} isKo={isKo} /></div><p className="mt-4 text-[10px] text-dark-500">{isKo ? 'Validation 표본이 부족하면 개선 추천이 아니라 관찰로만 표시합니다.' : 'Low validation samples are observations, not recommendations.'}</p></section>

    <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className="border border-dark-700 bg-dark-900/25 p-5"><SectionHeading title={isKo ? '계획 대비 실행 일치도' : 'Plan adherence'} description={isKo ? '회고 입력은 “입력 계획 대비 실행 일치도”, 사전 기록은 “계획 이행도”로 해석합니다.' : 'Retrospective plans measure similarity; verified plans measure adherence.'} /><div className="mt-4 grid grid-cols-2 gap-3"><Kpi label={isKo ? '평균 일치도' : 'Average adherence'} value={summary?.adherence_pct == null ? '-' : `${summary.adherence_pct.toFixed(1)}%`} /><Kpi label={isKo ? '계획 유사 거래' : 'Adherent trades'} value={summary?.adherent_trade_pct == null ? '-' : `${summary.adherent_trade_pct.toFixed(1)}%`} /></div></div>
      <div className="border border-dark-700 bg-dark-900/25 p-5"><SectionHeading title={isKo ? 'Plan Coverage' : 'Plan coverage'} description={isKo ? 'Plan이 없는 거래를 손실이나 미준수로 처리하지 않으며, 공식 비교에서 빠진 이유를 구분합니다.' : 'Trades without plans are not failures, and exclusions from the official comparison are separated by reason.'} /><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">{coverageItems.map((item) => <Kpi key={item.label} label={item.label} value={String(item.value)} />)}</div></div>
    </section>

    <section className="border border-dark-700 bg-dark-900/25 p-5"><SectionHeading title={isKo ? '계획 결과 × 실행 일치' : 'Plan result × execution similarity'} description={isKo ? '계획 품질과 실행을 하나의 점수로 합치지 않습니다.' : 'Plan quality and adherence remain separate.'} /><div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">{(data?.matrix || []).map((cell) => <button key={cell.id} type="button" onClick={() => openEvidence(cell.id, cell)} className="border border-dark-700 p-4 text-left hover:border-primary-400"><div className="flex flex-wrap justify-between gap-2"><b className="text-xs text-white">{cell.adherent ? (isKo ? '유사 실행' : 'Adherent') : (isKo ? '계획 이탈' : 'Deviated')} · {cell.plan_positive ? 'Plan +R' : 'Plan -R'}</b><SampleBadge count={cell.trade_count} isKo={isKo} /></div><div className="mt-3 font-mono text-xs">Plan {signed(cell.average_planned_r, 2, 'R')} · Actual {signed(cell.average_actual_r, 2, 'R')}</div></button>)}</div></section>

    <details className="border border-dark-700 bg-dark-900/25 p-5"><summary className="cursor-pointer text-sm font-semibold text-white">{isKo ? '계획 목록·Revision·사전 계획 연결' : 'Plans, revisions and pre-trade links'}</summary><div className="mt-4 space-y-2">{plans.map((plan) => { const candidates = matchingEntries(plan); const selected = linkSelections[plan.id] || ''; return <div key={plan.id} className="grid grid-cols-[1.2fr,0.8fr,1.4fr,auto] items-center gap-3 border border-dark-700 p-3"><div><b className="text-xs text-white">#{plan.id} · {plan.symbol} · {plan.side}</b><small className="mt-1 block text-dark-500">{sourceLabel(plan.source, isKo)} · v{plan.latest_revision.version}</small></div><span className="font-mono text-xs">{plan.latest_revision.stop_loss} / {plan.latest_revision.take_profit}</span><div>{plan.link ? <span className="text-xs text-bull">{isKo ? '연결 거래' : 'Linked'} #{plan.link.journal_entry_id}</span> : <div className="flex gap-2"><select value={selected} onChange={(event) => setLinkSelections({ ...linkSelections, [plan.id]: event.target.value })} className="h-9 min-w-0 flex-1 border border-dark-700 bg-dark-950 px-2 text-xs"><option value="">{isKo ? '종료 거래 선택' : 'Select trade'}</option>{candidates.map((entry) => <option key={entry.id} value={entry.id}>{dateLabel(entry.entry_datetime, isKo)}</option>)}</select><button type="button" disabled={!selected} onClick={() => linkMutation.mutate({ planId: plan.id, journalId: Number(selected) })} className="border border-primary-400/40 p-2 text-primary-200"><LinkIcon className="h-4 w-4" /></button></div>}</div><div className="flex gap-2"><button type="button" onClick={() => { setRevisionTarget(plan); setDraft(draftFromPlan(plan)); setHistoricalTradeId(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="border border-dark-700 p-2"><History className="h-4 w-4" /></button>{!plan.link && plan.status !== 'cancelled' && <button type="button" onClick={() => statusMutation.mutate({ planId: plan.id, status: 'cancelled' })} className="border border-dark-700 p-2 text-dark-500 hover:text-bear"><X className="h-4 w-4" /></button>}</div></div>; })}</div></details>

    <section className="border border-dark-700 bg-dark-900/25 p-5"><div className="flex flex-wrap justify-between gap-3"><SectionHeading title={isKo ? '근거 거래' : 'Evidence trades'} description={isKo ? '최근 계획 평가를 열어 계획·실제·반복 행동을 확인합니다.' : 'Open a trade-level plan evaluation.'} /><button type="button" onClick={() => setEvidence({ title: isKo ? '전체 Plan 거래' : 'All plan trades', ids: evaluations.map((item) => item.journal_id) })} className="text-xs text-primary-200">{isKo ? '전체 거래 보기 →' : 'View all →'}</button></div><div className="mt-4 grid grid-cols-1 gap-2 xl:grid-cols-2">{evaluations.slice(0, 6).map((item) => <button key={item.journal_id} type="button" onClick={() => setSelectedEvaluation(item)} className="grid grid-cols-[minmax(0,1fr),60px,60px,20px] items-center gap-2 border border-dark-700 p-3 text-left hover:border-primary-400 sm:grid-cols-[1fr,80px,80px,20px] sm:gap-3"><span className="min-w-0"><b className="block truncate text-xs text-white">{item.symbol} · {item.side.toUpperCase()}</b><small className="block truncate text-dark-500">{behaviorLabel(item.primary_execution_category || '', isKo)} · {sourceLabel(item.plan_source, isKo)}</small></span><span className="font-mono text-xs">{signed(item.actual_r, 2, 'R')}</span><span className="font-mono text-xs">{signed(item.planned_result_r, 2, 'R')}</span><ChevronRight className="h-4 w-4 text-dark-500" /></button>)}</div></section>

    {analysisQuery.isError && <div className="border border-bear/30 bg-bear/5 p-3 text-xs text-bear">{analysisQuery.error instanceof Error ? analysisQuery.error.message : String(analysisQuery.error)}</div>}
    {data?.warnings.map((warning) => <div key={warning} className="text-[10px] text-amber-300">{warning}</div>)}
    {evidence && <EvidenceDrawer title={evidence.title} evaluations={evidenceEvaluations} entries={entries} isKo={isKo} onClose={() => setEvidence(null)} onSelect={(evaluation) => { setEvidence(null); setSelectedEvaluation(evaluation); }} />}
    {selectedEvaluation && <EvaluationModal evaluation={selectedEvaluation} entry={entries.find((entry) => entry.id === selectedEvaluation.journal_id)} entries={entries} isKo={isKo} onClose={() => setSelectedEvaluation(null)} />}
    </>}
    {viewPlan && <PlanDetailsDrawer plan={viewPlan} entry={entries.find((entry) => entry.id === viewPlan.link?.journal_entry_id)} evaluation={evaluations.find((item) => item.journal_id === viewPlan.link?.journal_entry_id)} analysisRequested={analysisRequested} analysisLoading={analysisQuery.isLoading} isKo={isKo} onClose={() => setViewPlan(null)} onLoadAnalysis={requestAnalysis} onRevise={() => { setViewPlan(null); setRevisionTarget(viewPlan); setDraft(draftFromPlan(viewPlan)); setHistoricalTradeId(null); setSavedTradeId(null); }} />}
  </div>;
}
