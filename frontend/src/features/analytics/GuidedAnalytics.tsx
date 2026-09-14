import { useState } from 'react';
import type { AnalyticsMetadata, AnalyticsResult } from '../../types/analytics';
import { AnalyticsFilterInput, inputClass } from './AnalyticsFilters';
import { guidedMetricNames, guidedQuestions } from './guidedPresets';
import type { BuilderDraft } from './analyticsBuilder';
import { displayAnalyticsValue } from './analyticsDisplay';
import { textFor } from '../../utils/localization';

export function GuidedQuestions({ metadata, selected, onSelect, isKo }: {
  metadata: AnalyticsMetadata; selected: string | null; onSelect: (id: string) => void; isKo: boolean;
}) {
  const available = guidedQuestions(metadata);
  const current = available.find(q => q.id === selected);
  const cards = <div className="grid gap-3 sm:grid-cols-2">{available.map(q => <button key={q.id} type="button" aria-pressed={selected === q.id}
      onClick={() => onSelect(q.id)} className={`min-w-0 rounded border p-4 text-left ${selected === q.id ? 'border-primary-400 bg-primary-500/10' : 'border-dark-700 bg-dark-900 hover:border-primary-400'}`}>
      <span className="block font-medium">{q.title[isKo ? 0 : 1]}</span><span className="mt-2 block text-sm text-dark-300">{q.description[isKo ? 0 : 1]}</span>
    </button>)}</div>;
  return <section className="space-y-4" aria-label={textFor(isKo, '분석 질문', 'Analysis questions')}>
    <h2 className="text-xl font-semibold">{current?.title[isKo ? 0 : 1] ?? textFor(isKo, '내 거래에서 무엇을 알아보고 싶나요?', 'What would you like to learn about your trading?')}</h2>
    <p className="text-sm text-dark-300">{current ? textFor(isKo, '그룹별 결과를 비교합니다. 아래에서 기간과 표시할 값을 바꿀 수 있습니다.', 'Compare the group results. Adjust the period or displayed value below.') : textFor(isKo, '질문을 선택하면 최근 90일의 종료 거래를 분석합니다. 결과에서 기간을 바꿀 수 있습니다.', 'Choose a question to analyse closed trades from the last 90 days. You can adjust the period afterwards.')}</p>
    {current ? <details key={current.id}><summary className="mb-3 cursor-pointer text-sm text-primary-300">{textFor(isKo, '다른 질문 선택 · 최근 90일로 새 분석', 'Choose another question · start fresh with 90 days')}</summary>{cards}</details> : cards}
    {!available.length && <p role="status">{textFor(isKo, '현재 분석 정의에서 지원되는 안내형 질문이 없습니다. 고급 분석에서 가능한 조합을 선택하세요.', 'No guided questions are supported by these definitions. Open Advanced analytics to choose an available combination.')}</p>}
  </section>;
}

