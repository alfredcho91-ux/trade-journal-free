import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, BookMarked, Check, Edit3, Plus, RotateCcw, Search, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  activateStrategyVersion,
  archiveStrategy,
  createStrategy,
  createStrategyVersion,
  getStrategy,
  listStrategies,
  listStrategyVersions,
  restoreStrategy,
  retireStrategyVersion,
  updateStrategy,
} from '../api/strategies';
import UnsavedChangesDialog from '../features/journal/UnsavedChangesDialog';
import { NewStrategyDrawer, NewVersionDrawer } from '../features/playbook/PlaybookDialogs';
import { errorMessage, normalizedDescription } from '../features/playbook/strategyDraft';
import { strategyQueryKeys } from '../features/playbook/strategyQueryKeys';
import { useLanguage } from '../store/useStore';
import type { Strategy, StrategyCreateInput, StrategyRule, StrategyVersion, StrategyVersionInput } from '../types';

const secondaryButton = 'inline-flex items-center gap-1.5 border border-dark-600 px-3 py-2 text-xs font-medium text-dark-200 hover:border-dark-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-50';
const primaryButton = 'inline-flex items-center gap-1.5 border border-primary-400 bg-primary-500 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-400 disabled:cursor-not-allowed disabled:opacity-50';

type Editor = 'new-strategy' | 'edit-strategy' | 'new-version' | null;
type LifecycleAction = 'archive' | 'restore' | 'activate' | 'retire';
interface LifecycleVariables {
  action: LifecycleAction;
  strategyId: number;
  versionId?: number;
  strategyName: string;
  versionLabel?: string;
}

function formatDate(value: string, isKo: boolean) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(isKo ? 'ko-KR' : 'en-CA', { dateStyle: 'medium' }).format(date);
}

function VersionBadge({ version, isKo }: { version: StrategyVersion; isKo: boolean }) {
  if (version.is_active) return <span className="border border-bull/40 bg-bull/10 px-1.5 py-0.5 text-[10px] font-semibold text-bull">{isKo ? '활성' : 'ACTIVE'}</span>;
  if (version.retired_at) return <span className="border border-dark-600 bg-dark-800 px-1.5 py-0.5 text-[10px] font-semibold text-dark-400">{isKo ? '은퇴' : 'RETIRED'}</span>;
  return <span className="border border-primary-500/30 bg-primary-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary-300">{isKo ? '비활성' : 'INACTIVE'}</span>;
}

function RuleColumn({ title, rules, isKo }: { title: string; rules: StrategyRule[]; isKo: boolean }) {
  return <section className="min-h-36 border-r border-dark-700 px-4 py-3 last:border-r-0">
    <div className="mb-3 flex items-center justify-between"><h4 className="text-[11px] font-semibold uppercase tracking-wider text-dark-300">{title}</h4><span className="font-mono text-[10px] text-dark-600">{rules.length}</span></div>
    {rules.length ? <ol className="space-y-2">{rules.map((rule, index) => <li key={rule.id} className="flex gap-2 text-xs leading-5 text-dark-200"><span className="w-4 shrink-0 text-right font-mono text-dark-600">{index + 1}</span><span>{rule.text}</span></li>)}</ol> : <p className="text-xs text-dark-600">{isKo ? '규칙 없음' : 'No rules'}</p>}
  </section>;
}

function StrategyRow({ strategy, selected, isKo, onSelect }: {
  strategy: Strategy;
  selected: boolean;
  isKo: boolean;
  onSelect: () => void;
}) {
  const versionsQuery = useQuery({
    queryKey: strategyQueryKeys.versions(strategy.id),
    queryFn: () => listStrategyVersions(strategy.id),
    enabled: strategy.active_version_id !== null,
  });
  const activeLabel = versionsQuery.data?.find((version) => version.id === strategy.active_version_id)?.version_label;
  return <button type="button" onClick={onSelect} aria-pressed={selected} className={`block w-full border-b border-dark-800 px-4 py-3 text-left transition-colors ${selected ? 'border-l-2 border-l-primary-400 bg-primary-500/10' : 'border-l-2 border-l-transparent hover:bg-dark-800/70'}`}>
    <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium text-white">{strategy.name}</span>{strategy.archived_at && <span className="border border-dark-600 px-1.5 py-0.5 text-[9px] font-semibold text-dark-400">{isKo ? '보관됨' : 'ARCHIVED'}</span>}</div>
    <p className="mt-1 line-clamp-2 text-xs leading-5 text-dark-500">{strategy.description || (isKo ? '설명 없음' : 'No description')}</p>
    {!strategy.archived_at && <div className="mt-2 text-[10px] font-semibold text-dark-500">{strategy.active_version_id ? <><span className="text-bull">{isKo ? '활성' : 'ACTIVE'}</span>{activeLabel && ` · ${activeLabel}`}</> : (isKo ? '활성 버전 없음' : 'No active version')}</div>}
  </button>;
}

