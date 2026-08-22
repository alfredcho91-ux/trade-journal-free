import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';

import {
  compareJournalBehavior,
  createJournalBehaviorRule,
  deleteJournalBehaviorRule,
  updateJournalBehaviorRule,
} from '../../api/journal';
import { journalQueryKeys } from '../journal/journalQueryKeys';
import type {
  JournalBehaviorAnalysisData,
  JournalBehaviorCondition,
  JournalBehaviorRuleType,
  JournalBehaviorStats,
} from '../../types';

function number(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '-' : value.toLocaleString(undefined, { maximumFractionDigits: digits });
}
function signed(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '-' : `${value >= 0 ? '+' : ''}${number(value, digits)}`;
}

function tone(value: number | null | undefined): string {
  return (value || 0) >= 0 ? 'text-bull' : 'text-bear';
}

function magnitude(value: number | null | undefined, prefix: '+' | '-'): string {
  return value == null || !Number.isFinite(value) ? '-' : `${prefix}${number(Math.abs(value))}`;
}

function planStatus(item: JournalBehaviorAnalysisData['items'][number], isKo: boolean): string {
  if (item.plan.planned_stop_pct == null && item.plan.planned_target_pct == null) return isKo ? '진입 근거만 기록' : 'Entry rationale only';
  const parts = [];
  if (item.plan.stop_status === 'overrun') parts.push(isKo ? '계획 손절률 초과' : 'Stop exceeded');
  if (item.plan.stop_status === 'touched_not_executed') parts.push(isKo ? '계획 손절선 도달 후 미청산' : 'Stop touched but not executed');
  if (item.plan.target_status === 'met') parts.push(isKo ? '계획 목표 달성' : 'Target met');
  if (item.plan.target_status === 'gave_back_after_hit') parts.push(isKo ? '목표 도달 후 반납' : 'Target gave back');
  if (item.plan.target_status === 'closed_before_target') parts.push(isKo ? '목표 전 청산' : 'Closed before target');
  return parts.join(' · ') || (isKo ? '계획 범위 안에서 종료' : 'Closed within plan');
}

function ruleStatusLabel(status: string, isKo: boolean): string {
  if (status === 'compliant') return isKo ? '규칙 준수' : 'Compliant';
  if (status === 'violation') return isKo ? '규칙 위반' : 'Violation';
  if (status === 'unknown') return isKo ? '판정 불가' : 'Unknown';
  return isKo ? '규칙 미설정' : 'No rules';
}

function StatsLine({ stats, isKo, minimumSample }: { stats: JournalBehaviorStats; isKo: boolean; minimumSample?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
      <span className="text-dark-400">{isKo ? '거래' : 'Trades'} <b className="ml-1 font-mono text-dark-100">{stats.trade_count}</b>{minimumSample != null && stats.trade_count < minimumSample && <small className="ml-1 text-amber-300">{isKo ? '표본 부족' : 'Low sample'}</small>}</span>
      <span className="text-dark-400">{isKo ? '승률' : 'Win'} <b className="ml-1 font-mono text-dark-100">{number(stats.win_rate_pct, 1)}%</b></span>
      <span className="text-dark-400">{isKo ? '평균 R' : 'Avg R'} <b className={`ml-1 font-mono ${tone(stats.average_r)}`}>{stats.r_sample_count ? signed(stats.average_r) : (isKo ? '기록 없음' : 'Not recorded')}</b></span>
      <span className="text-dark-400">PF <b className="ml-1 font-mono text-dark-100">{number(stats.profit_factor)}</b></span>
      <span className="text-dark-400">PnL <b className={`ml-1 font-mono ${tone(stats.total_pnl)}`}>{signed(stats.total_pnl)} USDT</b></span>
      <span className="text-dark-400">{isKo ? '최대 유리' : 'Best move'} <b className="ml-1 font-mono text-bull">{magnitude(stats.average_favorable_move_pct, '+')}%</b></span>
      <span className="text-dark-400">{isKo ? '최대 불리' : 'Adverse'} <b className="ml-1 font-mono text-bear">{magnitude(stats.average_adverse_move_pct, '-')}%</b></span>
      <span className="text-dark-400">{isKo ? '최대 누적손실' : 'Max drawdown'} <b className="ml-1 font-mono text-bear">{number(stats.max_drawdown_pnl)} USDT</b></span>
    </div>
  );
}

