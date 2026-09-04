import { Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { RuleEngineMetadata, Strategy, StrategyCreateInput, StrategyRuleDocumentV2, StrategyVersion, StrategyVersionInput } from '../../types';
import UnsavedChangesDialog from '../journal/UnsavedChangesDialog';
import RuleEvaluatorEditor from './RuleEvaluatorEditor';
import { evaluatorForPayload, rulesAreValid } from './ruleAuthoring';
import { cloneRules, emptyRules, newRule, normalizedDescription, type RuleGroup } from './strategyDraft';

const inputClass = 'w-full border border-dark-600 bg-dark-950 px-3 py-2 text-sm text-white outline-none placeholder:text-dark-600 focus:border-primary-400';
const secondaryButton = 'border border-dark-600 px-3 py-2 text-xs font-medium text-dark-200 hover:border-dark-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-50';
const primaryButton = 'border border-primary-400 bg-primary-500 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-400 disabled:cursor-not-allowed disabled:opacity-50';

interface VersionDraft {
  version_label: string;
  description: string;
  rules: StrategyRuleDocumentV2;
}

function BaseSwitchConfirmDialog({ isKo, onKeepEditing, onDiscardAndSwitch }: {
  isKo: boolean;
  onKeepEditing: () => void;
  onDiscardAndSwitch: () => void;
}) {
  return <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label={isKo ? '기준 버전 변경' : 'Change base version'}>
    <div className="w-full max-w-md border border-dark-600 bg-dark-900 p-5 shadow-2xl">
      <h2 className="text-base font-semibold text-white">{isKo ? '기준 버전을 변경할까요?' : 'Change base version?'}</h2>
      <p className="mt-2 text-sm leading-5 text-dark-300">{isKo ? '현재 설명과 규칙 편집 내용이 선택한 버전의 내용으로 교체됩니다.' : 'Your current description and rule edits will be replaced with the selected version.'}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" autoFocus onClick={onKeepEditing} className={secondaryButton}>{isKo ? '계속 편집' : 'Keep Editing'}</button>
        <button type="button" onClick={onDiscardAndSwitch} className="border border-bear/60 bg-bear/15 px-3 py-2 text-xs font-semibold text-bear">{isKo ? '버리고 전환' : 'Discard and Switch'}</button>
      </div>
    </div>
  </div>;
}

function allRules(rules: StrategyRuleDocumentV2) {
  return [...rules.entry_rules, ...rules.risk_rules, ...rules.exit_rules];
}

function RuleEditor({ rules, metadata, metadataLoading, metadataError, isKo, onChange }: {
  rules: StrategyRuleDocumentV2;
  metadata?: RuleEngineMetadata;
  metadataLoading: boolean;
  metadataError: string | null;
  isKo: boolean;
  onChange: (rules: StrategyRuleDocumentV2) => void;
}) {
  const groups: Array<{ key: RuleGroup; label: string }> = [
    { key: 'entry_rules', label: isKo ? '진입 규칙' : 'Entry rules' },
    { key: 'risk_rules', label: isKo ? '리스크 규칙' : 'Risk rules' },
    { key: 'exit_rules', label: isKo ? '청산 규칙' : 'Exit rules' },
  ];

  return <div className="grid grid-cols-3 gap-3">
    {groups.map(({ key, label }) => <section key={key} className="border border-dark-700 bg-dark-950/40 p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-dark-300">{label}</h3>
        <span className="font-mono text-[10px] text-dark-600">{rules[key].length}</span>
      </div>
      <div className="space-y-2">
        {rules[key].map((rule, index) => <div key={rule.id} className="border border-dark-800 bg-dark-950/60 p-2">
          <div className="flex items-start gap-1.5">
            <span className="w-4 pt-2 text-right font-mono text-[10px] text-dark-600">{index + 1}</span>
            <input
              aria-label={`${label} ${index + 1}`}
              value={rule.text}
              maxLength={500}
              onChange={(event) => onChange({
                ...rules,
                [key]: rules[key].map((item) => item.id === rule.id ? { ...item, text: event.target.value } : item),
              })}
              className={`${inputClass} min-w-0 px-2 py-1.5 text-xs`}
              placeholder={isKo ? '규칙을 입력하세요' : 'Enter a rule'}
            />
            <button
              type="button"
              onClick={() => onChange({ ...rules, [key]: rules[key].filter((item) => item.id !== rule.id) })}
              className="mt-1.5 text-dark-600 hover:text-bear"
              aria-label={`${isKo ? '규칙 삭제' : 'Remove rule'} ${index + 1}`}
            ><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
          <div className="ml-5">
            <RuleEvaluatorEditor
              rule={rule}
              label={`${label} ${index + 1}`}
              metadata={metadata}
              metadataLoading={metadataLoading}
              metadataError={metadataError}
              onChange={(changed) => onChange({
                ...rules,
                [key]: rules[key].map((item) => item.id === rule.id ? changed : item),
              })}
            />
          </div>
        </div>)}
        <button
          type="button"
          onClick={() => onChange({ ...rules, [key]: [...rules[key], newRule(key, allRules(rules))] })}
          className="ml-5 flex items-center gap-1 text-xs text-primary-300 hover:text-primary-200"
        ><Plus className="h-3.5 w-3.5" />{isKo ? '규칙 추가' : 'Add rule'}</button>
      </div>
    </section>)}
  </div>;
}

function Drawer({ title, subtitle, children, isKo, dirty, onClose }: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  isKo: boolean;
  dirty: boolean;
  onClose: () => void;
}) {
  const [confirmClose, setConfirmClose] = useState(false);
  const close = () => dirty ? setConfirmClose(true) : onClose();
  return <>
    <div className="pointer-events-none fixed inset-0 z-[70] bg-black/45">
      <aside className="pointer-events-auto absolute inset-y-0 right-0 w-[min(880px,76vw)] overflow-y-auto border-l border-dark-600 bg-dark-900 shadow-2xl" role="dialog" aria-modal="true" aria-label={title}>
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-dark-700 bg-dark-900 px-5 py-4">
          <div><h2 className="text-base font-semibold text-white">{title}</h2><p className="mt-1 text-xs text-dark-500">{subtitle}</p></div>
          <button type="button" onClick={close} className="text-dark-400 hover:text-white" aria-label={isKo ? '닫기' : 'Close'}><X className="h-5 w-5" /></button>
        </header>
        {children}
      </aside>
    </div>
    {confirmClose && <UnsavedChangesDialog isKo={isKo} onKeepEditing={() => setConfirmClose(false)} onDiscard={onClose} />}
  </>;
}

