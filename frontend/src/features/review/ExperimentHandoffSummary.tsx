import type { AnalyticsMetadata } from '../../types/analytics';
import type { ExperimentDefinition } from '../../types/review';
import { textFor } from '../../utils/localization';
import { buildRequest, canonicalRequest, type BuilderDraft } from '../analytics/analyticsBuilder';
import { experimentEvidence, experimentGroup, experimentMetric, experimentPeriod, experimentValue } from './experimentPresentation';
import type { ExperimentSeed, ReviewSource } from './reviewHandoff';
import { diagnosisText } from './reviewPresentation';

export function ReviewObservation({ source, metadata, isKo }: { source: ReviewSource; metadata: AnalyticsMetadata; isKo: boolean }) {
  const t = (ko: string, en: string) => textFor(isKo, ko, en);
  const pattern = source.kind === 'pattern' ? source.item : null;
  const groups = pattern ? [pattern.observed, pattern.baseline] : source.kind === 'diagnosis' ? source.item.strategy_evidence.flatMap(item => item.groups) : [];
  const kinds = [...new Set([source.metadata.evidence_semantics, ...groups.map(item => item.evidence_semantics)])];
  const small = pattern && Math.min(pattern.evaluable_trade_sample, pattern.baseline_evaluable_trade_sample) < source.metadata.policy.minimum_trade_sample;
  return <section aria-label={t('복기에서 가져온 관찰', 'Observation from Review')} className="min-w-0 space-y-2 rounded border border-primary-400/30 bg-primary-500/5 p-4 text-sm">
    <p className="text-xs text-primary-200">{t('복기에서 가져옴', 'From Review')} · {kinds.map(kind => experimentEvidence(kind, isKo)).join(' · ')}</p>
    <h3 className="font-semibold">{t('무엇을 관찰했나요?', 'What we observed')}</h3>
    <p>{experimentGroup(source, metadata, isKo)}</p>
    <p className="text-xs text-dark-300">{experimentPeriod(Number(source.metadata.filters.start_time), Number(source.metadata.filters.end_time), isKo)}</p>
    {pattern ? <>
      <p>{t('이 표본의', 'In this sample,')} {experimentMetric(pattern.metric, metadata, isKo)}: <strong>{experimentValue(pattern.observed.value, metadata.metrics.find(item => item.id === pattern.metric)?.unit ?? '', isKo)}</strong> · {t('선택한 전체 거래', 'all selected trades')}: {experimentValue(pattern.baseline.value, metadata.metrics.find(item => item.id === pattern.metric)?.unit ?? '', isKo)}.</p>
      <p className="text-xs">{t(`그룹 ${pattern.evaluable_trade_sample}/${pattern.observed.trade_sample}건, 전체 ${pattern.baseline_evaluable_trade_sample}/${pattern.baseline.trade_sample}건 판정 가능. 전체 비교에는 이 그룹도 포함됩니다.`, `Group: ${pattern.evaluable_trade_sample}/${pattern.observed.trade_sample} evaluable trades; all selected: ${pattern.baseline_evaluable_trade_sample}/${pattern.baseline.trade_sample}. The overall comparison includes this group.`)}</p>
    </> : source.kind === 'diagnosis' && <>
      <p>{diagnosisText(source.item.classification, isKo).title}</p>
      {source.item.strategy_evidence.filter(item => item.metric.id === 'average_r').map(item => <p key={item.metric.id}>{experimentMetric(item.metric.id, metadata, isKo)}: {item.groups.map(group => experimentValue(group.value, item.metric.unit, isKo)).join(' · ')}</p>)}
      <p className="text-xs">{t(`실행 규칙을 판정할 수 있는 거래 ${source.item.evaluable_rule_trade_sample}건. 전략 결과와 실행 근거는 서로 다른 표본일 수 있습니다.`, `${source.item.evaluable_rule_trade_sample} trades with evaluable execution rules. Strategy outcomes and execution evidence may use different samples.`)}</p>
    </>}
    {small && <p>{t('표본이 작습니다. 신중히 해석하세요.', 'Small sample — interpret cautiously.')}</p>}
    {groups.some(group => group.unavailable_sample > 0 || group.value === null) && <p>{t('일부 값이 없거나 판정할 수 없어 비교가 제한됩니다. 판정 불가는 규칙 위반이 아닙니다.', 'Missing or unavailable values limit this comparison. Not evaluable does not mean a rule violation.')}</p>}
    <p className="text-xs text-dark-300">{t('과거 표본의 관찰입니다. 원인이나 미래 성과를 확정하지 않으며, 시도할 행동은 직접 정합니다.', 'This describes a historical sample, not a cause or a prediction. You decide what behavior to try.')}</p>
  </section>;
}

