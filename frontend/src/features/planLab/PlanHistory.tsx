import type { PlanRevision, TradingPlan } from '../../types';
import { planSourceLabel, planValue, revisionChanges, revisionFields, revisionTiming } from './planPresentation';

function RevisionValues({ revision, isKo }: { revision: PlanRevision; isKo: boolean }) {
  return <dl className="space-y-1">{revisionFields.filter(([key]) => ['entry_price', 'stop_loss', 'take_profit'].includes(key) || revision[key] != null && revision[key] !== '').map(([key, ko, en]) =>
    <div key={key} className="flex flex-wrap gap-x-2"><dt className="text-dark-400">{isKo ? ko : en}:</dt><dd className="min-w-0 whitespace-pre-wrap break-words">{planValue(revision[key])}</dd></div>)}</dl>;
}

export default function PlanHistory({ plan, entryRevision, analysisRevision, analysisBasis, isKo }: {
  plan: TradingPlan; entryRevision?: PlanRevision | null; analysisRevision?: PlanRevision | null; analysisBasis?: string; isKo: boolean;
}) {
  const t = (ko: string, en: string) => isKo ? ko : en;
  // PlanningContext supplies eligibility. A plan-level source must never certify the latest revision.
  const atEntry = analysisBasis === 'VERIFIED_PRETRADE' ? entryRevision : null;
  const latest = plan.latest_revision;
  const latestAnnotated = plan.revisions.find(item => item.id === latest.id) ?? latest;
  const changes = atEntry && atEntry.id !== latest.id ? revisionChanges(atEntry, latest, isKo) : [];
  return <section aria-label={t('계획 기록 순서', 'Plan chronology')} className="min-w-0 space-y-3 break-words text-xs">
    <p>{planSourceLabel(plan.source, isKo)}{plan.link?.link_status === 'LINKED' ? t(' · 이 거래에 연결됨', ' · Linked to this trade') : plan.link ? t(' · 연결 확인 필요', ' · Link needs review') : ''}</p>
    {atEntry ? <article className="space-y-2 border border-primary-400/30 p-3">
      <h4 className="font-semibold">{t('진입 시점의 계획 · 진입 전에 기록됨', 'At trade entry · recorded before entry')} · v{atEntry.version}</h4>
      <RevisionValues revision={atEntry} isKo={isKo} />
      <p className="text-dark-400">{t('이 거래의 사전 계획 비교에 사용되는 버전입니다.', 'This is the version used for this trade’s pre-entry plan comparison.')}</p>
    </article> : <p>{t('이 거래의 진입 전 계획으로 확인된 버전이 없습니다.', 'No version is verified as this trade’s pre-entry plan.')}</p>}
    <article className="space-y-2 border border-dark-700 p-3">
      <h4 className="font-semibold">{t('현재 계획 버전', 'Current plan revision')} · v{latest.version}</h4>
      <p>{revisionTiming(latestAnnotated, isKo)}{atEntry?.id === latest.id && t(' · 진입 시점 버전과 같음', ' · Same as the entry-time version')}</p>
      <RevisionValues revision={latest} isKo={isKo} />
      {atEntry && latest.id !== atEntry.id && <div className="space-y-1 border-t border-dark-700 pt-2">
        <p className="font-semibold">{t(`진입 시점 v${atEntry.version}에서 달라진 내용`, `Changes from entry-time v${atEntry.version}`)}</p>
        {changes.length ? changes.map(change => <p key={change.key}>{change.label}: {change.before} → {change.after}</p>) : <p>{t('가격·근거·메모 값은 같습니다.', 'Prices, rationale and notes are unchanged.')}</p>}
        <p className="text-dark-400">{t('최신 값이 진입 시점의 계획을 대체하지 않습니다.', 'The latest values do not replace the entry-time plan.')}</p>
      </div>}
    </article>
    {analysisRevision && analysisBasis === 'RETROSPECTIVE' && <p>{t('회고 비교에 사용하는 버전', 'Version used for retrospective comparison')}: v{analysisRevision.version} · {t('사전 계획의 증거가 아닙니다.', 'Not evidence of a pre-entry plan.')}</p>}
    <details className="min-w-0 border border-dark-700 p-3">
      <summary className="cursor-pointer py-1 font-semibold">{t('전체 버전 이력과 정확한 기록 정보', 'Full version history and exact provenance')}</summary>
      <ol className="mt-3 space-y-3">{plan.revisions.map((revision, index) => <li key={revision.id} className="space-y-1 border-b border-dark-700 pb-3">
        <b>v{revision.version} · {revisionTiming(revision, isKo)}</b>
        <p>{t('서버 기록 시각', 'Server-recorded time')}: <time>{revision.received_at}</time></p>
        {index === 0 ? <RevisionValues revision={revision} isKo={isKo} /> : revisionChanges(plan.revisions[index - 1], revision, isKo).map(change => <p key={change.key}>{change.label}: {change.before} → {change.after}</p>)}
      </li>)}</ol>
      <details className="mt-3"><summary className="cursor-pointer py-1">{t('원본 식별자·출처·저장 값', 'Raw IDs, provenance and stored values')}</summary>
        <pre className="mt-2 max-h-80 max-w-full overflow-auto whitespace-pre-wrap break-all">{JSON.stringify({ plan, entry_time_revision: entryRevision, analysis_revision: analysisRevision, analysis_basis: analysisBasis }, null, 2)}</pre>
      </details>
    </details>
  </section>;
}
