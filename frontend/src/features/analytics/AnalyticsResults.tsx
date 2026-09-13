import { useState } from 'react';
import { MiniChart } from '../../components/MiniChart';
import type { AnalyticsGroup, AnalyticsResult } from '../../types/analytics';
import { displayAnalyticsValue } from './analyticsDisplay';
import { analyticsLabel, textFor } from '../../utils/localization';

function groupName(group: AnalyticsGroup, isKo: boolean): string {
  const state = (isKo
    ? { UNASSIGNED: '미지정', UNRECORDED: '미기록', INVALID: '유효하지 않은 과거 데이터', NO_RULES: '규칙 없음' }
    : { UNASSIGNED: 'Unassigned', UNRECORDED: 'Unrecorded', INVALID: 'Invalid historical data', NO_RULES: 'No rules' })[group.identity.state];
  return state ? `${group.identity.label} · ${state}` : group.identity.label;
}
export default function AnalyticsResults({ data, isKo = false }: { data: AnalyticsResult; isKo?: boolean }) {
  const [ranked, setRanked] = useState(false);
  const [mode, setMode] = useState<'table' | 'chart'>('table');
  const groups = ranked ? [...data.groups].sort((a, b) => {
    if (a.value === null) return b.value === null ? 0 : 1;
    if (b.value === null) return -1;
    return Number(b.value) - Number(a.value);
  }) : data.groups;
  const series = ['day', 'week', 'month'].includes(data.dimension.id);
  const chronological = [...data.groups].sort((a, b) => a.identity.key.localeCompare(b.identity.key));
  const maximum = Math.max(1, ...data.groups.map(g => g.value === null ? 0 : Math.abs(Number(g.value))).filter(Number.isFinite));
  return <section aria-label={textFor(isKo, '분석 결과', 'Analysis result')} className="space-y-4 rounded border border-dark-700 bg-dark-900 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">{analyticsLabel(data.metric.label, isKo)} <span className="text-sm text-dark-400">({data.metric.unit})</span></h2>
        <p className="text-sm text-dark-300">{analyticsLabel(data.dimension.label, isKo)} · {data.selected_trade_count}{textFor(isKo, '개 선택 거래', ' selected trades')}</p></div>
      <div className="flex gap-2 text-xs"><button type="button" aria-pressed={mode === 'table'} onClick={() => setMode('table')} className="rounded border border-dark-600 px-3 py-2">{textFor(isKo, '표', 'Table')}</button>
        <button type="button" aria-pressed={mode === 'chart'} onClick={() => setMode('chart')} className="rounded border border-dark-600 px-3 py-2">{series ? textFor(isKo, '시계열', 'Time series') : textFor(isKo, '막대 비교', 'Bar comparison')}</button>
        <button type="button" aria-pressed={ranked} onClick={() => setRanked(!ranked)} className="rounded border border-dark-600 px-3 py-2">{textFor(isKo, '값순 정렬', 'Rank by value')}</button></div>
    </div>
    <p className="text-xs text-dark-400">{textFor(isKo, '과거 관찰에 따른 연관성으로, 인과관계나 미래 성과를 보장하지 않습니다.', 'Observed historical association — does not establish causation or predict future performance.')}</p>
    <p className="text-xs text-dark-400">{textFor(isKo, '종료 시각', 'Close / exit time')} · {data.timezone} · {textFor(isKo, '현재 재구성된 주석 및 배정', 'Current reconstructed annotations and assignments')}</p>
    {data.dimension.multi_membership && <p className="text-xs text-amber-300">{textFor(isKo, '그룹이 겹치므로 한 거래가 여러 번 표시될 수 있습니다. 그룹 합계를 더하면 안 됩니다.', 'Groups overlap; a trade can appear more than once. Group totals must not be added.')}</p>}
    {!data.groups.length && <p role="status">{textFor(isKo, '선택한 표본에 결과가 없습니다.', 'No results in the selected sample.')}</p>}
    {data.groups.length === 1 && <p className="text-3xl tabular-nums">{displayAnalyticsValue(data.groups[0].value)} <span className="text-sm text-dark-400">{data.groups[0].value !== null ? data.metric.unit : ''}</span></p>}
    {mode === 'chart' && series && <div aria-label={textFor(isKo, '종료 시각 시계열', 'Close-time series')} className="rounded bg-dark-950 p-3">
      <MiniChart t={chronological.map(g => g.identity.label)} v={chronological.map(g => g.value === null ? NaN : Number(g.value))} height={170} />
      <p className="text-xs text-dark-400">{textFor(isKo, 'UTC 기준 종료 시각 구간입니다. 판정 불가 구간은 선이 끊기며, 정확한 값과 날짜는 표에서 확인할 수 있습니다.', 'Ordered close-time buckets in UTC. Unavailable buckets break the line; exact values and dates are in the table.')}</p>
    </div>}
    {mode === 'chart' && !series && <div aria-label={textFor(isKo, '그룹 막대 비교', 'Grouped bar comparison')} className="max-h-80 space-y-2 overflow-y-auto">
      {groups.map(g => <div key={g.identity.key} className="grid grid-cols-[minmax(100px,1fr)_2fr_120px] items-center gap-3 text-xs">
        <span>{groupName(g, isKo)}</span><div className="h-3 bg-dark-800"><div className="h-3 bg-primary-400" style={{ width: g.value === null ? '0%' : `${Math.abs(Number(g.value)) / maximum * 100}%` }} /></div>
        <span>{displayAnalyticsValue(g.value)} {g.value !== null ? data.metric.unit : ''}</span></div>)}
      <p className="text-xs text-dark-400">{textFor(isKo, '막대 길이는 크기를 나타내며, 부호가 있는 서버 값도 함께 표시됩니다.', 'Bar length shows magnitude; signed backend values are displayed alongside.')}</p>
    </div>}
    {!!data.groups.length && <div className="max-h-[520px] overflow-auto"><table className="w-full text-left text-xs"><caption className="sr-only">{textFor(isKo, '서버 값과 표본 품질', 'Backend values and sample quality')}</caption>
      <thead className="sticky top-0 bg-dark-950 text-dark-300"><tr>{['Group', 'Value', 'Total sample', 'Evaluable', 'Unavailable', 'Evidence context'].map(h => <th key={h} className="p-2">{analyticsLabel(h, isKo)}</th>)}</tr></thead>
      <tbody>{groups.map(g => <tr key={g.identity.key} className="border-t border-dark-700 align-top">
        <td className="p-2"><div>{groupName(g, isKo)}</div><div className="text-dark-400">{g.identity.strategy_id !== null && `${textFor(isKo, '전략', 'Strategy')} #${g.identity.strategy_id} `}{g.identity.strategy_version_id !== null && `${textFor(isKo, '버전', 'Version')} #${g.identity.strategy_version_id}`}{g.identity.rule_id && ` ${g.identity.rule_category} / ${g.identity.rule_id}`}</div></td>
        <td className="p-2 tabular-nums">{displayAnalyticsValue(g.value)}{g.value !== null && ` ${data.metric.unit}`}{g.profit_factor_infinite && <div>{textFor(isKo, '손실 없음 · 비제한 비율', 'No losses · unbounded ratio')}</div>}</td>
        <td className="p-2">{g.total_sample}</td><td className="p-2">{g.evaluable_sample}</td><td className="p-2">{g.unavailable_sample}</td>
        <td className="space-y-1 p-2 text-dark-300">
          {g.total_sample === 0 ? <div>{textFor(isKo, '빈 표본', 'Empty sample')}</div> : g.trade_sample < 20 && <div className="text-amber-300">{textFor(isKo, '표본 부족 · 20건 미만 거래(표시상 주의이며 통계 검정이 아님)', 'Limited sample · fewer than 20 trades (display caution, not a statistical test)')}</div>}
          {g.total_sample > 0 && g.evaluable_sample === 0 && <div>{textFor(isKo, '판정 가능한 표본 없음', 'No evaluable samples')}</div>}
          {g.unavailable_reason && <div>{g.unavailable_reason}</div>}
          {Object.entries(g.unavailable_reasons).map(([reason, count]) => <div key={reason}>{reason}: {count}</div>)}
          <div>{g.trade_sample}{textFor(isKo, '건 거래 · ', ' trades · ')}{g.unassigned_trade_count}{textFor(isKo, '건 미지정 · ', ' unassigned · ')}{g.assigned_without_rules_count}{textFor(isKo, '건 규칙 없는 배정', ' assigned without rules')}</div>
        </td></tr>)}</tbody>
    </table></div>}
    <details className="text-xs text-dark-400"><summary className="cursor-pointer">{textFor(isKo, '정의 및 근거 메모', 'Definition & evidence notes')}</summary>
      <p className="mt-2">{data.metric.aggregation}</p><p>{data.metric.availability}</p><p>{data.dimension.semantics}</p>
      <p>{data.excluded_unavailable_close_count}{textFor(isKo, '건 종료 시각을 알 수 없는 포지션을 제외했습니다.', ' closed positions excluded for unavailable close time.')}</p>
      {data.warnings.map(w => <p key={w} className="mt-1">{w}</p>)}
    </details>
  </section>;
}