export function GuidedFilters({ metadata, draft, update, isKo }: {
  metadata: AnalyticsMetadata; draft: BuilderDraft; update: (draft: BuilderDraft) => void; isKo: boolean;
}) {
  const [open, setOpen] = useState(false);
  const metric = metadata.metrics.find(m => m.id === draft.metric);
  const fields = metadata.filters.filter(f => metric && f.applicable_sample_units.includes(metric.sample_unit));
  const input = (field: typeof fields[number]) => <AnalyticsFilterInput key={field.id} field={field} value={draft.filters[field.id] ?? ''} applicable isKo={isKo}
    onChange={value => update({ ...draft, filters: { ...draft.filters, [field.id]: value } })} />;
  return <details className="rounded border border-dark-700 p-4" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary className="cursor-pointer">{textFor(isKo, '기간·종목 등 조건 바꾸기', 'Adjust period and filters')}</summary>
    {open && <>
    <p className="my-3 text-sm text-dark-300">{textFor(isKo, '변경 후 분석 실행을 눌러 적용하세요. 날짜는 UTC 종료 시각이며 양 끝을 포함합니다.', 'Select Run analysis after editing. Dates are inclusive UTC closing times.')}</p>
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">{fields.filter(f => f.required).map(input)}</div>
    <details className="mt-4"><summary className="cursor-pointer text-sm">{textFor(isKo, '선택 필터', 'Optional filters')}</summary>
      <div className="mt-3 grid min-w-0 gap-4 sm:grid-cols-2">{fields.filter(f => !f.required && ['strategy_ids', 'setups', 'symbols', 'directions'].includes(f.id)).map(input)}</div>
    </details>
    <details className="mt-4"><summary className="cursor-pointer text-sm">{textFor(isKo, '더 많은 필터·표시 지표', 'More filters and displayed measure')}</summary>
      <label className="mt-3 block text-sm">{textFor(isKo, '비교할 값', 'Value to compare')}<select className={`${inputClass} mt-1`} value={draft.metric} onChange={e => update({ ...draft, metric: e.target.value })}>
        {metadata.metrics.filter(m => m.sample_unit === metric?.sample_unit && m.supported_dimensions.includes(draft.dimension) && guidedMetricNames[m.id]).map(m => <option key={m.id} value={m.id}>{guidedMetricNames[m.id][isKo ? 0 : 1]}</option>)}
      </select></label>
      <div className="mt-3 grid min-w-0 gap-4 sm:grid-cols-2">{fields.filter(f => !f.required && !['strategy_ids', 'setups', 'symbols', 'directions'].includes(f.id)).map(input)}</div>
    </details>
    <button type="submit" className="mt-4 rounded bg-primary-500 px-4 py-2 text-sm text-white">{textFor(isKo, '분석 실행', 'Run analysis')}</button>
    </>}
  </details>;
}

