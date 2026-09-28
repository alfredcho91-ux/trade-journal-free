import type { RuleEngineMetadata, StrategyRuleV2 } from '../../types';
import { ruleSentence } from './rulePresentation';

export default function RuleDescription({ rule, metadata, isKo }: { rule: StrategyRuleV2; metadata?: RuleEngineMetadata; isKo: boolean }) {
  return <div className="min-w-0 space-y-1 break-words">
    <p>{rule.text}</p>
    {rule.evaluation ? <>
      <p className="text-primary-200">{ruleSentence(rule.evaluation, metadata, isKo)}</p>
      <p className="text-[10px] text-dark-400">{isKo ? '자동 판정 조건 · 기록이 부족하면 판정 불가이며 위반으로 처리하지 않습니다.' : 'Automatically evaluated condition · missing evidence is not evaluable, not a violation.'}</p>
    </> : <p className="text-[10px] text-dark-400">{isKo ? '기록용 규칙 · 자동으로 판정하지 않습니다.' : 'Text-only rule · not automatically evaluated.'}</p>}
    <details className="min-w-0 pt-1">
      <summary className="cursor-pointer py-1 text-[11px] text-dark-300">{isKo ? '정확한 규칙 정의' : 'Exact rule definition'}</summary>
      <pre className="mt-2 max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-all text-[10px]">{JSON.stringify(rule, null, 2)}</pre>
    </details>
  </div>;
}
