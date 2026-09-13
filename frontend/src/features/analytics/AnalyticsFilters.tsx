import { useQuery } from '@tanstack/react-query';
import { listStrategies, listStrategyVersions } from '../../api/strategies';
import { strategyQueryKeys } from '../playbook/strategyQueryKeys';
import type { AnalyticsFilter } from '../../types/analytics';
import { analyticsFilterDescription, analyticsLabel, textFor } from '../../utils/localization';

export const inputClass = 'w-full rounded border border-dark-600 bg-dark-950 px-3 py-2 text-sm text-dark-100 focus:border-primary-400 focus:outline-none';

function IdSuggestions({ field, onSelect, isKo }: { field: AnalyticsFilter; onSelect: (id: string) => void; isKo: boolean }) {
  const strategies = useQuery({ queryKey: strategyQueryKeys.list(true), queryFn: () => listStrategies(true) });
  const versions = useQuery({
    queryKey: ['analytics', 'version-options', strategies.data?.map(s => s.id)],
    queryFn: async () => (await Promise.all((strategies.data ?? []).map(async strategy =>
      (await listStrategyVersions(strategy.id)).map(version => ({ strategy, version }))))).flat(),
    enabled: field.option_source === 'STRATEGY_VERSIONS' && !!strategies.data,
  });
  const options = field.option_source === 'STRATEGIES'
    ? (strategies.data ?? []).map(s => ({ id: s.id, label: `${s.name} (#${s.id})${s.archived_at ? textFor(isKo, ' · 보관됨', ' · Archived') : ''}` }))
    : (versions.data ?? []).map(({ strategy: s, version: v }) => ({ id: v.id,
      label: `${s.name} / ${v.version_label} (#${v.id})${v.retired_at ? textFor(isKo, ' · 종료됨', ' · Retired') : !v.is_active ? textFor(isKo, ' · 비활성', ' · Inactive') : ''}${s.archived_at ? textFor(isKo, ' · 보관됨', ' · Archived') : ''}` }));
  return <>
    <select aria-label={textFor(isKo, `${analyticsLabel(field.label, isKo)} ID 추가`, `Add ${field.label}`)} value="" onChange={e => { if (e.target.value) onSelect(e.target.value); }} className={`${inputClass} mt-2`}>
      <option value="">{textFor(isKo, '기록된 ID 추가…', 'Add a recorded ID…')}</option>
      {options.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select>
    {(strategies.isError || versions.isError) && <p className="text-xs text-amber-300">{textFor(isKo, '선택지를 불러오지 못했습니다. 아래에 정확한 ID를 직접 입력할 수 있습니다.', 'Options unavailable. You can still enter exact IDs below.')}</p>}
  </>;
}

export function AnalyticsFilterInput({ field, value, onChange, applicable, isKo = false }: {
  field: AnalyticsFilter; value: string | string[]; onChange: (value: string | string[]) => void; applicable: boolean;
  isKo?: boolean;
}) {
  const scalar = Array.isArray(value) ? value.join(', ') : value;
  return <div className="space-y-1">
    <label className="block text-xs text-dark-300" htmlFor={`analytics-${field.id}`}>{analyticsLabel(field.label, isKo)}{field.required ? ' *' : ''}</label>
    {!applicable && <p className="text-xs text-amber-300">{textFor(isKo, '선택한 지표에는 적용할 수 없습니다. 실행하려면 이 필터를 지우세요.', 'Not applicable to the selected metric. Clear this filter to run.')}</p>}
    {field.value_type === 'enum' ? <select id={`analytics-${field.id}`} className={inputClass}
      multiple={field.input_mode === 'list'} size={field.input_mode === 'list' ? Math.min(4, field.enum_values.length) : undefined}
      value={field.input_mode === 'list' ? (Array.isArray(value) ? value : []) : scalar}
      onChange={e => onChange(field.input_mode === 'list' ? Array.from(e.target.selectedOptions, o => o.value) : e.target.value)}>
      {field.input_mode === 'scalar' && <option value="">{textFor(isKo, '기본값', 'Default')}</option>}
      {field.enum_values.map(option => <option key={option} value={option}>{option}</option>)}
    </select> : <input id={`analytics-${field.id}`} className={inputClass}
      type={field.value_type === 'timestamp_ms' ? 'datetime-local' : 'text'}
      step={field.value_type === 'timestamp_ms' ? '0.001' : undefined}
      value={scalar} onChange={e => onChange(e.target.value)}
      placeholder={field.input_mode === 'list' ? textFor(isKo, '쉼표로 구분한 값', 'Comma-separated values') : undefined} />}
    {(field.option_source === 'STRATEGIES' || field.option_source === 'STRATEGY_VERSIONS') && <IdSuggestions field={field} isKo={isKo} onSelect={id => {
      const ids = scalar.split(',').map(v => v.trim()).filter(Boolean);
      onChange([...new Set([...ids, id])].join(', '));
    }} />}
    <p className="text-[11px] text-dark-400">{analyticsFilterDescription(field.id, field.description, isKo)} {field.value_type === 'timestamp_ms' ? 'UTC' : field.null_semantics}
      {field.max_items !== null && textFor(isKo, ` 최대 ${field.max_items}개 값.`, ` Up to ${field.max_items} values.`)}</p>
    {!field.required && <button type="button" className="text-xs text-primary-300" onClick={() => onChange(field.input_mode === 'list' && field.value_type === 'enum' ? [] : '')}>{textFor(isKo, `${analyticsLabel(field.label, isKo)} 지우기`, `Clear ${field.label}`)}</button>}
  </div>;
}