export function ExperimentComparison({ seed, metadata, builder, groupKey, baselineStart, baselineEnd, criterion, minimum, isKo }: {
  seed: ExperimentSeed & { review: ReviewSource }; metadata: AnalyticsMetadata; builder: BuilderDraft; groupKey: string;
  baselineStart: string; baselineEnd: string; criterion: ExperimentDefinition['criterion']; minimum: string; isKo: boolean;
}) {
  const t = (ko: string, en: string) => textFor(isKo, ko, en);
  const query = buildRequest(metadata, builder).request;
  const sameGroup = builder.dimension === seed.query.dimension && (builder.dimension === 'all' || groupKey === seed.group_key);
  const nonPeriod = (filters: ExperimentSeed['query']['filters']) => Object.fromEntries(Object.entries(filters).filter(([key]) => !['start_time', 'end_time'].includes(key)));
  const sameFilters = query && JSON.stringify(nonPeriod(query.filters)) === JSON.stringify(nonPeriod(canonicalRequest(seed.query).filters));
  const currentEnd = query ? Number(query.filters.end_time) : NaN;
  const unit = metadata.metrics.find(item => item.id === builder.metric)?.unit ?? '';
  const basis = criterion.basis === 'DELTA' ? t('다음 기간 결과 − 이전 기간 결과', 'Next result minus baseline result') : t('다음 기간 결과', 'Next period result');
  return <section aria-label={t('무엇을 비교하나요?', 'What will be compared')} className="min-w-0 space-y-2 rounded border border-dark-700 p-4 text-sm">
    <h3 className="font-semibold">{t('무엇을 비교하나요?', 'What will be compared')}</h3>
    <p>{experimentMetric(builder.metric, metadata, isKo)} · {sameGroup && sameFilters ? experimentGroup(seed.review, metadata, isKo) : t('고급 설정에서 선택한 그룹', 'Group selected in Advanced settings')}</p>
    <p>{t('두 기간에서 같은 그룹과 기록 조건의 결과를 비교합니다. 위 복기의 그룹 대 전체 비교와는 다릅니다.', 'Compare the same group and recorded filters across two periods. This differs from the group-versus-overall observation above.')}</p>
    {!sameFilters && <p>{t('기록 조건이 복기에서 가져온 조건과 다릅니다. 고급 설정에서 확인하세요.', 'Recorded filters differ from the Review handoff. Check Advanced settings.')}</p>}
    {!query && <p role="status">{t('측정 조건이 완성되지 않았습니다. 고급 설정에서 확인하세요.', 'Measurement settings are incomplete. Check Advanced settings.')}</p>}
    <dl className="space-y-2">
      <div><dt className="text-dark-400">{t('이전 비교 기간', 'Previous baseline')}</dt><dd>{experimentPeriod(Date.parse(`${baselineStart}Z`), Date.parse(`${baselineEnd}Z`), isKo)}</dd></div>
      <div><dt className="text-dark-400">{t('다음 관찰 기간', 'Next observation period')}</dt><dd>{experimentPeriod(query ? Number(query.filters.start_time) : NaN, currentEnd, isKo)}</dd></div>
    </dl>
    <p className="text-xs text-dark-300">{t('현지 시각으로 표시한 거래 종료 기준 기간입니다. 정확한 경계는 고급 설정에서 확인할 수 있습니다.', 'Shown in local time, based on trade close/exit time. Exact boundaries are available in Advanced settings.')}</p>
    {currentEnd < Date.now() && <p>{t('관찰 기간이 이미 지났습니다. 앞으로 시험하려면 고급 설정에서 기간을 직접 확인하세요.', 'This observation period has already ended. To try something in the future, review the dates in Advanced settings.')}</p>}
    <p>{t(`각 기간의 판정 가능 표본과 거래가 각각 최소 ${minimum}개일 때 결과를 판단합니다.`, `Judge the result only with at least ${minimum} evaluable samples and ${minimum} trades in each period.`)}</p>
    <p>{t('판정 기준', 'Criterion')}: {t(`${basis}가 ${experimentValue(criterion.target, unit, isKo)} ${criterion.operator === 'gte' ? '이상' : '이하'}`, `${basis} ${criterion.operator === 'gte' ? 'at least' : 'at most'} ${experimentValue(criterion.target, unit, isKo)}`)}.</p>
    <p className="text-xs text-dark-300">{t('기간·전략 버전을 포함한 필터와 판정 기준은 고급 설정에서 확인·수정할 수 있습니다. 저장이나 시작은 자동으로 실행되지 않습니다.', 'Inspect or edit periods, filters including exact strategy versions, and criteria in Advanced settings. Nothing is saved or started automatically.')}</p>
  </section>;
}