export function GuidedAnswer({ data, isKo }: { data: AnalyticsResult; isKo: boolean }) {
  const ruleMetric = data.metric.sample_unit === 'trade_rule';
  const measure = guidedMetricNames[data.metric.id]?.[isKo ? 0 : 1] ?? data.metric.label;
  const noValues = !data.groups.some(g => g.value !== null);
  const missingGroups = ['UNASSIGNED', 'UNRECORDED', 'INVALID', 'NO_RULES'];
  const needsContext = data.groups.length > 0 && data.groups.every(g => missingGroups.includes(g.identity.state));
  const stateLabels: Record<string, string> = isKo
    ? { UNASSIGNED: '전략 미지정', UNRECORDED: '미기록', INVALID: '유효하지 않은 기록', NO_RULES: '규칙 없음', NOT_EVALUABLE: '판정 불가', FOLLOWED: '준수', VIOLATED: '위반', Long: '롱', Short: '숏' }
    : { UNASSIGNED: 'Unassigned', UNRECORDED: 'Unrecorded', INVALID: 'Invalid historical record', NO_RULES: 'No rules' };
  const nameOf = (label: string) => data.dimension.id === 'weekday' && /^[0-6]$/.test(label)
    ? (isKo ? ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'] : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])[Number(label)]
    : stateLabels[label] ?? label;
  const comparison = data.groups.filter(g => !missingGroups.includes(g.identity.state) && g.value !== null).slice(0, 2);
  const unit = data.metric.unit === 'percent' ? '%' : ` ${data.metric.unit}`;
  return <section aria-label={textFor(isKo, '결과 요약', 'Answer summary')} className="min-w-0 space-y-4 rounded border border-primary-500/40 bg-dark-900 p-4 sm:p-6">
    <h2 className="text-xl font-semibold">{textFor(isKo, '이 기간의 기록에서 확인한 결과', 'What the records showed in this period')}</h2>
    {!!comparison.length && <p className="[overflow-wrap:anywhere]">{textFor(isKo, '이 표본에서 ', 'Within this sample, ')}{comparison.map(g => `${nameOf(g.identity.label)}: ${measure} ${displayAnalyticsValue(g.value)}${unit}`).join(' / ')}{textFor(isKo, '로 관찰됐습니다.', ' was observed.')}</p>}
    <p>{textFor(isKo, `종료 거래 ${data.selected_trade_count}건을 선택했습니다. 그룹별 결과와 판정 가능한 표본 수를 함께 확인하세요.`, `${data.selected_trade_count} closed trades selected. Read each group’s result alongside its evaluable sample.`)}</p>
    <p className="text-xs text-dark-400">{textFor(isKo, '조회한 종료 시각 범위', 'Queried closing-time range')}: {['start_time', 'end_time'].map(key => typeof data.filters[key] === 'number' ? new Date(data.filters[key] as number).toISOString().replace('T', ' ').replace('Z', '') : '—').join(' → ')} · {data.timezone}</p>
    <p className="text-sm text-dark-300">{textFor(isKo, '과거 표본에서 관찰된 연관성입니다. 원인이나 미래 성과를 증명하지 않습니다.', 'Observed historical association within this sample, not evidence of cause or future performance.')}</p>
    {data.metric.id === 'average_return_pct' && <p className="text-sm text-dark-300">{textFor(isKo, '거래별 투자 증거금 대비 순수익률의 단순 평균입니다. 누적·복리 수익률이 아니며, 값을 구할 수 없는 거래는 평균에서 제외됩니다.', 'Arithmetic mean of per-trade net returns on invested margin, not a cumulative or compounded return. Unavailable returns are excluded from the average.')}</p>}
    {data.metric.id === 'adherence_pct' && <p className="text-sm">{textFor(isKo, '규칙 준수율은 판정 가능한 규칙 평가(준수 + 위반) 중 준수 비율입니다. 판정 불가는 분모와 위반 수에 포함하지 않습니다.', 'Adherence is the share of evaluable rule evaluations that were FOLLOWED: FOLLOWED / (FOLLOWED + VIOLATED). NOT_EVALUABLE is neither a violation nor part of this denominator.')}</p>}
    {data.metric.id === 'coverage_pct' && <p className="text-sm">{textFor(isKo, '규칙 판정 범위는 전체 규칙 평가 중 판정 가능(준수 + 위반) 비율입니다. 준수율과 별개이며 판정 불가도 전체 수에 포함합니다.', 'Coverage is the share of all rule evaluations that were evaluable (FOLLOWED + VIOLATED). It includes NOT_EVALUABLE in the total and is separate from adherence.')}</p>}
    {(noValues || needsContext) && <div role="status" className="rounded bg-dark-950 p-3 text-sm">
      <p>{textFor(isKo, '현재 기록만으로 의미 있는 비교를 하기 어렵습니다.', 'These records do not yet support a meaningful comparison.')}</p>
      <p>{data.selected_trade_count === 0 ? textFor(isKo, '기간과 필터를 넓히거나 매매일지에서 종료 거래를 동기화하세요.', 'Widen the period or filters, or sync closed trades in Journal.')
        : ruleMetric ? textFor(isKo, '거래에 전략 버전과 규칙이 연결되어 있는지, 필요한 계획·관찰 기록이 있는지 확인하세요. 판정 불가는 위반이 아닙니다.', 'Check assigned strategy versions, rules and required Plan or observation records. Unavailable evaluations are not violations.')
          : textFor(isKo, '저널에서 해당 분류 기록(전략 버전·진입 유형·심리 등)과 손익·증거금 기록을 확인하세요. 아래 미지정·누락 표본을 확인할 수 있습니다.', 'Check the relevant Journal grouping records (strategy version, setup or psychology) and profit/margin data. Missing groups and samples remain visible below.')}</p>
    </div>}
    {data.dimension.multi_membership && <p className="text-sm text-amber-300">{textFor(isKo, '한 거래가 여러 그룹에 포함될 수 있습니다. 그룹의 거래 수를 합산하지 마세요.', 'A trade may appear in several groups. Do not add group trade counts together.')}</p>}
    {data.groups.length > 6 && <p className="text-sm">{textFor(isKo, `전체 ${data.groups.length}개 중 서버 순서의 첫 6개 그룹을 표시합니다. 성과 순위가 아닙니다. 전체 결과는 아래 상세 표에서 확인하세요.`, `Showing the first 6 of ${data.groups.length} groups in server order, not a performance ranking. Inspect the table below for all results.`)}</p>}
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">{data.groups.slice(0, 6).map(g => {
      const name = nameOf(g.identity.label);
      const value = displayAnalyticsValue(g.value);
      return <article key={g.identity.key} className="min-w-0 space-y-2 rounded bg-dark-950 p-4 [overflow-wrap:anywhere]">
        <h3 className="font-medium">{name}</h3>
        <p className="text-sm">{textFor(isKo, `이 표본에서 ${measure}`, `In this sample, ${measure}`)}</p>
        <p className="text-xl tabular-nums">{value === 'Unavailable' ? textFor(isKo, '값을 구할 수 없음', 'Unavailable') : `${value}${data.metric.unit === 'percent' ? '%' : ` ${data.metric.unit}`}`}</p>
        <p className="text-sm text-dark-300">{textFor(isKo, `거래 ${g.trade_sample}건 · 판정 가능 ${g.evaluable_sample}/${g.total_sample}${ruleMetric ? '건 규칙 평가' : '건 거래'} · 값 없음 ${g.unavailable_sample}건`, `${g.trade_sample} trades · ${g.evaluable_sample}/${g.total_sample} evaluable ${ruleMetric ? 'rule evaluations' : 'trades'} · ${g.unavailable_sample} unavailable`)}</p>
        {g.trade_sample > 0 && g.trade_sample < 20 && <p className="text-sm text-amber-300">{textFor(isKo, '작은 표본 — 20건 미만입니다. 주의해서 해석하세요. 통계 검정은 아닙니다.', 'Small sample — fewer than 20 trades. Interpret cautiously; this is not a statistical test.')}</p>}
        {g.value === null && <p className="text-sm">{textFor(isKo, '값 없음은 0이나 위반을 뜻하지 않습니다. 상세 근거에서 누락 이유를 확인하세요.', 'Unavailable does not mean zero or a violation. Inspect the detailed evidence for missing inputs.')}</p>}
      </article>;
    })}</div>
    {ruleMetric && <details className="text-sm text-dark-300"><summary className="cursor-pointer">{textFor(isKo, '판정 범위와 준수율의 차이', 'Coverage versus adherence')}</summary>
      <p>{textFor(isKo, '규칙 판정 범위는 전체 규칙 중 판정할 정보가 있는 비율이고, 준수율은 그중 준수한 비율입니다. 거래마다 규칙 수가 달라 거래 수와 규칙 평가 수는 다를 수 있습니다. 더 많은 필터·표시 지표에서 각각 조회할 수 있습니다.', 'Coverage describes how many rules had enough information to evaluate; adherence describes how many evaluable rules were followed. Trades may have multiple rules. Query each separately under More filters and displayed measure.')}</p>
    </details>}
    <details className="text-sm text-dark-300"><summary className="cursor-pointer">{textFor(isKo, '근거·주의사항', 'Evidence and caveats')}</summary>
      <p>{textFor(isKo, '숫자는 소수 둘째 자리까지 반올림해 표시합니다. 계산·판정에는 원래 값을 사용합니다.', 'Numbers are displayed rounded to two decimals. Calculations and evaluations use the original values.')}</p>
      <p>{data.evidence_semantics} · {data.time_basis} · {data.timezone}</p>
      <p>{data.evaluation_basis}</p>
      {data.warnings.map(w => <p key={w}>{w}</p>)}
    </details>
  </section>;
}
