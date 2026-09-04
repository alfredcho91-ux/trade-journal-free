import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, HelpCircle, Loader2, RefreshCw, XCircle } from 'lucide-react';

import { getJournalStrategyEvaluation } from '../../api/journal';
import type {
  JournalStrategyEvaluation,
  RuleEvaluationCategory,
  RuleEvaluationResult,
  RuleEvaluationSummary,
  RuleNotEvaluableReason,
} from '../../types';
import { errorMessage } from '../playbook/strategyDraft';
import { journalQueryKeys } from './journalQueryKeys';

const CATEGORIES: RuleEvaluationCategory[] = ['ENTRY', 'RISK', 'EXIT'];

function percentage(value: string | null, isKo: boolean) {
  return value == null ? (isKo ? '사용 불가' : 'Unavailable') : `${value}%`;
}

function factValue(value: unknown) {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value == null) return '-';
  return String(value);
}

function lifecycle(evaluation: JournalStrategyEvaluation, isKo: boolean) {
  if (evaluation.strategy_version.retired_at) return isKo ? '은퇴' : 'RETIRED';
  return evaluation.strategy_version.is_active ? (isKo ? '활성' : 'ACTIVE') : (isKo ? '비활성' : 'INACTIVE');
}

function reasonLabel(reason: RuleNotEvaluableReason | null, isKo: boolean) {
  const labels: Record<RuleNotEvaluableReason, [string, string]> = {
    NO_EVALUATOR: ['자동 평가 불가', 'Not automatically evaluable'],
    MISSING_METRIC: ['필요한 지표 없음', 'Required metric missing'],
    MISSING_PLAN: ['적격 계획 없음', 'Eligible plan missing'],
    PLAN_NOT_EFFECTIVE_AT_ENTRY: ['진입 전 유효한 계획 없음', 'No plan effective before entry'],
    INVALID_PLAN: ['계획 값이 유효하지 않음', 'Plan values are invalid'],
    TRADE_NOT_CLOSED: ['거래 종료 후 평가 가능', 'Available after the trade closes'],
    LEGACY_DATA_UNAVAILABLE: ['기존 기록에서 값 확인 불가', 'Value unavailable in legacy record'],
    UNSUPPORTED_SOURCE: ['지원하지 않는 데이터 출처', 'Unsupported data source'],
    MARKET_DATA_UNAVAILABLE: ['시장 데이터 없음', 'Market data unavailable'],
    INCOMPLETE_MARKET_PATH: ['시장 경로 데이터 불완전', 'Market path is incomplete'],
    INVALID_HISTORICAL_DATA: ['기존 기록 값이 유효하지 않음', 'Historical value is invalid'],
    RULE_SCHEMA_UNSUPPORTED: ['지원하지 않는 규칙 형식', 'Rule schema is unsupported'],
  };
  if (!reason) return isKo ? '현재 평가 불가' : 'Not evaluable now';
  return labels[reason][isKo ? 0 : 1];
}

function SummaryMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="border border-dark-700 bg-dark-950/45 px-3 py-2.5">
    <div className="text-[10px] uppercase tracking-wide text-dark-500">{label}</div>
    <div className="mt-1 font-mono text-lg font-semibold text-white">{value}</div>
    <div className="mt-0.5 text-[10px] text-dark-500">{detail}</div>
  </div>;
}

function CategorySummary({ summary, isKo }: { summary: RuleEvaluationSummary; isKo: boolean }) {
  return <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-dark-500">
    <span>{isKo ? '준수' : 'Followed'} {summary.followed_rules}</span>
    <span>{isKo ? '위반' : 'Violated'} {summary.violated_rules}</span>
    <span>{isKo ? '평가 불가' : 'Not evaluable'} {summary.not_evaluable_rules}</span>
    <span>{isKo ? '준수율' : 'Adherence'} {percentage(summary.adherence_pct, isKo)}</span>
    <span>{isKo ? '커버리지' : 'Coverage'} {percentage(summary.coverage_pct, isKo)}</span>
  </div>;
}

function RuleRow({ rule, isKo }: { rule: RuleEvaluationResult; isKo: boolean }) {
  const status = rule.status === 'FOLLOWED'
    ? { icon: CheckCircle2, label: isKo ? '준수' : 'FOLLOWED', style: 'border-bull/35 bg-bull/5 text-bull' }
    : rule.status === 'VIOLATED'
      ? { icon: XCircle, label: isKo ? '위반' : 'VIOLATED', style: 'border-bear/35 bg-bear/5 text-bear' }
      : { icon: HelpCircle, label: isKo ? '평가 불가' : 'NOT EVALUABLE', style: 'border-dark-600 bg-dark-900/50 text-dark-400' };
  const StatusIcon = status.icon;
  return <li className={`border px-3 py-3 ${status.style}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs font-medium text-dark-100">{rule.text}</div>
        <div className="mt-1 text-[10px] leading-4 text-dark-400">{rule.explanation.message}</div>
      </div>
      <span className="flex shrink-0 items-center gap-1 text-[9px] font-semibold"><StatusIcon className="h-3.5 w-3.5" />{status.label}</span>
    </div>
    {rule.status === 'NOT_EVALUABLE' ? <div className="mt-2 text-[10px] text-dark-500">{reasonLabel(rule.reason_code, isKo)}</div> : rule.condition && <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-current/15 pt-2 text-[10px] text-dark-500">
      <span>{isKo ? '조건' : 'Condition'}: {rule.condition.metric_id} {rule.condition.operator} {factValue(rule.condition.expected)} {rule.condition.unit}</span>
      <span>{isKo ? '관측' : 'Observed'}: {factValue(rule.observation.value)} {rule.observation.unit}</span>
      {rule.observation.source && <span>{isKo ? '출처' : 'Source'}: {rule.observation.source}{rule.observation.record_id != null ? ` #${rule.observation.record_id}` : ''}</span>}
    </div>}
  </li>;
}

