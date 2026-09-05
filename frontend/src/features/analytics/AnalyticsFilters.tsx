import { useQuery } from '@tanstack/react-query';
import { listStrategies, listStrategyVersions } from '../../api/strategies';
import { strategyQueryKeys } from '../playbook/strategyQueryKeys';
import type { AnalyticsFilter } from '../../types/analytics';

export const inputClass = 'w-full rounded border border-dark-600 bg-dark-950 px-3 py-2 text-sm text-dark-100 focus:border-primary-400 focus:outline-none';

function IdSuggestions({ field, onSelect }: { field: AnalyticsFilter; onSelect: (id: string) => void }) {
  const strategies = useQuery({ queryKey: strategyQueryKeys.list(true), queryFn: () => listStrategies(true) });
  const versions = useQuery({
    queryKey: ['analytics', 'version-options', strategies.data?.map(s => s.id)],
    queryFn: async () => (await Promise.all((strategies.data ?? []).map(async strategy =>
      (await listStrategyVersions(strategy.id)).map(version => ({ strategy, version }))))).flat(),
    enabled: field.option_source === 'STRATEGY_VERSIONS' && !!strategies.data,
  });
  const options = field.option_source === 'STRATEGIES'
    ? (strategies.data ?? []).map(s => ({ id: s.id, label: `${s.name} (#${s.id})${s.archived_at ? ' · Archived' : ''}` }))
    : (versions.data ?? []).map(({ strategy: s, version: v }) => ({ id: v.id,
      label: `${s.name} / ${v.version_label} (#${v.id})${v.retired_at ? ' · Retired' : !v.is_active ? ' · Inactive' : ''}${s.archived_at ? ' · Archived' : ''}` }));
  return <>
    <select aria-label={`Add ${field.label}`} value="" onChange={e => { if (e.target.value) onSelect(e.target.value); }} className={`${inputClass} mt-2`}>
      <option value="">Add a recorded ID…</option>
      {options.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select>
    {(strategies.isError || versions.isError) && <p className="text-xs text-amber-300">Options unavailable. You can still enter exact IDs below.</p>}
  </>;
}

export function AnalyticsFilterInput({ field, value, onChange, applicable }: {
  field: AnalyticsFilter; value: string | string[]; onChange: (value: string | string[]) => void; applicable: boolean;
}) {
  const scalar = Array.isArray(value) ? value.join(', ') : value;
  return <div className="space-y-1">
    <label className="block text-xs text-dark-300" htmlFor={`analytics-${field.id}`}>{field.label}{field.required ? ' *' : ''}</label>
    {!applicable && <p className="text-xs text-amber-300">Not applicable to the selected metric. Clear this filter to run.</p>}
    {field.value_type === 'enum' ? <select id={`analytics-${field.id}`} className={inputClass}
      multiple={field.input_mode === 'list'} size={field.input_mode === 'list' ? Math.min(4, field.enum_values.length) : undefined}
      value={field.input_mode === 'list' ? (Array.isArray(value) ? value : []) : scalar}
      onChange={e => onChange(field.input_mode === 'list' ? Array.from(e.target.selectedOptions, o => o.value) : e.target.value)}>
      {field.input_mode === 'scalar' && <option value="">Default</option>}
      {field.enum_values.map(option => <option key={option} value={option}>{option}</option>)}
    </select> : <input id={`analytics-${field.id}`} className={inputClass}
      type={field.value_type === 'timestamp_ms' ? 'datetime-local' : 'text'}
      step={field.value_type === 'timestamp_ms' ? '0.001' : undefined}
      value={scalar} onChange={e => onChange(e.target.value)}
      placeholder={field.input_mode === 'list' ? 'Comma-separated values' : undefined} />}
    {(field.option_source === 'STRATEGIES' || field.option_source === 'STRATEGY_VERSIONS') && <IdSuggestions field={field} onSelect={id => {
      const ids = scalar.split(',').map(v => v.trim()).filter(Boolean);
      onChange([...new Set([...ids, id])].join(', '));
    }} />}
    <p className="text-[11px] text-dark-400">{field.description} {field.value_type === 'timestamp_ms' ? 'UTC' : field.null_semantics}
      {field.max_items !== null && ` Up to ${field.max_items} values.`}</p>
    {!field.required && <button type="button" className="text-xs text-primary-300" onClick={() => onChange(field.input_mode === 'list' && field.value_type === 'enum' ? [] : '')}>Clear {field.label}</button>}
  </div>;
}