function ConfirmDialog({ title, body, confirmLabel, danger = false, onCancel, onConfirm }: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={title}>
    <div className="w-full max-w-md border border-dark-600 bg-dark-900 p-5 shadow-2xl"><h2 className="text-base font-semibold text-white">{title}</h2><p className="mt-2 text-sm leading-6 text-dark-300">{body}</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onCancel} className={secondaryButton}>Cancel</button><button type="button" onClick={onConfirm} className={danger ? 'border border-bear/60 bg-bear/15 px-3 py-2 text-xs font-semibold text-bear' : primaryButton}>{confirmLabel}</button></div></div>
  </div>;
}

function EditStrategyDrawer({ strategy, isKo, pending, error, onDirtyChange, onClose, onSubmit }: {
  strategy: Strategy;
  isKo: boolean;
  pending: boolean;
  error: string | null;
  onDirtyChange: (dirty: boolean) => void;
  onClose: () => void;
  onSubmit: (name: string, description: string | null) => void;
}) {
  const [name, setName] = useState(strategy.name);
  const [description, setDescription] = useState(strategy.description ?? '');
  const dirty = name !== strategy.name || description !== (strategy.description ?? '');
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  const [confirmClose, setConfirmClose] = useState(false);
  return <>
    <div className="pointer-events-none fixed inset-0 z-[70] bg-black/45"><aside className="pointer-events-auto absolute inset-y-0 right-0 w-[min(560px,58vw)] border-l border-dark-600 bg-dark-900 shadow-2xl" role="dialog" aria-modal="true" aria-label={isKo ? '전략 편집' : 'Edit Strategy'}>
      <header className="border-b border-dark-700 px-5 py-4"><h2 className="text-base font-semibold text-white">{isKo ? '전략 편집' : 'Edit Strategy'}</h2><p className="mt-1 text-xs text-dark-500">{isKo ? '이름과 설명만 변경합니다. 버전 정의는 읽기 전용입니다.' : 'Only name and description change. Version definitions remain read-only.'}</p></header>
      <form className="space-y-4 p-5" onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSubmit(name.trim(), normalizedDescription(description)); }}>
        <label className="block text-xs text-dark-300">{isKo ? '전략 이름' : 'Strategy name'}<input autoFocus aria-label={isKo ? '전략 이름' : 'Strategy name'} value={name} maxLength={240} onChange={(event) => setName(event.target.value)} className="mt-1.5 w-full border border-dark-600 bg-dark-950 px-3 py-2 text-sm text-white outline-none focus:border-primary-400" /></label>
        <label className="block text-xs text-dark-300">{isKo ? '전략 설명' : 'Strategy description'}<textarea aria-label={isKo ? '전략 설명' : 'Strategy description'} value={description} maxLength={2000} onChange={(event) => setDescription(event.target.value)} className="mt-1.5 min-h-28 w-full resize-y border border-dark-600 bg-dark-950 px-3 py-2 text-sm text-white outline-none focus:border-primary-400" /></label>
        {error && <p role="alert" className="border border-bear/40 bg-bear/10 px-3 py-2 text-xs text-bear">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-dark-700 pt-4"><button type="button" onClick={() => dirty ? setConfirmClose(true) : onClose()} className={secondaryButton}>{isKo ? '취소' : 'Cancel'}</button><button type="submit" disabled={pending || !dirty || !name.trim()} className={primaryButton}>{pending ? (isKo ? '저장 중...' : 'Saving...') : (isKo ? '변경 저장' : 'Save Changes')}</button></div>
      </form>
    </aside></div>
    {confirmClose && <UnsavedChangesDialog isKo={isKo} onKeepEditing={() => setConfirmClose(false)} onDiscard={onClose} />}
  </>;
}

