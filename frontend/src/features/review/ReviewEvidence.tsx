import type { AnalyticsGroup, AnalyticsResult } from '../../types/analytics';
import type { Diagnosis, ObservationEvidence, Pattern, TradingReview } from '../../types/review';
import { displayAnalyticsValue as value } from '../analytics/analyticsDisplay';
import { analyticsLabel, textFor } from '../../utils/localization';

export const panel = 'space-y-3 rounded border border-dark-700 bg-dark-900 p-4';
export function Samples({ group, isKo = false }: { group: AnalyticsGroup | null; isKo?: boolean }) {
  return group ? <span className="text-xs text-dark-300">{group.trade_sample}{textFor(isKo, '건 거래 · ', ' trades · ')}{group.total_sample}{textFor(isKo, '개 표본 · ', ' samples · ')}{group.evaluable_sample}{textFor(isKo, '개 판정 가능 · ', ' evaluable · ')}{group.unavailable_sample}{textFor(isKo, '개 판정 불가 ', ' unavailable ')}{group.unavailable_reason && `· ${group.unavailable_reason}`}{group.profit_factor_infinite && textFor(isKo, ' · 손실 없음; 비제한 비율', ' · No losses; unbounded ratio')}</span> : <span>{textFor(isKo, '판정 불가 그룹', 'Unavailable group')}</span>;
}
export function Metrics({ data, isKo = false }: { data: AnalyticsResult[]; isKo?: boolean }) {
  return <div className="grid gap-3 md:grid-cols-2">{data.map(result => <div key={`${result.metric.id}/${result.dimension.id}`} className="rounded bg-dark-950 p-3">
    <h4 className="text-sm font-medium">{analyticsLabel(result.metric.label, isKo)} ({result.metric.unit})</h4>
    {result.groups.map(group => <div key={group.identity.key} className="mt-2"><div className="text-sm">{group.identity.label}: <strong>{value(group.value)}</strong></div><Samples group={group} isKo={isKo} /></div>)}
  </div>)}</div>;
}
export function Observations({ items, isKo = false }: { items: ObservationEvidence[]; isKo?: boolean }) {
  return <div className="grid gap-2 md:grid-cols-2">{items.map(item => <div key={item.metric} className="rounded bg-dark-950 p-3 text-sm">
    <h4>{item.metric}</h4><p>{item.true_sample !== null && item.false_sample !== null ? `${textFor(isKo, '참', 'True')} ${item.true_sample} · ${textFor(isKo, '거짓', 'False')} ${item.false_sample}` : `${value(item.value)} ${item.value !== null ? item.unit : ''}`}</p>
    <p className="text-xs text-dark-300">{item.evaluable_sample}/{item.total_sample}{textFor(isKo, '개 판정 가능 · ', ' evaluable · ')}{item.unavailable_sample}{textFor(isKo, '개 판정 불가', ' unavailable')}</p>
    {item.within_entry_limit_sample !== null && <p className="text-xs">{textFor(isKo, '진입 한도 이내', 'Within entry limit')}: {item.within_entry_limit_sample} · {textFor(isKo, '이탈', 'Outside')}: {item.outside_entry_limit_sample}</p>}
    <p className="text-xs text-dark-400">{item.unavailable_reason} {Object.entries(item.unavailable_reasons).map(([reason, count]) => `${reason}: ${count}`).join(' · ')}</p>
  </div>)}</div>;
}
export function PatternFindings({ items, onExperiment, isKo = false }: { items: Pattern[]; onExperiment: (item: Pattern) => void; isKo?: boolean }) {
  return <section aria-label={textFor(isKo, '패턴 발견', 'Pattern findings')} className={panel}><h2 className="text-lg">{textFor(isKo, '패턴 발견', 'Pattern findings')}</h2><p className="text-xs text-dark-300">{textFor(isKo, '선택한 코호트 기준선과의 관찰 차이입니다. 순서와 적격 여부는 서버에서 제공합니다.', 'Observed differences from the selected cohort baseline. Order and eligibility are supplied by the backend.')}</p>
    {!items.length && <p>{textFor(isKo, '이 기간에 발견된 패턴이 없습니다.', 'No findings in this period.')}</p>}
    {items.map(item => <article className="border-t border-dark-700 pt-3" key={`${item.metric}/${item.dimension}/${item.observed.identity.key}`}>
      <h3>{item.dimension} · {item.observed.identity.label} · {item.metric}</h3><p className="text-xs text-amber-200">{item.status === 'ELIGIBLE' ? textFor(isKo, '적격 근거', 'Eligible evidence') : textFor(isKo, '근거 부족', 'Insufficient evidence')}</p>
      <p>{textFor(isKo, '관찰', 'Observed')} {value(item.observed.value)} · {textFor(isKo, '기준선', 'Baseline')} {value(item.baseline.value)} · {textFor(isKo, '차이', 'Delta')} {value(item.signed_delta)}</p>
      <div>{textFor(isKo, '관찰', 'Observed')}: <Samples group={item.observed} isKo={isKo} /></div><div>{textFor(isKo, '기준선', 'Baseline')}: <Samples group={item.baseline} isKo={isKo} /></div>
      <p className="text-xs">{item.reasons.join(' · ')}</p><button type="button" className="mt-2 text-sm text-primary-300" onClick={() => onExperiment(item)}>{textFor(isKo, '발견에서 실험 만들기', 'Create experiment from finding')}</button>
    </article>)}</section>;
}
const classifications = {
  STRATEGY_POSITIVE_EXECUTION_HEALTHY: 'Positive Strategy · Healthy Execution',
  STRATEGY_POSITIVE_EXECUTION_DRAG: 'Positive Strategy · Execution Drag',
  STRATEGY_WEAK_EXECUTION_HEALTHY: 'Weak Strategy · Healthy Execution',
  STRATEGY_WEAK_EXECUTION_DRAG: 'Weak Strategy · Execution Drag',
  INCONCLUSIVE: 'Inconclusive — insufficient or conflicting evidence',
};
export function DiagnosisCards({ items, onExperiment, isKo = false }: { items: Diagnosis[]; onExperiment: (item: Diagnosis) => void; isKo?: boolean }) {
  return <section aria-label={textFor(isKo, '전략 대 실행 진단', 'Strategy vs Execution diagnosis')} className={panel}><h2 className="text-lg">{textFor(isKo, '전략 대 실행', 'Strategy vs Execution')}</h2>
    {!items.length && <p>{textFor(isKo, '이 기간에 진단 결과가 없습니다.', 'No diagnosis in this period.')}</p>}
    {items.map(item => <article key={item.identity.key} className="space-y-3 border-t border-dark-700 pt-3">
      <h3>{item.identity.label} · {classifications[item.classification]}</h3><p className="text-xs text-dark-300">{item.reasons.join(' · ')}</p>
      <div className="grid gap-4 xl:grid-cols-2"><section aria-label={textFor(isKo, '전략 축', 'Strategy axis')}><h4 className="mb-2 font-medium">{textFor(isKo, '전략 축 — 관찰 결과', 'Strategy axis — observed outcomes')}</h4><Metrics data={item.strategy_evidence} isKo={isKo} /></section>
        <section aria-label={textFor(isKo, '실행 축', 'Execution axis')} className="space-y-3"><h4 className="font-medium">{textFor(isKo, '실행 축 — 프로세스 근거', 'Execution axis — process evidence')}</h4>
          <p>{textFor(isKo, '진단 실행 규칙 준수율', 'Diagnosis execution-rule adherence')}: {value(item.execution_rule_evidence.summary.adherence_pct)}% · {textFor(isKo, '커버리지', 'Coverage')}: {value(item.execution_rule_evidence.summary.coverage_pct)}%</p>
          <p className="text-xs">{item.execution_rule_evidence.execution_eligible_rule_count}{textFor(isKo, '개 적격 · ', ' eligible · ')}{item.execution_rule_evidence.execution_evaluable_rule_count}{textFor(isKo, '개 판정 가능 · ', ' evaluable · ')}{item.execution_rule_evidence.excluded_rule_count}{textFor(isKo, '개 제외 / ', ' excluded / ')}{item.execution_rule_evidence.total_rule_count}{textFor(isKo, '개 전체 규칙', ' total rules')}</p>
          <p className="text-xs">FOLLOWED {item.execution_rule_evidence.summary.followed_rules} · VIOLATED {item.execution_rule_evidence.summary.violated_rules} · NOT_EVALUABLE {item.execution_rule_evidence.summary.not_evaluable_rules}</p>
          <p className="text-xs text-dark-300">{textFor(isKo, '서버가 선택한 실행 프로세스 규칙만 표시합니다. 전체 규칙 준수율은 분모가 다릅니다.', 'Backend-selected execution process rules only. Global rule adherence has a different denominator.')}</p>
          <p className="text-xs">{textFor(isKo, '제외 역할', 'Excluded roles')}: {Object.entries(item.execution_rule_evidence.excluded_rule_counts_by_role).map(([role, count]) => `${role} ${count}`).join(' · ') || textFor(isKo, '없음', 'None')}</p>
          <Observations items={[item.entry_deviation]} isKo={isKo} />
        </section></div>
      <button type="button" className="text-primary-300" onClick={() => onExperiment(item)}>{textFor(isKo, '진단에서 실험 만들기', 'Create experiment from diagnosis')}</button>
    </article>)}</section>;
}
export function ReviewSections({ data, isKo = false }: { data: TradingReview; isKo?: boolean }) {
  return <div className="space-y-4">
    {data.state === 'EMPTY_PERIOD' && <p role="status" className={panel}>{textFor(isKo, '빈 기간 — 조건에 맞는 종료 거래가 없습니다.', 'Empty period — no closed trades match.')}</p>}
    <section className={panel}><h2>{textFor(isKo, '성과', 'Performance')}</h2><Metrics data={data.performance} isKo={isKo} /></section>
    {data.period_comparison.state !== 'NOT_REQUESTED' && <section className={panel}><h2>{textFor(isKo, '직전 동일 기간', 'Previous equal-length period')}</h2>
      <p className="text-xs">{data.period_comparison.state} · {textFor(isKo, 'UTC 종료 시각 기준으로 겹치지 않는 기간입니다. 양수 차이가 자동으로 개선을 뜻하지는 않습니다.', 'Non-overlapping UTC close/exit periods. Positive deltas are not automatically improvements.')}</p>
      {data.period_comparison.metrics.map(item => <div key={item.metric}><h3>{item.metric}</h3><p>{textFor(isKo, '현재', 'Current')} {value(item.current.value)} · {textFor(isKo, '이전', 'Previous')} {value(item.comparison.value)} · {textFor(isKo, '차이', 'Delta')} {value(item.signed_delta)}</p><div>{textFor(isKo, '현재', 'Current')}: <Samples group={item.current} isKo={isKo} /></div><div>{textFor(isKo, '이전', 'Previous')}: <Samples group={item.comparison} isKo={isKo} /></div><p>{item.unavailable_reason}</p></div>)}
    </section>}
    <section className={panel}><h2>{textFor(isKo, '전략', 'Strategy')}</h2><Metrics data={data.strategy} isKo={isKo} /></section>
    <section className={panel}><h2>{textFor(isKo, '실행 — 전체 규칙 근거 및 보유 행동', 'Execution — global Rule evidence and holding behavior')}</h2><p className="text-xs">{textFor(isKo, '결과 규칙을 포함한 모든 배정 규칙 결과입니다. 진단의 실행 품질과는 다릅니다.', 'All assigned Rule results, including outcome rules. This is not diagnosis execution quality.')}</p><Metrics data={data.execution.rule_and_holding_metrics} isKo={isKo} />
      <h3>{textFor(isKo, '계획 근거 및 진입 이탈', 'Plan evidence and entry deviation')}</h3><Observations items={data.execution.observations} isKo={isKo} /><h3>{textFor(isKo, '시장 경로 근거 — 별도 측정', 'Market-path evidence — separate measures')}</h3><Observations items={data.execution.market_dependent} isKo={isKo} /></section>
    <section className={panel}><h2>{textFor(isKo, '심리 — 기록된 상태', 'Psychology — recorded states')}</h2><Metrics data={data.psychology} isKo={isKo} /></section>
    <section className={panel}><h2>{textFor(isKo, '근거 품질', 'Evidence quality')}</h2><p>{data.evidence_quality.selected_trade_count}{textFor(isKo, '건 선택 · ', ' selected · ')}{data.evidence_quality.unassigned_trade_count}{textFor(isKo, '건 미지정 · ', ' unassigned · ')}{data.evidence_quality.assigned_without_rules_count}{textFor(isKo, '건 규칙 없는 배정', ' assigned without rules')}</p>
      <p>{data.evidence_quality.evaluable_rule_trade_count}{textFor(isKo, '건 전체 규칙 판정 가능 거래 · ', ' trades with evaluable global rules · ')}{data.evidence_quality.excluded_close_time_count_all_stored_positions}{textFor(isKo, '건 종료 시각을 알 수 없는 저장 포지션 제외', ' stored positions excluded for unavailable close time')}</p>
      <Observations items={data.evidence_quality.observations} isKo={isKo} /></section>
    <details className={panel}><summary>{textFor(isKo, '정책 및 근거 메모', 'Policy and evidence notes')}</summary>{data.metadata.warnings.map(note => <p key={note} className="text-xs">{note}</p>)}<p className="text-xs">{data.metadata.policy.execution_signal_policy}</p></details>
  </div>;
}
