import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, BookOpen, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  deleteJournalStrategyAssignment,
  getJournalStrategyAssignment,
  putJournalStrategyAssignment,
} from '../../api/strategyAssignments';
import { listStrategies, listStrategyVersions } from '../../api/strategies';
import type { JournalStrategyAssignment, StrategyVersion } from '../../types';
import { errorMessage } from '../playbook/strategyDraft';
import { strategyQueryKeys } from '../playbook/strategyQueryKeys';
import UnsavedChangesDialog from './UnsavedChangesDialog';
import { strategyAssignmentQueryKeys } from './strategyAssignmentQueryKeys';
import { journalQueryKeys } from './journalQueryKeys';

interface Draft {
  entryId: number;
  strategyId: number | null;
  versionId: number | null;
}

interface SaveVariables {
  entryId: number;
  versionId: number;
}

function lifecycle(version: Pick<StrategyVersion, 'is_active' | 'retired_at'>) {
  if (version.retired_at) return 'RETIRED';
  return version.is_active ? 'ACTIVE' : 'INACTIVE';
}

function AssignmentLifecycleBadge({ active, retiredAt, isKo }: {
  active: boolean;
  retiredAt: string | null;
  isKo: boolean;
}) {
  const state = lifecycle({ is_active: active, retired_at: retiredAt });
  const label = isKo ? ({ ACTIVE: '활성', INACTIVE: '비활성', RETIRED: '은퇴' } as const)[state] : state;
  const style = state === 'ACTIVE'
    ? 'border-bull/40 bg-bull/10 text-bull'
    : state === 'RETIRED'
      ? 'border-dark-600 bg-dark-800 text-dark-400'
      : 'border-primary-500/30 bg-primary-500/10 text-primary-300';
  return <span className={`border px-1.5 py-0.5 text-[10px] font-semibold ${style}`}>{label}</span>;
}

