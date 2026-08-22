import { KeyRound, Link2 } from 'lucide-react';

import type { ExchangeId, ExchangeStatus } from '../../types';

export default function JournalSyncPanel({
  statuses,
  selectedExchange,
  instType,
  symbols,
  isKo,
  onConnect,
  onExchangeChange,
  onInstTypeChange,
  onSymbolsChange,
}: {
  statuses: ExchangeStatus[];
  selectedExchange: ExchangeId;
  instType: 'SWAP' | 'SPOT';
  symbols: string;
  isKo: boolean;
  onConnect: () => void;
  onExchangeChange: (value: ExchangeId) => void;
  onInstTypeChange: (value: 'SWAP' | 'SPOT') => void;
  onSymbolsChange: (value: string) => void;
}) {
  const selected = statuses.find((item) => item.id === selectedExchange);
  return (
    <section className="flex flex-col gap-3 border border-dark-700 bg-dark-800/35 p-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center border border-dark-600 bg-dark-900 text-primary-300"><Link2 className="h-4 w-4" /></div>
        <div>
          <div className="text-sm font-semibold text-white">{selected?.name || 'Exchange'}</div>
          <div className={`text-xs ${selected?.credential_error ? 'text-bear' : selected?.configured ? 'text-bull' : 'text-dark-400'}`}>
            {selected?.credential_error
              ? (isKo ? '보호 저장소 확인 필요' : 'Protected storage needs attention')
              : selected?.configured
              ? isKo ? '읽기 전용 연결 준비됨' : 'Read-only connection ready'
              : isKo ? 'API 연결 필요' : 'API connection required'}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onConnect} className="inline-flex items-center gap-1.5 border border-dark-600 bg-dark-900 px-3 py-2 text-xs text-dark-200 hover:border-primary-400/60 hover:text-white">
          <KeyRound className="h-3.5 w-3.5 text-primary-300" />
          {selected?.configured ? (isKo ? '연결 설정' : 'Connection settings') : (isKo ? 'API 연결' : 'Connect API')}
        </button>
        <select value={selectedExchange} onChange={(event) => onExchangeChange(event.target.value as ExchangeId)} className="rounded-lg border border-dark-600 bg-dark-700 px-3 py-2 text-sm" aria-label={isKo ? '거래소' : 'Exchange'}>
          {statuses.map((exchange) => <option key={exchange.id} value={exchange.id}>{exchange.name}{exchange.configured ? '' : isKo ? ' · 미설정' : ' · Not configured'}</option>)}
        </select>
        <select value={instType} onChange={(event) => onInstTypeChange(event.target.value as 'SWAP' | 'SPOT')} className="rounded-lg border border-dark-600 bg-dark-700 px-3 py-2 text-sm" aria-label={isKo ? '상품 유형' : 'Instrument type'}>
          <option value="SWAP">{isKo ? 'USDT 선물' : 'USDT Perpetual'}</option>
          <option value="SPOT">{isKo ? '현물' : 'Spot'}</option>
        </select>
        {selectedExchange !== 'deepcoin' && <input value={symbols} onChange={(event) => onSymbolsChange(event.target.value)} className="min-w-[280px] rounded-lg border border-dark-600 bg-dark-700 px-3 py-2 text-sm" aria-label={isKo ? '동기화 종목' : 'Sync symbols'} placeholder="BTC/USDT, ETH/USDT" />}
        <span className="text-xs text-dark-400">{isKo ? '동기화 기간은 아래 기간 성과 분석에서 선택합니다.' : 'Choose the sync period in the performance section below.'}</span>
      </div>
    </section>
  );
}
