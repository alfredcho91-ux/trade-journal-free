import { useId, useState, type ReactNode } from 'react';
import type { AnalyticsMetadata } from '../../types/analytics';
import type { Diagnosis, Pattern, TradingReview } from '../../types/review';
import { analyticsLabel, textFor } from '../../utils/localization';
import { displayAnalyticsValue as value } from '../analytics/analyticsDisplay';
import { DiagnosisCards, panel, PatternFindings, ReviewSections } from './ReviewEvidence';
import { diagnosisText, evidenceLimits, groupLabel, primaryFindings, reviewMetricLabel } from './reviewPresentation';

function Disclosure({ label, children, prominent = false }: { label: string; children: ReactNode; prominent?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className="min-w-0">
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}
      className={`min-h-11 max-w-full rounded px-3 py-2 text-left text-sm ${prominent ? 'bg-primary-500/20 text-primary-200' : 'border border-dark-700 text-dark-300'}`}>
      <span aria-hidden="true">{open ? '−' : '+'} </span>{label}
    </button>
    {open && <div id={id} className="mt-3 min-w-0 space-y-3 break-words">{children}</div>}
  </div>;
}

export default function ReviewSummary({ data, metadata, onPattern, onDiagnosis, isKo }: {
  data: TradingReview; metadata: AnalyticsMetadata; onPattern: (item: Pattern) => void; onDiagnosis: (item: Diagnosis) => void; isKo: boolean;
}) {
  const findings = primaryFindings(data);
  const limits = evidenceLimits(data, isKo);
  const unclear = data.strategy_execution.diagnoses.filter(d => d.classification === 'INCONCLUSIVE');
  const dimensionLabel = (id: string) => analyticsLabel(metadata.dimensions.find(d => d.id === id)?.label ?? textFor(isKo, '기록된 비교', 'Recorded comparison'), isKo);
  return <section aria-label={textFor(isKo, '복기 요약', 'Review summary')} className="min-w-0 space-y-4 break-words">
    <header className="space-y-1">
      <h2 className="text-xl font-semibold">{textFor(isKo, '먼저 살펴볼 발견', 'Top findings')}</h2>
      <p className="text-sm text-dark-300">{textFor(isKo, `선택한 기간·필터의 종료 거래 ${data.evidence_quality.selected_trade_count}건 · 전략 결과, 실행 근거, 기록된 패턴을 검토했습니다.`, `${data.evidence_quality.selected_trade_count} closed trades in the selected period and filters · Reviewed strategy outcomes, execution evidence and recorded patterns.`)}</p>
      <p className="text-xs text-dark-400">{textFor(isKo, '현재 저널 기록으로 계산했습니다. 관찰된 연관성이며 원인이나 미래 성과를 확정하지 않습니다.', 'Calculated from your current journal data. Observed associations do not establish cause or predict future performance.')}</p>
    </header>
    {!findings.length && <div role="status" className={panel}>
      <h3 className="font-semibold">{data.state === 'EMPTY_PERIOD' ? textFor(isKo, '조건에 맞는 종료 거래가 없습니다', 'No closed trades match') : textFor(isKo, '현재 강조할 뚜렷한 발견이 없습니다', 'No strong finding to highlight yet')}</h3>
      <p className="text-sm text-dark-300">{data.state === 'EMPTY_PERIOD' ? textFor(isKo, '기간이나 필터를 조정하거나 종료 거래를 기록하면 복기를 시작할 수 있습니다.', 'Adjust the period or filters, or record a closed trade to begin the review.') : textFor(isKo, '비교 가능한 차이가 없거나 근거가 부족·불일치합니다. 아래 근거 범위를 확인하세요. 발견이 없다고 효과가 없다는 뜻은 아닙니다.', 'Comparisons show no eligible difference, or evidence is limited or conflicting. Check the coverage below. No finding does not mean no effect.')}</p>
    </div>}
    <div className="space-y-3" aria-label={textFor(isKo, '주요 발견', 'Primary findings')}>
      {findings.map(finding => {
        if (finding.kind === 'diagnosis') {
          const item = finding.item, copy = diagnosisText(item.classification, isKo);
          const outcomes = item.strategy_evidence.filter(e => ['average_r', 'net_return_pct'].includes(e.metric.id));
          return <article key={`diagnosis/${item.identity.key}`} className={`${panel} min-w-0`}>
            <p className="text-xs font-semibold text-primary-200">{copy.category} · {groupLabel(item.identity, isKo)}</p>
            <h3 className="text-lg font-semibold">{copy.title}</h3>
            <p className="text-sm text-dark-200">{copy.why}</p>
            <div className="space-y-1 text-sm">{outcomes.map(result => <p key={result.metric.id}>{reviewMetricLabel(result.metric.id, isKo)}: <strong>{value(result.groups[0]?.value ?? null)} {result.metric.unit === 'percent' ? '%' : result.metric.unit}</strong> · {result.groups[0]?.evaluable_sample ?? 0}{textFor(isKo, '건 판정 가능', ' evaluable trades')}</p>)}</div>
            <p className="text-sm">{textFor(isKo, '실행 규칙 준수율', 'Execution-rule adherence')}: {value(item.execution_rule_evidence.summary.adherence_pct)}% · {textFor(isKo, '진입 한도 이내', 'Entries within limit')}: {item.entry_deviation.within_entry_limit_sample ?? '—'}/{item.entry_deviation.evaluable_sample}</p>
            <p className="text-xs text-dark-300">{textFor(isKo, `실행 규칙 판정 가능 거래 ${item.evaluable_rule_trade_sample}건 · 계획 진입 비교 ${item.entry_deviation.evaluable_sample}/${item.entry_deviation.total_sample}건. 두 표본은 중복될 수 있습니다.`, `${item.evaluable_rule_trade_sample} trades with evaluable execution rules · ${item.entry_deviation.evaluable_sample}/${item.entry_deviation.total_sample} trades with plan-entry evidence. These samples may overlap.`)}</p>
            <Disclosure label={textFor(isKo, '전략·실행 근거 살펴보기', 'Inspect Strategy and Execution evidence')} prominent>
              <DiagnosisCards items={[item]} onExperiment={onDiagnosis} isKo={isKo} />
            </Disclosure>
          </article>;
        }
        const item = finding.item;
        const small = item.evaluable_trade_sample < data.metadata.policy.minimum_trade_sample || item.baseline_evaluable_trade_sample < data.metadata.policy.minimum_trade_sample;
        return <article key={`pattern/${item.metric}/${item.dimension}/${item.observed.identity.key}`} className={`${panel} min-w-0`}>
          <p className="text-xs font-semibold text-primary-200">{textFor(isKo, '관찰된 연관성 · 전략/실행 진단 아님', 'Observed association · not a Strategy/Execution diagnosis')}</p>
          <h3 className="text-lg font-semibold">{reviewMetricLabel(item.metric, isKo)} · {dimensionLabel(item.dimension)}: {groupLabel(item.observed.identity, isKo)}</h3>
          <p className="text-sm text-dark-200">{textFor(isKo, '이 표본에서 이 그룹의 결과는 선택한 전체 거래와 달랐습니다. 비교 기준에는 이 그룹도 포함됩니다. 차이는 원인이나 통계적 유의성을 뜻하지 않습니다.', 'Within this sample, this group differed from all selected trades. The comparison includes this group; the difference is not a causal effect or a significance test.')}</p>
          <p className="text-sm">{textFor(isKo, '그룹', 'Group')}: <strong>{value(item.observed.value)}</strong> · {textFor(isKo, '전체', 'All selected')}: {value(item.baseline.value)} · {textFor(isKo, '차이', 'Difference')}: {value(item.signed_delta)} {item.metric === 'average_r' ? 'R' : '%'}</p>
          <p className="text-xs text-dark-300">{textFor(isKo, `그룹 ${item.evaluable_trade_sample}/${item.observed.trade_sample}건 · 전체 ${item.baseline_evaluable_trade_sample}/${item.baseline.trade_sample}건 판정 가능. 표본은 중복됩니다.`, `Group: ${item.evaluable_trade_sample}/${item.observed.trade_sample} evaluable trades · All selected: ${item.baseline_evaluable_trade_sample}/${item.baseline.trade_sample}. Samples overlap.`)}</p>
          {small && <p className="text-sm text-amber-200">{textFor(isKo, '표본이 작습니다. 신중히 해석하세요.', 'Small sample — interpret cautiously.')}</p>}
          <button type="button" className="min-h-11 max-w-full rounded bg-primary-500/20 px-3 py-2 text-left text-sm text-primary-200" onClick={() => onPattern(item)}>{textFor(isKo, '이 비교로 실험 초안 열기', 'Open experiment draft for this comparison')}</button>
          <Disclosure label={textFor(isKo, '비교 근거 펼치기', 'Expand comparison evidence')}><PatternFindings items={[item]} isKo={isKo} onExperiment={onPattern} /></Disclosure>
        </article>;
      })}
    </div>
    {(unclear.length > 0 || limits.length > 0) && <aside className="space-y-2 rounded border border-dark-700 p-4 text-sm" aria-label={textFor(isKo, '근거 범위와 판단 보류', 'Evidence coverage and unclear assessments')}>
      <h3 className="font-medium">{textFor(isKo, '근거 범위와 판단 보류', 'Evidence coverage and unclear assessments')}</h3>
      {unclear.length > 0 && <p>{textFor(isKo, `${unclear.length}개 진단은 전략/실행 판단을 보류했습니다. 근거 부족 또는 신호 불일치를 실행 실패로 분류하지 않습니다.`, `${unclear.length} diagnoses remain unclear. Limited or conflicting evidence is not classified as execution failure.`)}</p>}
      {limits.map(message => <p key={message} className="text-dark-300">{message}</p>)}
      {unclear.length > 0 && <Disclosure label={textFor(isKo, '판단 보류 진단 살펴보기', 'Inspect unclear diagnoses')}><DiagnosisCards items={unclear} isKo={isKo} onExperiment={onDiagnosis} /></Disclosure>}
    </aside>}
    <Disclosure label={textFor(isKo, '전체 복기 열기 — 모든 발견과 근거', 'Open full review — all findings and evidence')}>
      <PatternFindings items={data.patterns.candidates} onExperiment={onPattern} isKo={isKo} />
      <DiagnosisCards items={data.strategy_execution.diagnoses} onExperiment={onDiagnosis} isKo={isKo} />
      <ReviewSections data={data} isKo={isKo} />
      <Disclosure label={textFor(isKo, '원본 결과·사유 코드·재구성 정책', 'Raw result, reason codes and reconstruction policy')}>
        <pre className="max-h-96 max-w-full overflow-auto whitespace-pre-wrap break-all rounded bg-dark-950 p-3 text-xs">{JSON.stringify(data, null, 2)}</pre>
      </Disclosure>
    </Disclosure>
    <Disclosure label={textFor(isKo, '발견 선택 방식', 'How findings are selected')}>
      <p className="text-xs text-dark-300">{textFor(isKo, '약한 결과 또는 실행 저하 진단, 적격이며 차이가 0이 아닌 비교, 긍정적 결과·건강한 실행 진단 순으로 최대 3개를 표시합니다. 각 묶음의 서버 순서를 유지합니다. 이는 표시 순서이며 중요도 점수나 통계적 순위가 아닙니다. 나머지 결과는 전체 복기에서 확인할 수 있습니다.', 'Up to three: diagnoses with weak outcomes or execution drag, eligible comparisons with a nonzero difference, then positive/healthy diagnoses. Server order is retained within each group. This is a display order, not an importance score or statistical ranking. Every remaining result is available in the full review.')}</p>
    </Disclosure>
  </section>;
}