function formatAssignedAt(value: string, isKo: boolean) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(isKo ? 'ko-KR' : 'en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function RemoveAssignmentDialog({ isKo, pending, error, onCancel, onConfirm }: {
  isKo: boolean;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label={isKo ? '전략 할당 제거' : 'Remove Strategy assignment'}>
    <div className="w-full max-w-md border border-dark-600 bg-dark-900 p-5 shadow-2xl">
      <h2 className="text-base font-semibold text-white">{isKo ? '이 전략 할당을 제거할까요?' : 'Remove this Strategy assignment?'}</h2>
      <p className="mt-2 text-sm leading-6 text-dark-300">{isKo ? '이 거래에서 전략 연결만 제거됩니다. 거래와 Playbook 전략은 삭제되지 않습니다.' : 'This only removes the Strategy link from this trade. The trade and Playbook Strategy will not be deleted.'}</p>
      {error && <p role="alert" className="mt-3 border border-bear/35 bg-bear/10 px-3 py-2 text-xs text-bear">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" disabled={pending} onClick={onCancel} className="border border-dark-600 px-3 py-2 text-xs text-dark-200 disabled:opacity-50">{isKo ? '취소' : 'Cancel'}</button>
        <button type="button" disabled={pending} onClick={onConfirm} className="border border-bear/60 bg-bear/15 px-3 py-2 text-xs font-semibold text-bear disabled:opacity-50">{pending ? (isKo ? '제거 중...' : 'Removing...') : (isKo ? '제거' : 'Remove')}</button>
      </div>
    </div>
  </div>;
}

export default function StrategyAssignmentEditor({ entryId, isKo, onDirtyChange, onViewPlaybook }: {
  entryId: number;
  isKo: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onViewPlaybook?: () => void;
}) {
  const queryClient = useQueryClient();
  const currentEntryId = useRef(entryId);
  currentEntryId.current = entryId;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const assignmentQuery = useQuery({
    queryKey: strategyAssignmentQueryKeys.detail(entryId),
    queryFn: () => getJournalStrategyAssignment(entryId),
    retry: false,
  });
  const assignment = assignmentQuery.data;
  const strategiesQuery = useQuery({
    queryKey: strategyQueryKeys.list(showArchived),
    queryFn: () => listStrategies(showArchived),
    enabled: editing,
    retry: false,
  });
  const selectedStrategyId = draft?.entryId === entryId ? draft.strategyId : null;
  const versionsQuery = useQuery({
    queryKey: strategyQueryKeys.versions(selectedStrategyId ?? -1),
    queryFn: () => listStrategyVersions(selectedStrategyId!),
    enabled: editing && selectedStrategyId !== null,
    retry: false,
  });
  const versions = useMemo(() => {
    if (selectedStrategyId === null || !versionsQuery.data?.every((version) => version.strategy_id === selectedStrategyId)) return [];
    const rank = (version: StrategyVersion) => version.is_active ? 0 : version.retired_at ? 2 : 1;
    return [...versionsQuery.data].sort((left, right) => rank(left) - rank(right) || right.sequence - left.sequence);
  }, [selectedStrategyId, versionsQuery.data]);
  const selectedVersionId = draft?.entryId === entryId ? draft.versionId : null;
  const dirty = editing
    && draft?.entryId === entryId
    && selectedVersionId !== (assignment?.strategy_version_id ?? null);

  useEffect(() => onDirtyChange?.(Boolean(dirty)), [dirty, onDirtyChange]);
  useEffect(() => {
    setEditing(false);
    setDraft(null);
    setShowArchived(false);
    setConfirmCancel(false);
    setConfirmRemove(false);
  }, [entryId]);
  useEffect(() => {
    if (!editing || selectedStrategyId === null || versionsQuery.isPending || versions.length === 0) return;
    if (selectedVersionId !== null && versions.some((version) => version.id === selectedVersionId)) return;
    setDraft((current) => current?.entryId === entryId && current.strategyId === selectedStrategyId
      ? { ...current, versionId: versions.find((version) => version.is_active)?.id ?? versions[0].id }
      : current);
  }, [editing, entryId, selectedStrategyId, selectedVersionId, versions, versionsQuery.isPending]);

  const saveMutation = useMutation<JournalStrategyAssignment, Error, SaveVariables>({
    mutationFn: ({ entryId: targetEntryId, versionId }) => putJournalStrategyAssignment(targetEntryId, versionId),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: strategyAssignmentQueryKeys.detail(variables.entryId) });
    },
    onSuccess: (saved, variables) => {
      queryClient.setQueryData(strategyAssignmentQueryKeys.detail(variables.entryId), saved);
      void queryClient.invalidateQueries({ queryKey: journalQueryKeys.strategyEvaluation(variables.entryId) });
      if (currentEntryId.current === variables.entryId) {
        setDraft({ entryId: variables.entryId, strategyId: saved.strategy_id, versionId: saved.strategy_version_id });
        setEditing(false);
      }
    },
  });
  const removeMutation = useMutation<null, Error, { entryId: number }>({
    mutationFn: ({ entryId: targetEntryId }) => deleteJournalStrategyAssignment(targetEntryId),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: strategyAssignmentQueryKeys.detail(variables.entryId) });
    },
    onSuccess: (_, variables) => {
      queryClient.setQueryData(strategyAssignmentQueryKeys.detail(variables.entryId), null);
      void queryClient.invalidateQueries({ queryKey: journalQueryKeys.strategyEvaluation(variables.entryId) });
      if (currentEntryId.current === variables.entryId) {
        setConfirmRemove(false);
        setDraft(null);
        setEditing(false);
      }
    },
  });
  const pending = saveMutation.isPending || removeMutation.isPending;

  const beginEdit = () => {
    saveMutation.reset();
    setShowArchived(Boolean(assignment?.strategy_archived_at));
    setDraft({
      entryId,
      strategyId: assignment?.strategy_id ?? null,
      versionId: assignment?.strategy_version_id ?? null,
    });
    setEditing(true);
  };
  const discardEdit = () => {
    setConfirmCancel(false);
    setDraft(null);
    setEditing(false);
  };

  return <>
    <section className="border border-dark-700 bg-dark-900/30" aria-label={isKo ? '전략 할당' : 'Strategy Assignment'}>
      <div className="flex items-center justify-between gap-3 border-b border-dark-700 px-3 py-2.5">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-dark-300">{isKo ? '전략' : 'Strategy'}</h3>
          <p className="mt-0.5 text-[10px] text-dark-600">{isKo ? '이 거래에 사용한 정확한 Playbook 버전' : 'Exact Playbook version used for this trade'}</p>
        </div>
        {assignment && !editing && onViewPlaybook && <button type="button" onClick={onViewPlaybook} className="inline-flex items-center gap-1 text-[10px] text-primary-300 hover:text-white"><BookOpen className="h-3 w-3" />{isKo ? 'Playbook에서 보기' : 'View in Playbook'}</button>}
      </div>

      <div className="px-3 py-3">
        {assignmentQuery.isPending ? <div className="flex items-center gap-2 text-xs text-dark-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />{isKo ? '전략 할당 불러오는 중' : 'Loading Strategy assignment'}</div>
          : assignmentQuery.isError ? <div className="flex items-start justify-between gap-3 border border-bear/35 bg-bear/10 px-3 py-2" role="alert"><span className="flex gap-1.5 text-xs text-bear"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{errorMessage(assignmentQuery.error, isKo ? '전략 할당을 불러오지 못했습니다.' : 'Could not load the Strategy assignment.')}</span><button type="button" onClick={() => assignmentQuery.refetch()} className="shrink-0 text-[10px] font-semibold text-bear underline">{isKo ? '다시 시도' : 'Retry'}</button></div>
            : editing ? <div className="space-y-3">
              <label className="block text-[10px] font-medium text-dark-400">{isKo ? '전략' : 'Strategy'}
                <select aria-label={isKo ? '전략 선택' : 'Select strategy'} disabled={pending || strategiesQuery.isPending} value={selectedStrategyId ?? ''} onChange={(event) => {
                  const strategyId = event.target.value ? Number(event.target.value) : null;
                  saveMutation.reset();
                  setDraft({ entryId, strategyId, versionId: null });
                }} className="mt-1.5 w-full border border-dark-600 bg-dark-950 px-2.5 py-2 text-xs text-white outline-none focus:border-primary-400 disabled:opacity-50">
                  <option value="">{strategiesQuery.isPending ? (isKo ? '불러오는 중...' : 'Loading...') : (isKo ? '전략 선택' : 'Select strategy')}</option>
                  {(strategiesQuery.data ?? []).map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.name}{strategy.archived_at ? ` · ${isKo ? '보관됨' : 'ARCHIVED'}` : ''}</option>)}
                </select>
              </label>
              <label className="block text-[10px] font-medium text-dark-400">{isKo ? '버전' : 'Version'}
                <select aria-label={isKo ? '버전 선택' : 'Select version'} disabled={pending || selectedStrategyId === null || versionsQuery.isPending} value={selectedVersionId ?? ''} onChange={(event) => {
                  saveMutation.reset();
                  setDraft((current) => current?.entryId === entryId ? { ...current, versionId: event.target.value ? Number(event.target.value) : null } : current);
                }} className="mt-1.5 w-full border border-dark-600 bg-dark-950 px-2.5 py-2 text-xs text-white outline-none focus:border-primary-400 disabled:opacity-50">
                  <option value="">{versionsQuery.isPending && selectedStrategyId !== null ? (isKo ? '불러오는 중...' : 'Loading...') : (isKo ? '버전 선택' : 'Select version')}</option>
                  {versions.map((version) => <option key={version.id} value={version.id}>{version.version_label} · {lifecycle(version)}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-[10px] text-dark-400"><input type="checkbox" checked={showArchived} disabled={pending} onChange={(event) => setShowArchived(event.target.checked)} />{isKo ? '보관된 전략 표시' : 'Show archived strategies'}</label>
              {strategiesQuery.isError && <p role="alert" className="text-xs text-bear">{errorMessage(strategiesQuery.error, isKo ? '전략을 불러오지 못했습니다.' : 'Could not load strategies.')}</p>}
              {versionsQuery.isError && <p role="alert" className="text-xs text-bear">{errorMessage(versionsQuery.error, isKo ? '버전을 불러오지 못했습니다.' : 'Could not load versions.')}</p>}
              {saveMutation.isError && <p role="alert" className="border border-bear/35 bg-bear/10 px-3 py-2 text-xs text-bear">{errorMessage(saveMutation.error, isKo ? '전략 할당을 저장하지 못했습니다.' : 'Could not save the Strategy assignment.')}</p>}
              <div className="flex justify-end gap-2 border-t border-dark-800 pt-3">
                <button type="button" disabled={pending} onClick={() => dirty ? setConfirmCancel(true) : discardEdit()} className="border border-dark-600 px-3 py-1.5 text-[11px] text-dark-300 disabled:opacity-50">{isKo ? '취소' : 'Cancel'}</button>
                <button type="button" disabled={pending || selectedVersionId === null || !dirty} onClick={() => selectedVersionId !== null && saveMutation.mutate({ entryId, versionId: selectedVersionId })} className="border border-primary-400 bg-primary-500 px-3 py-1.5 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">{saveMutation.isPending ? (isKo ? '저장 중...' : 'Saving...') : (isKo ? '전략 저장' : 'Save Strategy')}</button>
              </div>
            </div>
              : assignment ? <div>
                <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-white">{assignment.strategy_name}</span><span className="font-mono text-xs text-primary-200">{assignment.version_label}</span><AssignmentLifecycleBadge active={assignment.version_is_active} retiredAt={assignment.version_retired_at} isKo={isKo} />{assignment.strategy_archived_at && <span className="border border-dark-600 px-1.5 py-0.5 text-[10px] font-semibold text-dark-400">{isKo ? '보관된 전략' : 'ARCHIVED STRATEGY'}</span>}</div>
                {assignment.version_description && <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-dark-400">{assignment.version_description}</p>}
                <p className="mt-1.5 text-[10px] text-dark-600">{isKo ? '할당됨' : 'Assigned'} {formatAssignedAt(assignment.assigned_at, isKo)}</p>
                {removeMutation.isError && !confirmRemove && <p role="alert" className="mt-2 border border-bear/35 bg-bear/10 px-3 py-2 text-xs text-bear">{errorMessage(removeMutation.error, isKo ? '전략 할당을 제거하지 못했습니다.' : 'Could not remove the Strategy assignment.')}</p>}
                <div className="mt-3 flex gap-2"><button type="button" disabled={pending} onClick={beginEdit} className="border border-dark-600 px-2.5 py-1.5 text-[11px] text-dark-200 disabled:opacity-50">{isKo ? '변경' : 'Change'}</button><button type="button" disabled={pending} onClick={() => { removeMutation.reset(); setConfirmRemove(true); }} className="border border-bear/40 px-2.5 py-1.5 text-[11px] text-bear disabled:opacity-50">{isKo ? '전략 제거' : 'Remove Strategy'}</button></div>
              </div>
                : <div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium text-dark-300">{isKo ? '할당되지 않음' : 'Not assigned'}</div><p className="mt-1 text-[10px] text-dark-600">{isKo ? '필요한 경우 직접 Playbook 버전을 연결하세요.' : 'Link a Playbook version explicitly when needed.'}</p></div><button type="button" onClick={beginEdit} className="shrink-0 border border-primary-400/50 px-2.5 py-1.5 text-[11px] text-primary-200 hover:text-white">{isKo ? '전략 할당' : 'Assign Strategy'}</button></div>}
      </div>
    </section>
    {confirmCancel && <UnsavedChangesDialog isKo={isKo} onKeepEditing={() => setConfirmCancel(false)} onDiscard={discardEdit} />}
    {confirmRemove && <RemoveAssignmentDialog
      isKo={isKo}
      pending={removeMutation.isPending}
      error={removeMutation.isError ? errorMessage(removeMutation.error, isKo ? '전략 할당을 제거하지 못했습니다.' : 'Could not remove the Strategy assignment.') : null}
      onCancel={() => setConfirmRemove(false)}
      onConfirm={() => removeMutation.mutate({ entryId })}
    />}
  </>;
}