export default function RuleAdherencePanel({ entryId, isKo }: { entryId: number; isKo: boolean }) {
  const evaluationQuery = useQuery({
    queryKey: journalQueryKeys.strategyEvaluation(entryId),
    queryFn: () => getJournalStrategyEvaluation(entryId),
    retry: false,
  });

  return <section className="border border-dark-700 bg-dark-900/30" aria-label={isKo ? '규칙 준수' : 'Rule Adherence'}>
    <div className="border-b border-dark-700 px-3 py-2.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-dark-300">{isKo ? '규칙 준수' : 'Rule Adherence'}</h3>
      <p className="mt-0.5 text-[10px] text-dark-600">{isKo ? '현재 저장된 기록을 기준으로 재구성' : 'Based on current saved records'}</p>
    </div>
    <div className="px-3 py-3">
      {evaluationQuery.isPending ? <div className="flex items-center gap-2 py-3 text-xs text-dark-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />{isKo ? '규칙 평가 불러오는 중' : 'Loading rule evaluation'}</div>
        : evaluationQuery.isError ? <div role="alert" className="flex items-start justify-between gap-3 border border-bear/35 bg-bear/10 px-3 py-2"><span className="text-xs text-bear">{errorMessage(evaluationQuery.error, isKo ? '규칙 평가를 불러오지 못했습니다.' : 'Could not load rule adherence.')}</span><button type="button" onClick={() => evaluationQuery.refetch()} className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-bear underline"><RefreshCw className="h-3 w-3" />{isKo ? '다시 시도' : 'Retry'}</button></div>
          : evaluationQuery.data == null ? <div className="border border-dark-700 bg-dark-950/35 px-3 py-3"><div className="text-sm font-medium text-dark-300">{isKo ? '할당된 전략 버전 없음' : 'No Strategy Version assigned'}</div><p className="mt-1 text-[10px] leading-4 text-dark-600">{isKo ? '전략을 명시적으로 할당하면 저장된 기록으로 규칙을 평가합니다.' : 'Assign a Strategy Version explicitly to evaluate its rules against saved records.'}</p></div>
            : <EvaluationContent evaluation={evaluationQuery.data} isKo={isKo} />}
    </div>
  </section>;
}

function EvaluationContent({ evaluation, isKo }: { evaluation: JournalStrategyEvaluation; isKo: boolean }) {
  const state = lifecycle(evaluation, isKo);
  return <div className="space-y-4">
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-white">{evaluation.strategy.name}</span>
        <span className="font-mono text-xs text-primary-200">{evaluation.strategy_version.version_label}</span>
        <span className="border border-dark-600 px-1.5 py-0.5 text-[9px] font-semibold text-dark-400">{state}</span>
        {evaluation.strategy.archived_at && <span className="border border-dark-600 px-1.5 py-0.5 text-[9px] font-semibold text-dark-400">{isKo ? '보관된 전략' : 'ARCHIVED STRATEGY'}</span>}
      </div>
      <p className="mt-1 text-[10px] text-dark-600">{isKo ? '할당된 버전' : 'Assigned version'} #{evaluation.strategy_version.sequence} · {isKo ? '현재 저장 기록 기준' : 'CURRENT RECONSTRUCTED'}</p>
    </div>

    <div className="grid grid-cols-2 gap-2">
      <SummaryMetric label={isKo ? '준수율' : 'Adherence'} value={percentage(evaluation.summary.overall.adherence_pct, isKo)} detail={`${evaluation.summary.overall.followed_rules}/${evaluation.summary.overall.evaluable_rules} ${isKo ? '평가 가능 규칙 준수' : 'evaluable rules followed'}`} />
      <SummaryMetric label={isKo ? '커버리지' : 'Coverage'} value={percentage(evaluation.summary.overall.coverage_pct, isKo)} detail={`${evaluation.summary.overall.evaluable_rules}/${evaluation.summary.overall.total_rules} ${isKo ? '규칙 평가 가능' : 'rules evaluable'}`} />
    </div>

    {CATEGORIES.map((category) => {
      const summary = evaluation.summary[category.toLowerCase() as 'entry' | 'risk' | 'exit'];
      if (summary.total_rules === 0) return null;
      const rules = evaluation.rules.filter((rule) => rule.category === category);
      return <div key={category}>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <h4 className="text-[10px] font-semibold tracking-wider text-dark-300">{category}</h4>
          <CategorySummary summary={summary} isKo={isKo} />
        </div>
        <ul className="space-y-2">{rules.map((rule) => <RuleRow key={rule.rule_id} rule={rule} isKo={isKo} />)}</ul>
      </div>;
    })}
  </div>;
}
