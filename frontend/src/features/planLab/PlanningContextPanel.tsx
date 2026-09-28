import { useState } from 'react';
import type { PlanningContext } from '../../api/planningContext';
import type { TradingPlan } from '../../types';
import PlanHistory from './PlanHistory';
import { convertedJournalPrices, usePlanningContext, useLinkPlanningContext } from './planningContext';

const value = (input: unknown) => input == null || input === '' ? '—' : String(input);
const button = 'border border-primary-400/40 px-3 py-2 text-xs text-primary-100 disabled:opacity-40';

export default function PlanningContextPanel({ entryId, isKo, onOpenPlan, onStartPlan, onLinkPlan, linking = false, linkError }: {
  entryId: number; isKo: boolean;
  onOpenPlan: (plan: TradingPlan) => void;
  onStartPlan: (context: PlanningContext, confirmedPricePercent: boolean) => void;
  onLinkPlan?: (plan: TradingPlan) => void;
  linking?: boolean; linkError?: string;
}) {
  const query = usePlanningContext(entryId);
  const link = useLinkPlanningContext();
  // Keyed by trade in callers; no draft or copied server state lives here.
  const [confirmedValues, setConfirmedValues] = useState<string | null>(null);
  const [candidateId, setCandidateId] = useState('');
  const t = (ko: string, en: string) => isKo ? ko : en;
  if (query.isPending) return <p role="status">{t('계획 정보를 불러오는 중…', 'Loading planning context…')}</p>;
  if (query.isError || !query.data) return <div role="alert">{t('계획 정보를 불러올 수 없습니다.', 'Unable to load planning context')} <button className={button} onClick={() => void query.refetch()}>{t('재시도', 'Retry')}</button></div>;
  const context = query.data;
  const notes = context.journal_notes;
  const history = context.linked_plan;
  const canCreate = !history && context.link_state !== 'AMBIGUOUS';
  const prices = convertedJournalPrices(context);
  const conversionValues = JSON.stringify([context.actual_execution.entry_price, context.actual_execution.direction, notes.planned_stop_pct, notes.planned_target_pct]);
  const confirmed = confirmedValues === conversionValues;
  const candidate = context.candidate_plans.find(plan => String(plan.id) === candidateId);
  return <section aria-label={t('거래 계획 맥락', 'Trade planning context')} className="mb-5 min-w-0 space-y-3 border border-dark-700 bg-dark-900/35 p-4 text-xs">
    <h3 className="text-sm font-semibold">{t('거래 계획', 'Trade planning')}</h3>
    {context.link_state === 'AMBIGUOUS' && <p role="alert">{t('계획 연결 확인이 필요합니다. 자동으로 선택하거나 새 계획을 만들지 않습니다.', 'Plan link needs review. No plan is selected or created automatically.')}</p>}
    {!history && context.link_state !== 'AMBIGUOUS' && <p>{notes.has_notes
      ? t('계획 메모 있음 · 거래 계획으로 저장되지 않았습니다.', 'Planning notes recorded — not saved as a Trade Plan.')
      : t('연결된 거래 계획이나 계획 메모가 없습니다.', 'No linked Trade Plan or planning notes.')}</p>}
    <div className="grid min-w-0 gap-3 md:grid-cols-2">
      {notes.has_notes && <details className="order-2 min-w-0 space-y-2 break-words border border-dark-700 p-3">
        <summary className="cursor-pointer py-1 font-semibold">{t('Journal 계획 메모 · 기록 시점 미확인', 'Journal planning notes · timing not verified')}</summary>
        <p>{t('손절', 'Stop')}: {value(notes.planned_stop_pct)}% · {t('목표', 'Target')}: {value(notes.planned_target_pct)}%</p>
        <p>{value(notes.planned_entry_reason)}</p>
        <p className="text-dark-400">{t('최초 메모 시각', 'First note timestamp')}: {value(notes.plan_recorded_at)}</p>
        <p>{t('현재 값의 사전 기록을 증명하지 않습니다.', 'This does not verify when the current values were planned.')}</p>
      </details>}
      {history && <div className="min-w-0 space-y-2 md:col-span-2">
        <PlanHistory plan={history.plan} entryRevision={history.entry_time_revision} analysisRevision={history.analysis_revision} analysisBasis={history.analysis_basis} isKo={isKo} />
        <button className={button} onClick={() => onOpenPlan(history.plan)}>{t('계획 열기', 'Open plan')}</button>
      </div>}
    </div>
    {history && notes.has_notes && <p className="text-amber-200">{t('두 출처를 그대로 표시합니다. 값이 달라도 덮어쓰거나 동기화하지 않습니다.', 'Both sources are shown unchanged. Differences are not overwritten or synchronized.')}</p>}
    {!!context.candidate_plans.length && <div className="flex flex-wrap items-center gap-2">
      <label className="min-w-0 w-full">{t('연결할 기존 계획 선택', 'Select an existing plan to link')}
        <select aria-label={t('연결할 기존 계획 선택', 'Select an existing plan to link')} className="mt-1 block w-full min-w-0 border border-dark-700 bg-dark-950 p-2" value={candidateId} onChange={event => setCandidateId(event.target.value)}>
          <option value="">{t('직접 선택', 'Choose explicitly')}</option>
          {context.candidate_plans.map(plan => <option key={plan.id} value={plan.id}>#{plan.id} · {plan.symbol} · SL {plan.latest_revision.stop_loss} / TP {plan.latest_revision.take_profit} · {plan.received_at}</option>)}
        </select>
      </label>
      <button className={button} disabled={!candidate || linking || link.isPending} onClick={() => candidate && (onLinkPlan ? onLinkPlan(candidate) : link.mutate({ planId: candidate.id, journalId: entryId }))}>{t('선택한 계획 연결', 'Link selected plan')}</button>
      {context.candidates_truncated && <p>{t('후보 중 50개를 표시합니다. Plan Lab에서도 확인하세요.', 'Showing 50 candidates. See Plan Lab for more.')}</p>}
    </div>}
    {linkError && <p role="alert">{linkError}</p>}
    {link.isError && <p role="alert">{t('계획을 연결하지 못했습니다. 새로 확인한 뒤 다시 시도하세요.', 'Could not link the plan. Refresh the context and try again.')}</p>}
    {canCreate && notes.has_notes && <>
      <p>{t('회고 변환 기준 실제 진입가', 'Retrospective conversion basis — actual entry')}: {value(context.actual_execution.entry_price)} · {value(context.actual_execution.direction)}</p>
      <p>{t('원래 이 가격으로 진입을 계획했다는 증거가 아닙니다. 저장 전 초안을 확인하세요.', 'This does not prove the original intended entry price. Review the draft before saving.')}</p>
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={!prices} onChange={event => setConfirmedValues(event.target.checked ? conversionValues : null)} />{t('메모의 %가 레버리지·증거금 수익률이 아닌 가격 변동률임을 확인합니다.', 'I confirm these percentages mean price moves, not leveraged or margin returns.')}</label>
      {!prices && <p>{t('유효한 진입가·방향·%가 없어 가격 변환할 수 없습니다. 근거 메모만 가져올 수 있습니다.', 'Price conversion unavailable: check entry, direction and percentages. Only the rationale can be copied.')}</p>}
      <button className={button} onClick={() => onStartPlan(context, confirmed && prices != null)}>{t('이 메모로 회고 계획 시작', 'Start retrospective plan from these notes')}</button>
    </>}
  </section>;
}
