import type { AnalyticsGroup, AnalyticsResult } from '../../types/analytics';
import type { Diagnosis, ObservationEvidence, Pattern, TradingReview } from '../../types/review';
import { displayAnalyticsValue as value } from '../analytics/analyticsDisplay';

export const panel = 'space-y-3 rounded border border-dark-700 bg-dark-900 p-4';
export function Samples({ group }: { group: AnalyticsGroup | null }) {
  return group ? <span className="text-xs text-dark-300">{group.trade_sample} trades · {group.total_sample} samples · {group.evaluable_sample} evaluable · {group.unavailable_sample} unavailable {group.unavailable_reason && `· ${group.unavailable_reason}`}{group.profit_factor_infinite && ' · No losses; unbounded ratio'}</span> : <span>Unavailable group</span>;
}
export function Metrics({ data }: { data: AnalyticsResult[] }) {
  return <div className="grid gap-3 md:grid-cols-2">{data.map(result => <div key={`${result.metric.id}/${result.dimension.id}`} className="rounded bg-dark-950 p-3">
    <h4 className="text-sm font-medium">{result.metric.label} ({result.metric.unit})</h4>
    {result.groups.map(group => <div key={group.identity.key} className="mt-2"><div className="text-sm">{group.identity.label}: <strong>{value(group.value)}</strong></div><Samples group={group} /></div>)}
  </div>)}</div>;
}
export function Observations({ items }: { items: ObservationEvidence[] }) {
  return <div className="grid gap-2 md:grid-cols-2">{items.map(item => <div key={item.metric} className="rounded bg-dark-950 p-3 text-sm">
    <h4>{item.metric}</h4><p>{item.true_sample !== null && item.false_sample !== null ? `True ${item.true_sample} · False ${item.false_sample}` : `${value(item.value)} ${item.value !== null ? item.unit : ''}`}</p>
    <p className="text-xs text-dark-300">{item.evaluable_sample}/{item.total_sample} evaluable · {item.unavailable_sample} unavailable</p>
    {item.within_entry_limit_sample !== null && <p className="text-xs">Within entry limit: {item.within_entry_limit_sample} · Outside: {item.outside_entry_limit_sample}</p>}
    <p className="text-xs text-dark-400">{item.unavailable_reason} {Object.entries(item.unavailable_reasons).map(([reason, count]) => `${reason}: ${count}`).join(' · ')}</p>
  </div>)}</div>;
}
export function PatternFindings({ items, onExperiment }: { items: Pattern[]; onExperiment: (item: Pattern) => void }) {
  return <section aria-label="Pattern findings" className={panel}><h2 className="text-lg">Pattern findings</h2><p className="text-xs text-dark-300">Observed differences from the selected cohort baseline. Order and eligibility are supplied by the backend.</p>
    {!items.length && <p>No findings in this period.</p>}
    {items.map(item => <article className="border-t border-dark-700 pt-3" key={`${item.metric}/${item.dimension}/${item.observed.identity.key}`}>
      <h3>{item.dimension} · {item.observed.identity.label} · {item.metric}</h3><p className="text-xs text-amber-200">{item.status === 'ELIGIBLE' ? 'Eligible evidence' : 'Insufficient evidence'}</p>
      <p>Observed {value(item.observed.value)} · Baseline {value(item.baseline.value)} · Delta {value(item.signed_delta)}</p>
      <div>Observed: <Samples group={item.observed} /></div><div>Baseline: <Samples group={item.baseline} /></div>
      <p className="text-xs">{item.reasons.join(' · ')}</p><button type="button" className="mt-2 text-sm text-primary-300" onClick={() => onExperiment(item)}>Create experiment from finding</button>
    </article>)}</section>;
}
const classifications = {
  STRATEGY_POSITIVE_EXECUTION_HEALTHY: 'Positive Strategy · Healthy Execution',
  STRATEGY_POSITIVE_EXECUTION_DRAG: 'Positive Strategy · Execution Drag',
  STRATEGY_WEAK_EXECUTION_HEALTHY: 'Weak Strategy · Healthy Execution',
  STRATEGY_WEAK_EXECUTION_DRAG: 'Weak Strategy · Execution Drag',
  INCONCLUSIVE: 'Inconclusive — insufficient or conflicting evidence',
};
export function DiagnosisCards({ items, onExperiment }: { items: Diagnosis[]; onExperiment: (item: Diagnosis) => void }) {
  return <section aria-label="Strategy vs Execution diagnosis" className={panel}><h2 className="text-lg">Strategy vs Execution</h2>
    {!items.length && <p>No diagnosis in this period.</p>}
    {items.map(item => <article key={item.identity.key} className="space-y-3 border-t border-dark-700 pt-3">
      <h3>{item.identity.label} · {classifications[item.classification]}</h3><p className="text-xs text-dark-300">{item.reasons.join(' · ')}</p>
      <div className="grid gap-4 xl:grid-cols-2"><section aria-label="Strategy axis"><h4 className="mb-2 font-medium">Strategy axis — observed outcomes</h4><Metrics data={item.strategy_evidence} /></section>
        <section aria-label="Execution axis" className="space-y-3"><h4 className="font-medium">Execution axis — process evidence</h4>
          <p>Diagnosis execution-rule adherence: {value(item.execution_rule_evidence.summary.adherence_pct)}% · Coverage: {value(item.execution_rule_evidence.summary.coverage_pct)}%</p>
          <p className="text-xs">{item.execution_rule_evidence.execution_eligible_rule_count} eligible · {item.execution_rule_evidence.execution_evaluable_rule_count} evaluable · {item.execution_rule_evidence.excluded_rule_count} excluded / {item.execution_rule_evidence.total_rule_count} total rules</p>
          <p className="text-xs">FOLLOWED {item.execution_rule_evidence.summary.followed_rules} · VIOLATED {item.execution_rule_evidence.summary.violated_rules} · NOT_EVALUABLE {item.execution_rule_evidence.summary.not_evaluable_rules}</p>
          <p className="text-xs text-dark-300">Backend-selected execution process rules only. Global rule adherence has a different denominator.</p>
          <p className="text-xs">Excluded roles: {Object.entries(item.execution_rule_evidence.excluded_rule_counts_by_role).map(([role, count]) => `${role} ${count}`).join(' · ') || 'None'}</p>
          <Observations items={[item.entry_deviation]} />
        </section></div>
      <button type="button" className="text-primary-300" onClick={() => onExperiment(item)}>Create experiment from diagnosis</button>
    </article>)}</section>;
}
export function ReviewSections({ data }: { data: TradingReview }) {
  return <div className="space-y-4">
    {data.state === 'EMPTY_PERIOD' && <p role="status" className={panel}>Empty period — no closed trades match.</p>}
    <section className={panel}><h2>Performance</h2><Metrics data={data.performance} /></section>
    {data.period_comparison.state !== 'NOT_REQUESTED' && <section className={panel}><h2>Previous equal-length period</h2>
      <p className="text-xs">{data.period_comparison.state} · Non-overlapping UTC close/exit periods. Positive deltas are not automatically improvements.</p>
      {data.period_comparison.metrics.map(item => <div key={item.metric}><h3>{item.metric}</h3><p>Current {value(item.current.value)} · Previous {value(item.comparison.value)} · Delta {value(item.signed_delta)}</p><div>Current: <Samples group={item.current} /></div><div>Previous: <Samples group={item.comparison} /></div><p>{item.unavailable_reason}</p></div>)}
    </section>}
    <section className={panel}><h2>Strategy</h2><Metrics data={data.strategy} /></section>
    <section className={panel}><h2>Execution — global Rule evidence and holding behavior</h2><p className="text-xs">All assigned Rule results, including outcome rules. This is not diagnosis execution quality.</p><Metrics data={data.execution.rule_and_holding_metrics} />
      <h3>Plan evidence and entry deviation</h3><Observations items={data.execution.observations} /><h3>Market-path evidence — separate measures</h3><Observations items={data.execution.market_dependent} /></section>
    <section className={panel}><h2>Psychology — recorded states</h2><Metrics data={data.psychology} /></section>
    <section className={panel}><h2>Evidence quality</h2><p>{data.evidence_quality.selected_trade_count} selected · {data.evidence_quality.unassigned_trade_count} unassigned · {data.evidence_quality.assigned_without_rules_count} assigned without rules</p>
      <p>{data.evidence_quality.evaluable_rule_trade_count} trades with evaluable global rules · {data.evidence_quality.excluded_close_time_count_all_stored_positions} stored positions excluded for unavailable close time</p>
      <Observations items={data.evidence_quality.observations} /></section>
    <details className={panel}><summary>Policy and evidence notes</summary>{data.metadata.warnings.map(note => <p key={note} className="text-xs">{note}</p>)}<p className="text-xs">{data.metadata.policy.execution_signal_policy}</p></details>
  </div>;
}
