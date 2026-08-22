import { useState } from 'react';
import { KeyRound, Loader2, Trash2, X } from 'lucide-react';

import type { ExchangeStatus } from '../../types';

export default function ExchangeConnectionModal({
  exchange,
  isKo,
  isSaving,
  isDeleting,
  error,
  onSave,
  onDelete,
  onClose,
}: {
  exchange: ExchangeStatus;
  isKo: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  error: unknown;
  onSave: (values: { api_key: string; secret_key: string; passphrase?: string }) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const errorText = error instanceof Error ? error.message : null;
  const canSave = Boolean(
    apiKey.trim() && secretKey.trim() && (!exchange.requires_passphrase || passphrase.trim()),
  ) && !isSaving && !isDeleting;
  const busy = isSaving || isDeleting;
  const storedByEnvironment = exchange.credential_source === 'environment';
  const storageText = exchange.credential_source === 'encrypted_db'
    ? (isKo ? '서버 DB에 AES-256-GCM 암호문으로 저장됨' : 'Stored as AES-256-GCM ciphertext in the server database')
    : exchange.credential_source === 'keyring'
      ? (isKo ? '이 컴퓨터의 운영체제 보안 저장소에 저장됨' : 'Stored in this computer\'s OS credential vault')
      : storedByEnvironment
        ? (isKo ? '배포 환경 Secret으로 설정됨' : 'Configured as a deployment secret')
        : (isKo ? '아직 저장된 연결 없음' : 'No saved connection');

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label={isKo ? `${exchange.name} API 연결` : `${exchange.name} API connection`}>
      <form className="w-full max-w-md border border-dark-600 bg-dark-950 shadow-2xl" onSubmit={(event) => { event.preventDefault(); if (canSave) onSave({ api_key: apiKey, secret_key: secretKey, passphrase }); }}>
        <div className="flex items-start justify-between gap-4 border-b border-dark-700 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-white"><KeyRound className="h-4 w-4 text-primary-300" />{exchange.name} {isKo ? '연결' : 'Connection'}</h2>
            <p className="mt-1 text-xs leading-5 text-dark-400">{isKo ? '읽기 전용 연결을 확인한 뒤 백엔드의 보호 저장소에 저장합니다. 브라우저와 프론트엔드 코드에는 저장하지 않습니다.' : 'Read access is verified before saving to the backend protected store. Nothing is stored in browser storage or frontend code.'}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="text-dark-400 hover:text-white" aria-label={isKo ? '닫기' : 'Close'}><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <label className="block text-xs text-dark-300">API Key<input autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} className="mt-1.5 w-full border border-dark-700 bg-dark-900 px-3 py-2 text-sm text-white" /></label>
          <label className="block text-xs text-dark-300">Secret Key<input type="password" autoComplete="new-password" value={secretKey} onChange={(event) => setSecretKey(event.target.value)} className="mt-1.5 w-full border border-dark-700 bg-dark-900 px-3 py-2 text-sm text-white" /></label>
          {exchange.requires_passphrase && <label className="block text-xs text-dark-300">Passphrase<input type="password" autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} className="mt-1.5 w-full border border-dark-700 bg-dark-900 px-3 py-2 text-sm text-white" /></label>}
          {errorText && <div className="border border-bear/40 bg-bear/10 px-3 py-2 text-xs leading-5 text-bear">{errorText}</div>}
          {exchange.credential_error && <div className="border border-bear/40 bg-bear/10 px-3 py-2 text-xs leading-5 text-bear">{isKo ? '저장된 인증 정보를 확인할 수 없습니다. 연결을 다시 설정하거나 보호 저장소 상태를 확인하세요.' : 'Saved credentials could not be read. Reconnect or check protected storage availability.'}</div>}
          {exchange.configured && <div className="border border-dark-700 bg-dark-900 px-3 py-2 text-xs leading-5 text-dark-300">{storageText}{storedByEnvironment && (isKo ? ' · 삭제하려면 배포 환경에서 Secret을 제거하세요.' : ' · Remove it from the deployment environment to disconnect.')}</div>}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-dark-700 px-5 py-4">
          <div>{exchange.configured && !storedByEnvironment && <button type="button" onClick={onDelete} disabled={busy} className="inline-flex items-center gap-1.5 border border-bear/50 px-3 py-2 text-xs text-bear hover:bg-bear/10 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />{isDeleting ? (isKo ? '삭제 중' : 'Removing') : (isKo ? '연결 삭제' : 'Remove connection')}</button>}</div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="border border-dark-700 px-3 py-2 text-xs text-dark-300 hover:text-white">{isKo ? '취소' : 'Cancel'}</button>
            <button type="submit" disabled={!canSave} className="btn-primary inline-flex items-center gap-2 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50">{isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{isKo ? '연결 확인 후 저장' : 'Verify and Save'}</button>
          </div>
        </div>
      </form>
    </div>
  );
}