export default function PlaybookPage() {
  const isKo = useLanguage() === 'ko';
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [selectedStrategyId, setSelectedStrategyId] = useState<number | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<number | null>(null);
  const [confirmLifecycle, setConfirmLifecycle] = useState<LifecycleAction | null>(null);
  const selectedStrategyRef = useRef<number | null>(null);
  selectedStrategyRef.current = selectedStrategyId;

  const listQuery = useQuery({ queryKey: strategyQueryKeys.list(showArchived), queryFn: () => listStrategies(showArchived) });
  const strategies = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const filteredStrategies = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return strategies.filter((strategy) => !needle || `${strategy.name} ${strategy.description ?? ''}`.toLocaleLowerCase().includes(needle));
  }, [search, strategies]);

  useEffect(() => {
    if (!strategies.length) { setSelectedStrategyId(null); return; }
    if (selectedStrategyId === null || !strategies.some((strategy) => strategy.id === selectedStrategyId)) setSelectedStrategyId(strategies[0].id);
  }, [selectedStrategyId, strategies]);

  const detailQuery = useQuery({
    queryKey: strategyQueryKeys.detail(selectedStrategyId ?? -1),
    queryFn: () => getStrategy(selectedStrategyId!),
    enabled: selectedStrategyId !== null,
  });
  const versionsQuery = useQuery({
    queryKey: strategyQueryKeys.versions(selectedStrategyId ?? -1),
    queryFn: () => listStrategyVersions(selectedStrategyId!),
    enabled: selectedStrategyId !== null,
  });
  const selectedStrategy = detailQuery.data?.id === selectedStrategyId ? detailQuery.data : strategies.find((strategy) => strategy.id === selectedStrategyId);
  const versions = useMemo(() => versionsQuery.data?.every((version) => version.strategy_id === selectedStrategyId)
    ? [...versionsQuery.data].sort((a, b) => b.sequence - a.sequence)
    : [], [selectedStrategyId, versionsQuery.data]);

  useEffect(() => {
    if (!versions.length) { setSelectedVersionId(null); return; }
    if (selectedVersionId === null || !versions.some((version) => version.id === selectedVersionId)) {
      setSelectedVersionId(versions.find((version) => version.is_active)?.id ?? versions[0].id);
    }
  }, [selectedVersionId, versions]);
  const selectedVersion = versions.find((version) => version.id === selectedVersionId);

  const refreshStrategy = async (strategyId: number) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: strategyQueryKeys.lists() }),
      queryClient.invalidateQueries({ queryKey: strategyQueryKeys.detail(strategyId) }),
      queryClient.invalidateQueries({ queryKey: strategyQueryKeys.versions(strategyId) }),
    ]);
  };

  const createMutation = useMutation({
    mutationFn: (payload: StrategyCreateInput) => createStrategy(payload),
    onSuccess: async (created) => {
      queryClient.setQueriesData<Strategy[]>({ queryKey: strategyQueryKeys.lists() }, (current) => {
        if (!current) return current;
        return [...current.filter((strategy) => strategy.id !== created.id), created]
          .sort((a, b) => a.name.localeCompare(b.name));
      });
      queryClient.setQueryData(strategyQueryKeys.detail(created.id), created);
      setEditor(null);
      setEditorDirty(false);
      setSelectedVersionId(null);
      setSelectedStrategyId(created.id);
      await queryClient.invalidateQueries({ queryKey: strategyQueryKeys.lists() });
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ strategyId, name, description }: { strategyId: number; name: string; description: string | null }) => updateStrategy(strategyId, { name, description }),
    onSuccess: async (_, variables) => { if (selectedStrategyRef.current === variables.strategyId) { setEditor(null); setEditorDirty(false); } await refreshStrategy(variables.strategyId); },
  });
  const versionMutation = useMutation({
    mutationFn: ({ strategyId, payload }: { strategyId: number; payload: StrategyVersionInput }) => createStrategyVersion(strategyId, payload),
    onSuccess: async (created, variables) => { if (selectedStrategyRef.current === variables.strategyId) { setEditor(null); setEditorDirty(false); } await refreshStrategy(variables.strategyId); if (selectedStrategyRef.current === variables.strategyId) setSelectedVersionId(created.id); },
  });
  const lifecycleMutation = useMutation<Strategy | StrategyVersion, Error, LifecycleVariables>({
    mutationFn: ({ action, strategyId, versionId }) => {
      if (action === 'archive') return archiveStrategy(strategyId);
      if (action === 'restore') return restoreStrategy(strategyId);
      if (action === 'activate') return activateStrategyVersion(strategyId, versionId!);
      return retireStrategyVersion(strategyId, versionId!);
    },
    onSuccess: async (_, variables) => { setConfirmLifecycle(null); await refreshStrategy(variables.strategyId); },
  });

  const chooseStrategy = (strategyId: number) => {
    if (strategyId === selectedStrategyId) return;
    if (editor && editorDirty) { setPendingSelection(strategyId); return; }
    setSelectedVersionId(null);
    setSelectedStrategyId(strategyId);
  };
  const openEditor = (next: Editor) => { createMutation.reset(); updateMutation.reset(); versionMutation.reset(); setEditorDirty(false); setEditor(next); };
  const submitLifecycle = (action: LifecycleAction) => {
    if (!selectedStrategy) return;
    lifecycleMutation.reset();
    setConfirmLifecycle(null);
    lifecycleMutation.mutate({
      action,
      strategyId: selectedStrategy.id,
      versionId: selectedVersion?.id,
      strategyName: selectedStrategy.name,
      versionLabel: selectedVersion?.version_label,
    });
  };

  const queryError = listQuery.error ?? detailQuery.error ?? versionsQuery.error;
  const lifecycleSubject = lifecycleMutation.variables
    ? lifecycleMutation.variables.action === 'archive' || lifecycleMutation.variables.action === 'restore'
      ? lifecycleMutation.variables.strategyName
      : lifecycleMutation.variables.versionLabel ?? lifecycleMutation.variables.strategyName
    : '';

  return <div className="mx-auto max-w-[1420px]">
    <header className="mb-4 flex items-end justify-between gap-4 border-b border-dark-700 pb-4">
      <div><div className="flex items-center gap-2"><BookMarked className="h-5 w-5 text-primary-300" /><h1 className="text-xl font-semibold text-white">Playbook</h1></div><p className="mt-1 text-xs text-dark-500">{isKo ? '재사용 가능한 트레이딩 전략과 버전 기록' : 'Reusable trading strategies and version history.'}</p></div>
      <div className="flex items-center gap-2"><label className="relative"><Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-dark-500" /><span className="sr-only">{isKo ? '전략 검색' : 'Search strategies'}</span><input aria-label={isKo ? '전략 검색' : 'Search strategies'} value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 w-64 border border-dark-600 bg-dark-950 pl-9 pr-3 text-xs text-white outline-none placeholder:text-dark-600 focus:border-primary-400" placeholder={isKo ? '전략 검색' : 'Search strategies'} /></label><button type="button" onClick={() => openEditor('new-strategy')} className={primaryButton}><Plus className="h-3.5 w-3.5" />{isKo ? '새 전략' : 'New Strategy'}</button></div>
    </header>

    {queryError && <div role="alert" className="mb-4 flex items-center justify-between border border-bear/40 bg-bear/10 px-4 py-3 text-xs text-bear"><span>{errorMessage(queryError, isKo ? 'Playbook을 불러오지 못했습니다.' : 'Failed to load Playbook.')}</span><button type="button" onClick={() => void queryClient.invalidateQueries({ queryKey: strategyQueryKeys.all })} className="underline">{isKo ? '다시 시도' : 'Retry'}</button></div>}
    {lifecycleMutation.error && lifecycleMutation.variables && <div role="alert" className="mb-4 flex items-center justify-between gap-4 border border-bear/40 bg-bear/10 px-4 py-3 text-xs text-bear"><span>{isKo
      ? `${lifecycleMutation.variables.action === 'archive' ? '전략 보관' : lifecycleMutation.variables.action === 'restore' ? '전략 복원' : lifecycleMutation.variables.action === 'activate' ? '버전 활성화' : '버전 은퇴'} 실패 · ${lifecycleSubject}: ${errorMessage(lifecycleMutation.error, '요청을 처리하지 못했습니다.')}`
      : `${lifecycleMutation.variables.action === 'archive' ? 'Archive Strategy' : lifecycleMutation.variables.action === 'restore' ? 'Restore Strategy' : lifecycleMutation.variables.action === 'activate' ? 'Activate Version' : 'Retire Version'} failed · ${lifecycleSubject}: ${errorMessage(lifecycleMutation.error, 'The request could not be completed.')}`}</span><button type="button" onClick={() => lifecycleMutation.reset()} className="shrink-0 underline">{isKo ? '닫기' : 'Dismiss'}</button></div>}

    {listQuery.isLoading ? <div className="flex min-h-96 items-center justify-center border border-dark-700 text-sm text-dark-500">{isKo ? '전략을 불러오는 중...' : 'Loading strategies...'}</div> : !strategies.length ? <div className="flex min-h-96 flex-col items-center justify-center border border-dark-700 bg-dark-950/30 text-center"><BookMarked className="h-8 w-8 text-dark-600" /><h2 className="mt-4 text-base font-semibold text-white">{isKo ? '아직 전략이 없습니다.' : 'No strategies yet.'}</h2><p className="mt-1 text-sm text-dark-500">{showArchived ? (isKo ? '보관된 전략도 없습니다.' : 'No archived strategies were found.') : (isKo ? '첫 번째 재사용 가능한 트레이딩 플레이북을 만들거나 보관된 전략을 확인하세요.' : 'Create your first reusable trading playbook or check archived strategies.')}</p><div className="mt-5 flex gap-2">{!showArchived && <button type="button" onClick={() => setShowArchived(true)} className={secondaryButton}><Archive className="h-3.5 w-3.5" />{isKo ? '보관된 전략 보기' : 'Show archived'}</button>}<button type="button" onClick={() => openEditor('new-strategy')} className={primaryButton}><Plus className="h-3.5 w-3.5" />{isKo ? '전략 만들기' : 'Create Strategy'}</button></div></div> : <div className="grid min-h-[650px] grid-cols-[minmax(260px,32%)_1fr] border border-dark-700 bg-dark-950/20">
      <aside className="border-r border-dark-700" aria-label={isKo ? '전략 라이브러리' : 'Strategy library'}>
        <div className="flex h-11 items-center justify-between border-b border-dark-700 px-3"><h2 className="text-[11px] font-semibold uppercase tracking-wider text-dark-300">{isKo ? '전략 라이브러리' : 'Strategy Library'}</h2><label className="flex items-center gap-1.5 text-[10px] text-dark-500"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />{isKo ? '보관 포함' : 'Show archived'}</label></div>
        <div className="max-h-[calc(100vh-220px)] overflow-y-auto">{filteredStrategies.length ? filteredStrategies.map((strategy) => <StrategyRow key={strategy.id} strategy={strategy} selected={strategy.id === selectedStrategyId} isKo={isKo} onSelect={() => chooseStrategy(strategy.id)} />) : <p className="px-4 py-8 text-center text-xs text-dark-600">{isKo ? '검색 결과가 없습니다.' : 'No matching strategies.'}</p>}</div>
      </aside>

      <section className="min-w-0">
        {detailQuery.isLoading && !selectedStrategy ? <div className="flex h-full items-center justify-center text-sm text-dark-500">{isKo ? '전략 상세를 불러오는 중...' : 'Loading strategy detail...'}</div> : selectedStrategy ? <>
          <div className="border-b border-dark-700 px-5 py-4"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="flex items-center gap-2"><h2 className="truncate text-lg font-semibold text-white">{selectedStrategy.name}</h2>{selectedStrategy.archived_at ? <span className="border border-dark-600 px-2 py-0.5 text-[10px] font-semibold text-dark-400">{isKo ? '보관됨' : 'ARCHIVED'}</span> : selectedStrategy.active_version_id ? <span className="border border-bull/40 bg-bull/10 px-2 py-0.5 text-[10px] font-semibold text-bull">{isKo ? '활성' : 'ACTIVE'}</span> : <span className="border border-primary-500/30 px-2 py-0.5 text-[10px] font-semibold text-primary-300">{isKo ? '활성 버전 없음' : 'NO ACTIVE VERSION'}</span>}</div><p className="mt-1.5 max-w-3xl text-xs leading-5 text-dark-400">{selectedStrategy.description || (isKo ? '전략 설명이 없습니다.' : 'No strategy description.')}</p><p className="mt-2 text-[10px] text-dark-600">{isKo ? '활성 버전' : 'Active version'}: <span className="font-mono text-dark-300">{versions.find((version) => version.id === selectedStrategy.active_version_id)?.version_label ?? (isKo ? '없음' : 'None')}</span></p></div><div className="flex shrink-0 gap-2"><button type="button" onClick={() => openEditor('edit-strategy')} className={secondaryButton}><Edit3 className="h-3.5 w-3.5" />{isKo ? '전략 편집' : 'Edit Strategy'}</button><button type="button" disabled={lifecycleMutation.isPending} onClick={() => setConfirmLifecycle(selectedStrategy.archived_at ? 'restore' : 'archive')} className={secondaryButton}>{selectedStrategy.archived_at ? <RotateCcw className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}{selectedStrategy.archived_at ? (isKo ? '복원' : 'Restore') : (isKo ? '보관' : 'Archive')}</button></div></div></div>

          <div className="border-b border-dark-700"><div className="flex h-11 items-center justify-between border-b border-dark-800 px-5"><h3 className="text-[11px] font-semibold uppercase tracking-wider text-dark-300">{isKo ? '버전 기록' : 'Version History'}</h3><button type="button" disabled={Boolean(selectedStrategy.archived_at)} onClick={() => openEditor('new-version')} className={secondaryButton}><Plus className="h-3.5 w-3.5" />{isKo ? '새 버전' : 'New Version'}</button></div>
            {versionsQuery.isLoading ? <div className="px-5 py-6 text-xs text-dark-500">{isKo ? '버전을 불러오는 중...' : 'Loading versions...'}</div> : versions.length ? <div>{versions.map((version) => <button key={version.id} type="button" onClick={() => setSelectedVersionId(version.id)} aria-pressed={version.id === selectedVersionId} className={`grid w-full grid-cols-[90px_90px_1fr_120px] items-center gap-3 border-b border-dark-800 px-5 py-2.5 text-left last:border-b-0 ${version.id === selectedVersionId ? 'bg-dark-800/80' : 'hover:bg-dark-800/40'}`}><span className="font-mono text-xs font-semibold text-white">{version.version_label}</span><span><VersionBadge version={version} isKo={isKo} /></span><span className="truncate text-xs text-dark-400">{version.description || (isKo ? '설명 없음' : 'No description')}</span><span className="text-right font-mono text-[10px] text-dark-600">{formatDate(version.created_at, isKo)}</span></button>)}</div> : <div className="px-5 py-6 text-xs text-dark-500">{isKo ? '버전이 없습니다.' : 'No versions.'}</div>}
          </div>

          {selectedVersion ? <div><div className="flex h-12 items-center justify-between border-b border-dark-700 px-5"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary-300" /><h3 className="text-[11px] font-semibold uppercase tracking-wider text-dark-200">{isKo ? '전략 규칙' : 'Strategy Rules'} — <span className="font-mono normal-case text-white">{selectedVersion.version_label}</span></h3><span className="border border-dark-600 px-1.5 py-0.5 text-[9px] font-semibold text-dark-400">{isKo ? '읽기 전용' : 'READ ONLY'}</span></div><div className="flex gap-2">{!selectedStrategy.archived_at && !selectedVersion.is_active && !selectedVersion.retired_at && <button type="button" disabled={lifecycleMutation.isPending} onClick={() => setConfirmLifecycle('activate')} className={primaryButton}><Check className="h-3.5 w-3.5" />{isKo ? '활성화' : 'Activate'}</button>}{!selectedStrategy.archived_at && !selectedVersion.retired_at && <button type="button" disabled={lifecycleMutation.isPending} onClick={() => setConfirmLifecycle('retire')} className={secondaryButton}>{isKo ? '은퇴' : 'Retire'}</button>}</div></div><div className="grid grid-cols-3"><RuleColumn title={isKo ? '진입 규칙' : 'Entry rules'} rules={selectedVersion.rules.entry_rules} isKo={isKo} /><RuleColumn title={isKo ? '리스크 규칙' : 'Risk rules'} rules={selectedVersion.rules.risk_rules} isKo={isKo} /><RuleColumn title={isKo ? '청산 규칙' : 'Exit rules'} rules={selectedVersion.rules.exit_rules} isKo={isKo} /></div></div> : !versionsQuery.isLoading && <div className="px-5 py-8"><h3 className="text-sm font-medium text-white">{isKo ? '활성 버전 없음' : 'No active version'}</h3><p className="mt-1 text-xs text-dark-500">{isKo ? '이전 버전은 위에서 계속 확인할 수 있습니다.' : 'Previous versions remain available above.'}</p></div>}
        </> : null}
      </section>
    </div>}

    {editor === 'new-strategy' && <NewStrategyDrawer isKo={isKo} pending={createMutation.isPending} error={createMutation.error ? errorMessage(createMutation.error, 'Failed to create strategy.') : null} onDirtyChange={setEditorDirty} onClose={() => { setEditor(null); setEditorDirty(false); }} onSubmit={(payload: StrategyCreateInput) => createMutation.mutate(payload)} />}
    {editor === 'edit-strategy' && selectedStrategy && <EditStrategyDrawer strategy={selectedStrategy} isKo={isKo} pending={updateMutation.isPending} error={updateMutation.error ? errorMessage(updateMutation.error, 'Failed to update strategy.') : null} onDirtyChange={setEditorDirty} onClose={() => { setEditor(null); setEditorDirty(false); }} onSubmit={(name, description) => updateMutation.mutate({ strategyId: selectedStrategy.id, name, description })} />}
    {editor === 'new-version' && selectedStrategy && <NewVersionDrawer strategy={selectedStrategy} versions={versions} initialBase={selectedVersion ?? versions.find((version) => version.is_active) ?? versions[0]} isKo={isKo} pending={versionMutation.isPending} error={versionMutation.error ? errorMessage(versionMutation.error, 'Failed to create version.') : null} onDirtyChange={setEditorDirty} onClose={() => { setEditor(null); setEditorDirty(false); }} onSubmit={(payload) => versionMutation.mutate({ strategyId: selectedStrategy.id, payload })} />}

    {pendingSelection !== null && <UnsavedChangesDialog isKo={isKo} onKeepEditing={() => setPendingSelection(null)} onDiscard={() => { const next = pendingSelection; setPendingSelection(null); setEditor(null); setEditorDirty(false); setSelectedVersionId(null); setSelectedStrategyId(next); }} />}
    {confirmLifecycle && selectedStrategy && <ConfirmDialog title={confirmLifecycle === 'archive' ? (isKo ? '전략 보관' : 'Archive Strategy') : confirmLifecycle === 'restore' ? (isKo ? '전략 복원' : 'Restore Strategy') : confirmLifecycle === 'activate' ? (isKo ? '버전 활성화' : 'Activate Version') : (isKo ? '버전 은퇴' : 'Retire Version')} body={confirmLifecycle === 'archive' ? (isKo ? '보관은 삭제가 아닙니다. 전략, 버전 기록과 규칙은 계속 열람할 수 있습니다.' : 'Archive does not delete anything. The strategy, version history, and rules remain viewable.') : confirmLifecycle === 'restore' ? (isKo ? '전략을 복원합니다. 활성 버전은 자동으로 선택되지 않습니다.' : 'Restore this strategy. No active version will be chosen automatically.') : confirmLifecycle === 'activate' ? (isKo ? `${selectedVersion?.version_label} 버전을 현재 활성 버전으로 지정합니다.` : `Make ${selectedVersion?.version_label} the current active version.`) : (isKo ? `${selectedVersion?.version_label} 버전을 은퇴 처리합니다. 기록은 유지됩니다.` : `Retire ${selectedVersion?.version_label}. Its history remains intact.`)} confirmLabel={confirmLifecycle === 'archive' ? (isKo ? '보관' : 'Archive') : confirmLifecycle === 'restore' ? (isKo ? '복원' : 'Restore') : confirmLifecycle === 'activate' ? (isKo ? '활성화' : 'Activate') : (isKo ? '은퇴' : 'Retire')} danger={confirmLifecycle === 'archive' || confirmLifecycle === 'retire'} onCancel={() => setConfirmLifecycle(null)} onConfirm={() => submitLifecycle(confirmLifecycle)} />}
  </div>;
}
