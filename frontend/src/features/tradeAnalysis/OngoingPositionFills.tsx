import { useMemo, useState } from 'react';
import { CandlestickChart, CircleDot } from 'lucide-react';

import type { ExchangeId, ExchangeOpenPosition, JournalEntry } from '../../types';
import TradeReportModal from '../journal/TradeReportModal';
import { isOngoingFill } from '../journal/journalEntries';

const MAX_VISIBLE_FILLS = 20;

function dateLabel(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : '-';
}

function normalizedKey(exchange: string | undefined, symbol: string | undefined, direction: string | undefined): string {
  return `${(exchange || '').toLowerCase()}|${(symbol || '').replace(/[-_]/g, '/').replace('/USDT/SWAP', '/USDT').toUpperCase()}|${direction || ''}`;
}

export default function OngoingPositionFills({
  entries,
  openPositions,
  unavailableExchanges,
  hasLoadError,
  isKo,
}: {
  entries: JournalEntry[];
  openPositions: ExchangeOpenPosition[];
  unavailableExchanges: ExchangeId[];
  hasLoadError: boolean;
  isKo: boolean;
}) {
  const [selected, setSelected] = useState<JournalEntry | null>(null);
  const positions = useMemo(() => [...openPositions].sort((left, right) => (
    new Date(right.opened_at || 0).getTime() - new Date(left.opened_at || 0).getTime()
  )), [openPositions]);
  const { fills, totalFillCount } = useMemo(() => {
    const liveByKey = new Map<string, ExchangeOpenPosition>();
    positions.forEach((position) => {
      const key = normalizedKey(position.exchange, position.symbol, position.direction);
      const existing = liveByKey.get(key);
      const openedAt = new Date(position.opened_at || 0).getTime();
      const existingOpenedAt = new Date(existing?.opened_at || 0).getTime();
      if (!existing || (openedAt > 0 && (existingOpenedAt <= 0 || openedAt < existingOpenedAt))) {
        liveByKey.set(key, position);
      }
    });
    const matchingFills = entries
      .filter(isOngoingFill)
      .filter((entry) => {
        const position = liveByKey.get(normalizedKey(entry.exchange, entry.symbol, entry.direction));
        if (!position) return false;
        const fillTime = new Date(entry.datetime || 0).getTime();
        const openedAt = new Date(position.opened_at || 0).getTime();
        return !Number.isFinite(openedAt) || openedAt <= 0 || fillTime >= openedAt - 5_000;
      })
      .sort((left, right) => new Date(right.datetime || 0).getTime() - new Date(left.datetime || 0).getTime());
    return { fills: matchingFills.slice(0, MAX_VISIBLE_FILLS), totalFillCount: matchingFills.length };
  }, [entries, positions]);

  const verificationUnavailable = hasLoadError || unavailableExchanges.length > 0;
  if (positions.length === 0 && !verificationUnavailable) return null;

  return <section className="border border-amber-400/30 bg-amber-400/5 p-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><CircleDot className="h-4 w-4 text-amber-300" />{isKo ? '진행중 포지션' : 'Open Positions'}</h2>
        <p className="mt-1 text-[11px] text-dark-400">{isKo ? '연결된 거래소에서 현재 열려 있는 SWAP 포지션만 표시합니다. 과거 체결과 종료 거래 통계는 포함하지 않습니다.' : 'Only current SWAP positions from connected exchanges are shown. Historic fills and closed-trade statistics are excluded.'}</p>
      </div>
      <span className="font-mono text-xs text-amber-300">{positions.length}{isKo ? '개' : ''}</span>
    </div>
    {verificationUnavailable && <p className="mt-3 border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-200">
      {hasLoadError
        ? (isKo ? '현재 포지션을 확인하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도하세요.' : 'Current positions could not be verified. Check the connection and try again.')
        : (isKo ? `${unavailableExchanges.join(', ')}의 현재 포지션을 확인하지 못했습니다.` : `Current positions could not be verified for ${unavailableExchanges.join(', ')}.`)}
    </p>}
    {positions.length > 0 && <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[680px] text-xs">
        <thead className="text-dark-500"><tr className="border-b border-dark-700"><th className="py-2 text-left">{isKo ? '거래소' : 'Exchange'}</th><th className="py-2 text-left">{isKo ? '진입시각' : 'Opened'}</th><th className="py-2 text-left">{isKo ? '종목' : 'Symbol'}</th><th className="py-2 text-center">{isKo ? '방향' : 'Side'}</th><th className="py-2 text-right">{isKo ? '평균 진입가' : 'Avg. entry'}</th><th className="py-2 text-right">{isKo ? '수량' : 'Size'}</th><th className="py-2 text-right">{isKo ? '레버리지' : 'Leverage'}</th><th className="py-2 text-right">{isKo ? '평가손익' : 'Unrealized PnL'}</th><th className="py-2 text-center">{isKo ? '상태' : 'Status'}</th></tr></thead>
        <tbody>{positions.map((position) => <tr key={`${position.exchange}-${position.position_id || `${position.symbol}-${position.direction}`}`} className="border-b border-dark-800 last:border-0"><td className="py-2 text-dark-300">{position.exchange}</td><td className="py-2 text-dark-300">{dateLabel(position.opened_at)}</td><td className="py-2 text-dark-200">{position.symbol}</td><td className={`py-2 text-center ${position.direction === 'Long' ? 'text-bull' : 'text-bear'}`}>{position.direction}</td><td className="py-2 text-right font-mono">{position.average_price?.toLocaleString(undefined, { maximumFractionDigits: 6 }) || '-'}</td><td className="py-2 text-right font-mono">{position.size.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td><td className="py-2 text-right font-mono">{position.leverage ? `${position.leverage}x` : '-'}</td><td className={`py-2 text-right font-mono ${(position.unrealized_pnl || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{position.unrealized_pnl == null ? '-' : `${position.unrealized_pnl >= 0 ? '+' : ''}${position.unrealized_pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT`}</td><td className="py-2 text-center"><span className="border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-300">{isKo ? '진행중' : 'OPEN'}</span></td></tr>)}</tbody>
      </table>
    </div>}
    {fills.length > 0 && <div className="mt-4 overflow-x-auto">
      <div className="mb-2 text-[11px] text-dark-500">{isKo ? `저장된 진입·부분 청산 체결${totalFillCount > fills.length ? ` (최근 ${MAX_VISIBLE_FILLS}건 / 전체 ${totalFillCount}건)` : ''}` : `Saved entry and partial-close fills${totalFillCount > fills.length ? ` (latest ${MAX_VISIBLE_FILLS} of ${totalFillCount})` : ''}`}</div>
      <table className="w-full min-w-[680px] text-xs"><thead className="text-dark-500"><tr className="border-b border-dark-700"><th className="py-2 text-left">{isKo ? '체결시각' : 'Fill time'}</th><th className="py-2 text-left">{isKo ? '종목' : 'Symbol'}</th><th className="py-2 text-center">{isKo ? '방향' : 'Side'}</th><th className="py-2 text-right">{isKo ? '체결가' : 'Price'}</th><th className="py-2 text-right">{isKo ? '수량' : 'Size'}</th><th className="py-2 text-center"><span className="sr-only">{isKo ? '리포트' : 'Report'}</span></th></tr></thead><tbody>{fills.map((row) => <tr key={row.id || row.external_id || `${row.symbol}-${row.datetime}`} className="border-b border-dark-800 last:border-0"><td className="py-2 text-dark-300">{dateLabel(row.datetime)}</td><td className="py-2 text-dark-200">{row.symbol || '-'}</td><td className={`py-2 text-center ${row.direction === 'Long' ? 'text-bull' : 'text-bear'}`}>{row.direction || '-'}</td><td className="py-2 text-right font-mono">{row.entry_price?.toLocaleString(undefined, { maximumFractionDigits: 6 }) || '-'}</td><td className="py-2 text-right font-mono">{row.size?.toLocaleString(undefined, { maximumFractionDigits: 6 }) || '-'}</td><td className="py-2 text-center"><button type="button" onClick={() => setSelected(row)} className="text-dark-400 hover:text-white" title={isKo ? '거래 리포트 열기' : 'Open trade report'}><CandlestickChart className="mx-auto h-4 w-4" /></button></td></tr>)}</tbody></table>
    </div>}
    {selected && <TradeReportModal entry={selected} allEntries={entries} isKo={isKo} onClose={() => setSelected(null)} />}
  </section>;
}