function versionPayload(draft: VersionDraft, metadata: RuleEngineMetadata): StrategyVersionInput {
  const prepare = (rules: typeof draft.rules.entry_rules) => rules.map((rule) => ({
    id: rule.id,
    text: rule.text.trim(),
    ...(rule.evaluation ? { evaluation: evaluatorForPayload(rule.evaluation, metadata) } : {}),
  }));
  return {
    version_label: draft.version_label.trim(),
    description: normalizedDescription(draft.description),
    rules: {
      schema_version: 2,
      entry_rules: prepare(draft.rules.entry_rules),
      risk_rules: prepare(draft.rules.risk_rules),
      exit_rules: prepare(draft.rules.exit_rules),
    },
  };
}

function validDraft(draft: VersionDraft, metadata?: RuleEngineMetadata) {
  return Boolean(metadata)
    && draft.version_label.trim().length > 0
    && rulesAreValid(allRules(draft.rules), metadata!);
}

interface MetadataProps {
  metadata?: RuleEngineMetadata;
  metadataLoading: boolean;
  metadataError: string | null;
}

function MetadataState({ metadataLoading, metadataError, isKo }: MetadataProps & { isKo: boolean }) {
  if (metadataLoading) return <p role="status" className="border border-dark-700 bg-dark-950/60 px-3 py-2 text-xs text-dark-400">{isKo ? 'Rule Engine 메타데이터를 불러오는 중...' : 'Loading Rule Engine metadata...'}</p>;
  if (metadataError) return <p role="alert" className="border border-bear/40 bg-bear/10 px-3 py-2 text-xs text-bear">{isKo ? 'Rule Engine 메타데이터를 불러오지 못했습니다. 안전한 제출을 위해 저장이 비활성화됩니다.' : 'Rule Engine metadata could not be loaded. Submission is disabled to protect evaluator data.'} {metadataError}</p>;
  return null;
}

