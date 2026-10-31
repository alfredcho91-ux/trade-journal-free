import type { EditorSubmissionAuthority } from '../../hooks/useEditorAuthority';
import type { RuleEngineMetadata, StrategyCreateInput } from '../../types';
import type { StrategyCandidate } from '../../types/strategyDiscovery';
import { NewStrategyDrawer } from '../playbook/PlaybookDialogs';

export default function CandidateAdoptionDialog({ candidate, metadata, metadataLoading, metadataError, pending, error, isKo, onDirtyChange, onClose, onSubmit }: {
  candidate: StrategyCandidate; metadata?: RuleEngineMetadata; metadataLoading: boolean; metadataError: string | null;
  pending: boolean; error: string | null; isKo: boolean; onDirtyChange: (dirty: boolean) => void; onClose: () => void;
  onSubmit: (payload: StrategyCreateInput, authority: EditorSubmissionAuthority) => void;
}) {
  return <NewStrategyDrawer key={candidate.id} metadata={metadata} metadataLoading={metadataLoading} metadataError={metadataError}
    pending={pending} error={error} isKo={isKo} onDirtyChange={onDirtyChange} onClose={onClose} onSubmit={onSubmit} lockWhilePending
    initialPayload={{ name: candidate.name, description: isKo ? '기록된 거래에서 발견한 전략 후보입니다. 리스크·청산 규칙은 직접 검토해야 합니다.' : 'Candidate from recorded trades. Review risk and exit rules before use.',
      initial_version: { version_label: 'v1', description: isKo ? '전략 발견에서 검토 후 등록' : 'Reviewed and registered from Strategy Discovery', rules: candidate.rules } }}
    title={isKo ? '전략 후보 검토·등록' : 'Review and register candidate'}
    subtitle={isKo ? '등록하면 첫 버전이 활성 버전이 됩니다. 규칙을 수정하면 원래 후보의 검증 결과가 적용되지 않습니다. 리스크·청산 규칙은 자동 생성되지 않았습니다.' : 'Registration creates the active first version. Changed rules do not inherit the original evidence. Risk and exit rules were not generated.'}
    submitLabel={isKo ? 'Playbook에 등록' : 'Register in Playbook'} />;
}