export function BehaviorLeakSummary({
  data,
  isLoading,
  isError,
  isKo,
  onRetry,
  onSelectTrade,
}: {
  data?: JournalBehaviorAnalysisData;
  isLoading: boolean;
  isError: boolean;
  isKo: boolean;
  onRetry: () => void;
  onSelectTrade: (id: number) => void;
}) {
  const leaks = data?.biggest_leaks.slice(0, 5) || [];
  if (isLoading) return <section className="border border-dark-700 p-5 text-center text-sm text-dark-500">{isKo ? '수익 누수를 계산하는 중' : 'Calculating profit leaks'}</section>;
  if (isError || !data) return <section className="border border-amber-300/30 bg-amber-300/5 p-5 text-sm text-amber-200">{isKo ? '수익 누수 분석을 불러오지 못했습니다.' : 'Could not load profit leak analysis.'}<button type="button" onClick={onRetry} className="ml-3 border border-amber-300/40 px-2 py-1 text-xs">{isKo ? '재시도' : 'Retry'}</button></section>;
  return (
    <section className="border border-dark-700 bg-dark-900/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-white">{isKo ? '가장 큰 손실·기회비용' : 'Largest Losses and Opportunity Cost'}</h2>
          <p className="mt-1 text-[11px] text-dark-500">{isKo ? '실현 손실은 여러 원인에 나눠 반영합니다. 조기·늦은 청산의 놓친 움직임은 금액이 아닌 가격 변동률로 따로 보여줍니다.' : 'Realized losses are shared across causes. Exit opportunity is shown separately as price movement, not as realized PnL.'}</p>
        </div>
        <span className="text-[10px] text-dark-600">{isKo ? `결론 기준 최소 ${data.minimum_conclusion_sample}건` : `Minimum ${data.minimum_conclusion_sample} trades for conclusions`}</span>
      </div>
      {leaks.length === 0 ? (
        <div className="py-6 text-center text-sm text-dark-500">{isKo ? '태그나 위반 기록이 쌓이면 여기에 가장 큰 누수가 나타납니다.' : 'The largest leaks appear after tags or violations are recorded.'}</div>
      ) : (
        <div className="mt-3 divide-y divide-dark-800 border-t border-dark-800">
          {leaks.map((leak, index) => (
            <div key={leak.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm text-dark-100"><span className="mr-2 font-mono text-dark-500">{index + 1}</span>{leak.label} {!leak.conclusion_eligible && <span className="ml-1 text-[10px] text-amber-300">{isKo ? '표본 부족' : 'Low sample'}</span>}</div>
                <div className="mt-1 text-[11px] text-dark-500">{isKo ? `${leak.trade_count}건 · 평균 R ${leak.r_sample_count ? signed(leak.average_r) : '기록 없음'} · PF ${number(leak.profit_factor)}` : `${leak.trade_count} trades · Avg R ${leak.r_sample_count ? signed(leak.average_r) : 'Not recorded'} · PF ${number(leak.profit_factor)}`}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right"><div className="text-[10px] text-dark-500">{isKo ? '실현 손실 영향' : 'Realized loss impact'}</div><div className={`font-mono text-sm ${leak.loss_impact_pnl > 0 ? 'text-bear' : 'text-dark-500'}`}>{leak.loss_impact_pnl > 0 ? `-${number(leak.loss_impact_pnl)} USDT` : (isKo ? '없음' : 'None')}</div>{leak.opportunity_sample_count > 0 && <div className="mt-1 text-[10px] text-amber-300">{isKo ? `놓친 움직임 평균 +${number(leak.average_opportunity_pct)}%` : `Avg missed move +${number(leak.average_opportunity_pct)}%`}</div>}</div>
                {leak.evidence_journal_ids[0] != null && <button type="button" onClick={() => onSelectTrade(leak.evidence_journal_ids[0])} className="border border-dark-700 px-2 py-1 text-[11px] text-primary-200 hover:border-primary-400">{isKo ? '최근 거래' : 'Latest trade'}</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PlanReview({ data, isKo, onSelectTrade }: { data: JournalBehaviorAnalysisData; isKo: boolean; onSelectTrade: (id: number) => void }) {
  const items = data.items.filter((item) => item.plan.planned_stop_pct != null || item.plan.planned_target_pct != null || Boolean(item.plan.planned_entry_reason)).slice(0, 12);
  return (
    <section className="border border-dark-700 bg-dark-900/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="text-sm font-semibold text-white">{isKo ? '계획 vs 실제' : 'Plan vs Actual'}</h2><p className="mt-1 text-[11px] text-dark-500">{isKo ? `계획 기록 ${data.plan_summary.recorded_trade_count}건 · SL·TP 모두 기록 ${data.plan_summary.full_plan_trade_count}건 · 종료 후 기록 ${data.plan_summary.post_exit_record_count}건` : `${data.plan_summary.recorded_trade_count} planned · ${data.plan_summary.full_plan_trade_count} with SL and TP · ${data.plan_summary.post_exit_record_count} recorded after exit`}</p>{data.plan_summary.post_exit_record_count > 0 && <p className="mt-1 text-[10px] text-amber-300">{isKo ? '사후 기록은 회고용이며 진입 규칙 준수 통계에는 포함되지 않습니다.' : 'Post-exit notes are for review only and are excluded from entry-rule compliance.'}</p>}</div></div>
      {items.length === 0 ? <div className="py-6 text-center text-sm text-dark-500">{isKo ? '거래 리포트에서 계획 SL·TP와 Setup을 기록하면 실제 결과와 비교합니다.' : 'Record planned SL/TP and setup in a trade report to compare it with the result.'}</div> : <div className="mt-3 max-h-96 overflow-y-auto divide-y divide-dark-800 border-t border-dark-800">
        {items.map((item) => <button key={item.journal_id} type="button" onClick={() => onSelectTrade(item.journal_id)} className="flex w-full flex-wrap items-center justify-between gap-2 py-2.5 text-left hover:bg-dark-800/35"><div><div className="text-xs text-dark-100">{item.symbol} · {item.direction} <span className="ml-1 text-dark-500">{item.exit_datetime ? new Date(item.exit_datetime).toLocaleDateString() : '-'}</span>{item.plan.recording_phase === 'after_exit' && <span className="ml-2 text-amber-300">{isKo ? '사후 기록' : 'Post-exit note'}</span>}</div><div className="mt-1 text-[11px] text-dark-400">SL {number(item.plan.planned_stop_pct)}% · TP {number(item.plan.planned_target_pct)}% · RR {item.plan.planned_rr == null ? '-' : `1:${number(item.plan.planned_rr)}`}</div>{item.plan.planned_entry_reason && <div className="mt-1 max-w-xl truncate text-[11px] text-dark-500">{item.plan.planned_entry_reason}</div>}</div><div className="text-right"><div className={`text-xs ${item.plan.stop_status === 'overrun' || item.plan.stop_status === 'touched_not_executed' || item.plan.target_status === 'gave_back_after_hit' ? 'text-bear' : 'text-primary-200'}`}>{planStatus(item, isKo)}</div><div className="mt-1 font-mono text-[11px] text-dark-500">{isKo ? '가격' : 'Price'} {signed(item.plan.actual_price_return_pct)}% · {isKo ? '순손익' : 'Net'} {signed(item.realized_pnl)} USDT</div></div></button>)}
      </div>}
    </section>
  );
}

function TagPerformance({ title, note, rows, toneClass, minimumSample, isKo, onSelectTrade }: { title: string; note: string; rows: Array<{ tag: string; evidence_journal_ids: number[] } & JournalBehaviorStats>; toneClass: string; minimumSample: number; isKo: boolean; onSelectTrade: (id: number) => void }) {
  return <section className="border border-dark-700 bg-dark-900/20 p-4"><h2 className={`text-sm font-semibold ${toneClass}`}>{title}</h2><p className="mt-1 text-[10px] text-dark-500">{note}</p>{rows.length === 0 ? <div className="py-6 text-center text-sm text-dark-500">{isKo ? '기록된 태그가 없습니다.' : 'No tags recorded.'}</div> : <div className="mt-3 max-h-80 overflow-y-auto"><table className="w-full text-xs"><thead className="text-dark-500"><tr className="border-b border-dark-700"><th className="py-2 text-left">{isKo ? '태그' : 'Tag'}</th><th className="py-2 text-right">{isKo ? '거래' : 'Trades'}</th><th className="py-2 text-right">{isKo ? '승률' : 'Win'}</th><th className="py-2 text-right">{isKo ? '평균 R' : 'Avg R'}</th><th className="py-2 text-right">PnL</th><th className="py-2 text-right">PF</th></tr></thead><tbody>{rows.map((row) => <tr key={row.tag} className="border-b border-dark-800"><td className="py-2 text-dark-200">{row.evidence_journal_ids[0] == null ? row.tag : <button type="button" onClick={() => onSelectTrade(row.evidence_journal_ids[0])} className="text-left hover:text-primary-200">{row.tag}</button>}{row.trade_count < minimumSample && <span className="ml-1 text-[10px] text-amber-300">{isKo ? '표본 부족' : 'Low sample'}</span>}</td><td className="py-2 text-right font-mono">{row.trade_count}</td><td className="py-2 text-right font-mono">{number(row.win_rate_pct, 1)}%</td><td className={`py-2 text-right font-mono ${tone(row.average_r)}`}>{row.r_sample_count ? signed(row.average_r) : '-'}</td><td className={`py-2 text-right font-mono ${tone(row.total_pnl)}`}>{signed(row.total_pnl)}</td><td className="py-2 text-right font-mono">{number(row.profit_factor)}</td></tr>)}</tbody></table></div>}</section>;
}

function RuleEditor({ data, isKo }: { data: JournalBehaviorAnalysisData; isKo: boolean }) {
  const queryClient = useQueryClient();
  const [ruleType, setRuleType] = useState<JournalBehaviorRuleType>('trend_direction_forbid');
  const [ruleValue, setRuleValue] = useState('1.5');
  const [ruleName, setRuleName] = useState('');
  const [trendDirection, setTrendDirection] = useState<'up' | 'down'>('up');
  const [forbiddenDirection, setForbiddenDirection] = useState<'Long' | 'Short'>('Short');
  const invalidate = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['journal-behavior-analysis'] }), queryClient.invalidateQueries({ queryKey: journalQueryKeys.behaviorRules })]); };
  const createMutation = useMutation({ mutationFn: () => {
    const parameters: Record<string, unknown> = ruleType === 'trend_direction_forbid'
      ? { market_direction: trendDirection, forbidden_direction: forbiddenDirection }
      : ruleType === 'max_stop_pct' ? { max_stop_pct: Number(ruleValue) }
      : ruleType === 'min_rr' ? { min_rr: Number(ruleValue) }
      : {};
    const defaults: Record<JournalBehaviorRuleType, string> = { trend_direction_forbid: `${trendDirection === 'up' ? '상승' : '하락'} 정렬에서는 ${forbiddenDirection.toUpperCase()} 금지`, max_stop_pct: '최대 계획 손절률', min_rr: '최소 계획 손익비', no_scale_in: '물타기 금지' };
    return createJournalBehaviorRule({ name: ruleName.trim() || defaults[ruleType], rule_type: ruleType, parameters, is_enabled: true });
  }, onSuccess: () => { setRuleName(''); void invalidate(); } });
  const toggleMutation = useMutation({ mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => updateJournalBehaviorRule(id, { is_enabled: enabled }), onSuccess: () => void invalidate() });
  const deleteMutation = useMutation({ mutationFn: deleteJournalBehaviorRule, onSuccess: () => void invalidate() });
  const valueLabel = ruleType === 'max_stop_pct' ? (isKo ? '최대 계획 손절률 (%)' : 'Max planned stop (%)') : (isKo ? '최소 계획 손익비' : 'Minimum planned RR');
  return <section className="border border-dark-700 bg-dark-900/20 p-4"><div><h2 className="text-sm font-semibold text-white">{isKo ? '규칙 준수 분석' : 'Rule Compliance'}</h2><p className="mt-1 text-[11px] text-dark-500">{isKo ? '규칙 위반은 진입 당시 완료된 추세와 기록된 계획으로만 판정합니다. 체결 연결이 불확실한 물타기는 판정 불가로 둡니다.' : 'Checks use only completed entry-time trends and recorded plans. Scale-in stays unknown unless it is explicitly tagged.'}</p></div>
    <div className="mt-3 grid gap-2 md:grid-cols-[1.3fr,1fr,1fr,auto]"><input value={ruleName} onChange={(event) => setRuleName(event.target.value)} placeholder={isKo ? '규칙 이름 (선택)' : 'Rule name (optional)'} className="border border-dark-700 bg-dark-950 px-2.5 py-2 text-xs text-white" /><select value={ruleType} onChange={(event) => setRuleType(event.target.value as JournalBehaviorRuleType)} className="border border-dark-700 bg-dark-950 px-2.5 py-2 text-xs text-white"><option value="trend_direction_forbid">{isKo ? '정렬 추세 역방향 금지' : 'No counter-trend direction'}</option><option value="max_stop_pct">{isKo ? '최대 계획 손절률' : 'Max planned stop'}</option><option value="min_rr">{isKo ? '최소 계획 손익비' : 'Min planned RR'}</option><option value="no_scale_in">{isKo ? '물타기 금지' : 'No scale-in'}</option></select>{ruleType === 'trend_direction_forbid' ? <div className="grid grid-cols-2 gap-1"><select value={trendDirection} onChange={(event) => setTrendDirection(event.target.value as 'up' | 'down')} className="border border-dark-700 bg-dark-950 px-2 py-2 text-xs text-white"><option value="up">{isKo ? '상승 정렬' : 'Aligned up'}</option><option value="down">{isKo ? '하락 정렬' : 'Aligned down'}</option></select><select value={forbiddenDirection} onChange={(event) => setForbiddenDirection(event.target.value as 'Long' | 'Short')} className="border border-dark-700 bg-dark-950 px-2 py-2 text-xs text-white"><option value="Short">SHORT {isKo ? '금지' : 'forbid'}</option><option value="Long">LONG {isKo ? '금지' : 'forbid'}</option></select></div> : ruleType === 'no_scale_in' ? <div className="border border-dark-800 px-2.5 py-2 text-xs text-dark-500">{isKo ? '명시된 물타기 태그만 위반 처리' : 'Only explicit scale-in tags are violations'}</div> : <label className="text-[10px] text-dark-500">{valueLabel}<input type="number" min="0.1" step="0.1" value={ruleValue} onChange={(event) => setRuleValue(event.target.value)} className="mt-1 w-full border border-dark-700 bg-dark-950 px-2 py-1.5 font-mono text-xs text-white" /></label>}<button type="button" onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="inline-flex items-center justify-center gap-1 border border-primary-400/50 px-3 py-2 text-xs text-primary-100 disabled:opacity-50"><Plus className="h-3.5 w-3.5" />{isKo ? '규칙 추가' : 'Add rule'}</button></div>
    <div className="mt-4 divide-y divide-dark-800 border-y border-dark-800">{data.rules.length === 0 ? <div className="py-4 text-xs text-dark-500">{isKo ? '아직 정의한 규칙이 없습니다.' : 'No rules defined yet.'}</div> : data.rules.map((rule) => <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5"><div><div className="text-xs text-dark-100">{rule.name}</div><div className="mt-1 text-[10px] text-dark-500">{rule.rule_type}</div></div><div className="flex items-center gap-2"><button type="button" onClick={() => toggleMutation.mutate({ id: rule.id, enabled: !rule.is_enabled })} className={`border px-2 py-1 text-[10px] ${rule.is_enabled ? 'border-bull/40 text-bull' : 'border-dark-700 text-dark-500'}`}>{rule.is_enabled ? (isKo ? '사용 중' : 'Enabled') : (isKo ? '꺼짐' : 'Off')}</button><button type="button" onClick={() => deleteMutation.mutate(rule.id)} className="text-dark-500 hover:text-bear" title={isKo ? '규칙 삭제' : 'Delete rule'}><Trash2 className="h-4 w-4" /></button></div></div>)}</div>
    <div className="mt-4 grid gap-3 md:grid-cols-3">{(['compliant', 'violation', 'unknown'] as const).map((status) => <div key={status} className="border border-dark-800 bg-dark-950/40 p-3"><div className="text-xs text-dark-400">{ruleStatusLabel(status, isKo)}</div><div className="mt-1 font-mono text-lg text-white">{data.rule_status_stats[status].trade_count}{isKo ? '건' : ''}</div><div className={`mt-1 text-xs ${tone(data.rule_status_stats[status].total_pnl)}`}>{signed(data.rule_status_stats[status].total_pnl)} USDT</div></div>)}</div>
  </section>;
}

function Evaluator({ data, startTime, endTime, minimumAbsNetReturnPct, isKo, onSelectTrade }: { data: JournalBehaviorAnalysisData; startTime: number; endTime: number; minimumAbsNetReturnPct: number; isKo: boolean; onSelectTrade: (id: number) => void }) {
  const options = data.condition_options;
  const [leftKey, setLeftKey] = useState('');
  const [rightKey, setRightKey] = useState('');
  const optionByKey = useMemo(() => new Map(options.map((option) => [`${option.type}:${option.value}`, option])), [options]);
  useEffect(() => { if (!leftKey && options[0]) setLeftKey(`${options[0].type}:${options[0].value}`); if (!rightKey && options[1]) setRightKey(`${options[1].type}:${options[1].value}`); }, [leftKey, options, rightKey]);
  const left = optionByKey.get(leftKey);
  const right = optionByKey.get(rightKey);
  const compareQuery = useQuery({ queryKey: ['journal-behavior-compare', startTime, endTime, minimumAbsNetReturnPct, leftKey, rightKey], queryFn: () => compareJournalBehavior({ start_time: startTime, end_time: endTime, min_abs_net_return_pct: minimumAbsNetReturnPct, left: left as JournalBehaviorCondition, right: right as JournalBehaviorCondition }), enabled: Boolean(left && right), staleTime: 60_000 });
  const selector = (value: string, onChange: (value: string) => void) => <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full border border-dark-700 bg-dark-950 px-2.5 py-2 text-xs text-white">{options.map((option) => <option key={`${option.type}:${option.value}`} value={`${option.type}:${option.value}`}>{option.label || option.value}</option>)}</select>;
  return <section className="border border-dark-700 bg-dark-900/20 p-4"><div><h2 className="text-sm font-semibold text-white">{isKo ? '조건 비교' : 'Evaluator'}</h2><p className="mt-1 text-[11px] text-dark-500">{isKo ? '방향, 종목, Setup, 실수, 장세, 규칙 준수 중 두 조건을 같은 성과 기준으로 비교합니다.' : 'Compare two directions, symbols, setups, mistakes, regimes, or rule statuses on one metric definition.'}</p></div><div className="mt-3 grid gap-3 md:grid-cols-2"><div>{selector(leftKey, setLeftKey)}</div><div>{selector(rightKey, setRightKey)}</div></div>{compareQuery.isLoading ? <div className="py-6 text-center text-sm text-dark-500">{isKo ? '조건 성과 계산 중' : 'Comparing conditions'}</div> : compareQuery.isError ? <div className="py-5 text-center text-sm text-amber-200">{isKo ? '조건 비교를 계산하지 못했습니다.' : 'Could not compare the selected conditions.'}<button type="button" onClick={() => void compareQuery.refetch()} className="ml-3 border border-amber-300/40 px-2 py-1 text-xs">{isKo ? '재시도' : 'Retry'}</button></div> : compareQuery.data ? <div className="mt-4 grid gap-3 md:grid-cols-2">{(['left', 'right'] as const).map((side) => { const result = compareQuery.data?.[side]; return <div key={side} className="border border-dark-800 bg-dark-950/40 p-3"><div className="mb-3 text-sm font-semibold text-primary-200">{result.condition.label || result.condition.value}</div><StatsLine stats={result.stats} isKo={isKo} minimumSample={data.minimum_conclusion_sample} />{result.evidence_journal_ids[0] != null && <button type="button" onClick={() => onSelectTrade(result.evidence_journal_ids[0])} className="mt-3 text-xs text-primary-200 hover:text-primary-100">{isKo ? '최근 근거 거래 보기' : 'Open latest supporting trade'}</button>}</div>; })}</div> : <div className="py-5 text-center text-sm text-dark-500">{isKo ? '비교할 조건을 선택하세요.' : 'Choose two conditions to compare.'}</div>}</section>;
}

export default function TradeBehaviorAnalysis({ data, isLoading, isError, startTime, endTime, minimumAbsNetReturnPct, isKo, onRetry, onSelectTrade }: { data?: JournalBehaviorAnalysisData; isLoading: boolean; isError: boolean; startTime: number; endTime: number; minimumAbsNetReturnPct: number; isKo: boolean; onRetry: () => void; onSelectTrade: (id: number) => void }) {
  if (isLoading) return <section className="border border-dark-700 p-6 text-center text-sm text-dark-500">{isKo ? '매매 행동 분석을 불러오는 중' : 'Loading trade behavior analysis'}</section>;
  if (isError || !data) return <section className="border border-amber-300/30 bg-amber-300/5 p-5 text-sm text-amber-200">{isKo ? '매매 행동 분석을 불러오지 못했습니다.' : 'Could not load trade behavior analysis.'}<button type="button" onClick={onRetry} className="ml-3 border border-amber-300/40 px-2 py-1 text-xs">{isKo ? '재시도' : 'Retry'}</button></section>;
  return <div className="space-y-4"><PlanReview data={data} isKo={isKo} onSelectTrade={onSelectTrade} /><div className="grid gap-4 xl:grid-cols-2"><TagPerformance title={isKo ? '어떤 Setup이 잘 맞았나' : 'Setup Performance'} note={isKo ? '사용자가 기록한 태그의 연관성 통계입니다. 종료 후 입력된 태그는 인과관계를 증명하지 않습니다.' : 'This is an association from user-recorded tags; tags entered after exit do not prove causation.'} rows={data.setup_stats} toneClass="text-bull" minimumSample={data.minimum_conclusion_sample} isKo={isKo} onSelectTrade={onSelectTrade} /><TagPerformance title={isKo ? '어떤 실수가 손실을 만들었나' : 'Mistake Performance'} note={isKo ? '사후 복기 태그와 실제 결과의 연관성입니다. 원인을 단정하는 지표로 사용하지 마세요.' : 'This links post-trade review tags with results; it does not prove a causal cause.'} rows={data.mistake_stats} toneClass="text-bear" minimumSample={data.minimum_conclusion_sample} isKo={isKo} onSelectTrade={onSelectTrade} /></div><Evaluator data={data} startTime={startTime} endTime={endTime} minimumAbsNetReturnPct={minimumAbsNetReturnPct} isKo={isKo} onSelectTrade={onSelectTrade} /><RuleEditor data={data} isKo={isKo} /></div>;
}