export function NewStrategyDrawer({ metadata, metadataLoading, metadataError, isKo, pending, error, onDirtyChange, onClose, onSubmit }: MetadataProps & {
  isKo: boolean;
  pending: boolean;
  error: string | null;
  onDirtyChange: (dirty: boolean) => void;
  onClose: () => void;
  onSubmit: (payload: StrategyCreateInput) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [version, setVersion] = useState<VersionDraft>({ version_label: '', description: '', rules: emptyRules() });
  const [confirmCancel, setConfirmCancel] = useState(false);
  const dirty = Boolean(name || description || version.version_label || version.description || allRules(version.rules).length);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  return <Drawer title={isKo ? '새 전략' : 'New Strategy'} subtitle={isKo ? '전략과 초기 버전을 함께 만듭니다.' : 'Create the strategy and its initial immutable version together.'} isKo={isKo} dirty={dirty} onClose={onClose}>
    <form className="space-y-5 p-5" onSubmit={(event) => {
      event.preventDefault();
      if (!name.trim() || !metadata || !validDraft(version, metadata)) return;
      onSubmit({ name: name.trim(), description: normalizedDescription(description), initial_version: versionPayload(version, metadata) });
    }}>
      <div className="grid grid-cols-2 gap-4">
        <label className="text-xs text-dark-300">{isKo ? '전략 이름' : 'Strategy name'}<input autoFocus aria-label={isKo ? '전략 이름' : 'Strategy name'} value={name} maxLength={240} onChange={(event) => setName(event.target.value)} className={`mt-1.5 ${inputClass}`} /></label>
        <label className="text-xs text-dark-300">{isKo ? '초기 버전 라벨' : 'Initial version label'}<input aria-label={isKo ? '초기 버전 라벨' : 'Initial version label'} value={version.version_label} maxLength={80} onChange={(event) => setVersion({ ...version, version_label: event.target.value })} className={`mt-1.5 ${inputClass}`} placeholder="v1.0" /></label>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <label className="text-xs text-dark-300">{isKo ? '전략 설명' : 'Strategy description'}<textarea aria-label={isKo ? '전략 설명' : 'Strategy description'} value={description} maxLength={2000} onChange={(event) => setDescription(event.target.value)} className={`mt-1.5 min-h-20 resize-y ${inputClass}`} /></label>
        <label className="text-xs text-dark-300">{isKo ? '버전 설명' : 'Version description'}<textarea aria-label={isKo ? '버전 설명' : 'Version description'} value={version.description} maxLength={2000} onChange={(event) => setVersion({ ...version, description: event.target.value })} className={`mt-1.5 min-h-20 resize-y ${inputClass}`} /></label>
      </div>
      <MetadataState metadata={metadata} metadataLoading={metadataLoading} metadataError={metadataError} isKo={isKo} />
      <RuleEditor rules={version.rules} metadata={metadata} metadataLoading={metadataLoading} metadataError={metadataError} isKo={isKo} onChange={(rules) => setVersion({ ...version, rules })} />
      {error && <p role="alert" className="border border-bear/40 bg-bear/10 px-3 py-2 text-xs text-bear">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-dark-700 pt-4"><button type="button" onClick={() => dirty ? setConfirmCancel(true) : onClose()} className={secondaryButton}>{isKo ? '취소' : 'Cancel'}</button><button type="submit" disabled={pending || !name.trim() || !validDraft(version, metadata)} className={primaryButton}>{pending ? (isKo ? '생성 중...' : 'Creating...') : (isKo ? '전략 생성' : 'Create Strategy')}</button></div>
    </form>
    {confirmCancel && <UnsavedChangesDialog isKo={isKo} onKeepEditing={() => setConfirmCancel(false)} onDiscard={onClose} />}
  </Drawer>;
}

export function NewVersionDrawer({ strategy, versions, initialBase, metadata, metadataLoading, metadataError, isKo, pending, error, onDirtyChange, onClose, onSubmit }: MetadataProps & {
  strategy: Strategy;
  versions: StrategyVersion[];
  initialBase?: StrategyVersion;
  isKo: boolean;
  pending: boolean;
  error: string | null;
  onDirtyChange: (dirty: boolean) => void;
  onClose: () => void;
  onSubmit: (payload: StrategyVersionInput) => void;
}) {
  const [baseId, setBaseId] = useState<number | null>(initialBase?.id ?? null);
  const [initial] = useState<VersionDraft>(() => ({ version_label: '', description: initialBase?.description ?? '', rules: initialBase ? cloneRules(initialBase.rules) : emptyRules() }));
  const [baseline, setBaseline] = useState<VersionDraft>(() => initial);
  const [draft, setDraft] = useState<VersionDraft>(() => initial);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [pendingBase, setPendingBase] = useState<{ id: number | null } | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const applyBase = (nextId: number | null) => {
    const source = versions.find((version) => version.id === nextId);
    const nextBaseline: VersionDraft = {
      version_label: '',
      description: source?.description ?? '',
      rules: source ? cloneRules(source.rules) : emptyRules(),
    };
    setBaseId(nextId);
    setBaseline(nextBaseline);
    setDraft({ ...nextBaseline, version_label: draft.version_label });
  };

  const requestBaseChange = (nextId: number | null) => {
    if (nextId === baseId) return;
    if (dirty) {
      setPendingBase({ id: nextId });
      return;
    }
    applyBase(nextId);
  };

  return <Drawer title={isKo ? '새 버전' : 'New Version'} subtitle={`${strategy.name} · ${isKo ? '새 정의를 생성합니다. 기존 버전은 변경되지 않습니다.' : 'Creates a new definition. Existing versions stay unchanged.'}`} isKo={isKo} dirty={dirty} onClose={onClose}>
    <form className="space-y-5 p-5" onSubmit={(event) => { event.preventDefault(); if (metadata && validDraft(draft, metadata)) onSubmit(versionPayload(draft, metadata)); }}>
      <div className="grid grid-cols-2 gap-4">
        <label className="text-xs text-dark-300">{isKo ? '버전 라벨' : 'Version label'}<input autoFocus aria-label={isKo ? '버전 라벨' : 'Version label'} value={draft.version_label} maxLength={80} onChange={(event) => setDraft({ ...draft, version_label: event.target.value })} className={`mt-1.5 ${inputClass}`} placeholder="v1.1" /></label>
        <label className="text-xs text-dark-300">{isKo ? '기준 버전' : 'Based on'}<select aria-label={isKo ? '기준 버전' : 'Based on'} value={baseId ?? ''} onChange={(event) => requestBaseChange(event.target.value ? Number(event.target.value) : null)} className={`mt-1.5 ${inputClass}`}><option value="">{isKo ? '빈 규칙 세트' : 'Empty rule set'}</option>{versions.map((version) => <option key={version.id} value={version.id}>{version.version_label}</option>)}</select></label>
      </div>
      <label className="block text-xs text-dark-300">{isKo ? '버전 설명' : 'Version description'}<textarea aria-label={isKo ? '버전 설명' : 'Version description'} value={draft.description} maxLength={2000} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className={`mt-1.5 min-h-20 resize-y ${inputClass}`} /></label>
      <MetadataState metadata={metadata} metadataLoading={metadataLoading} metadataError={metadataError} isKo={isKo} />
      <RuleEditor rules={draft.rules} metadata={metadata} metadataLoading={metadataLoading} metadataError={metadataError} isKo={isKo} onChange={(rules) => setDraft({ ...draft, rules })} />
      {error && <p role="alert" className="border border-bear/40 bg-bear/10 px-3 py-2 text-xs text-bear">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-dark-700 pt-4"><button type="button" onClick={() => dirty ? setConfirmCancel(true) : onClose()} className={secondaryButton}>{isKo ? '취소' : 'Cancel'}</button><button type="submit" disabled={pending || !validDraft(draft, metadata)} className={primaryButton}>{pending ? (isKo ? '생성 중...' : 'Creating...') : (isKo ? '버전 생성' : 'Create Version')}</button></div>
    </form>
    {confirmCancel && <UnsavedChangesDialog isKo={isKo} onKeepEditing={() => setConfirmCancel(false)} onDiscard={onClose} />}
    {pendingBase && <BaseSwitchConfirmDialog isKo={isKo} onKeepEditing={() => setPendingBase(null)} onDiscardAndSwitch={() => { const nextId = pendingBase.id; setPendingBase(null); applyBase(nextId); }} />}
  </Drawer>;
}
