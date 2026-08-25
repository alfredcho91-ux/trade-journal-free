import { useMemo, useState } from 'react';

import TradeReportModal from '../journal/TradeReportModal';
import { netReturnPct } from '../journal/journalReturns';
import type { JournalEntry, TradeQualityItem } from '../../types';
import type { AnalyzedTrade } from './tradeAnalysis';
import type { EvidenceRequest } from './evidenceNavigation';

function plain(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '-' : value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function signed(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '-' : `${value >= 0 ? '+' : ''}${plain(value, digits)}`;
}

function dateLabel(value: string | null | undefined, isKo: boolean): string {
  if (!value) return '-';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '-';
  return new Intl.DateTimeFormat(isKo ? 'ko-KR' : 'en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function exitPointLabel(holdId: string, interval: NonNullable<EvidenceRequest['exitHold']>['interval'], isKo: boolean): string {
  if (holdId === 'actual') return isKo ? '실제 청산' : 'Actual exit';
  return isKo ? `청산 후 +${holdId}봉` : `After +${holdId} ${interval.toUpperCase()} candles`;
}

function qualityLabel(item: TradeQualityItem | undefined, isKo: boolean): string {
  if (!item) return '-';
  const labels: Record<string, string> = {
    good_entry_good_exit: '진입·청산 양호',
    good_entry_early_exit: '진입 양호·조기 청산',
    good_entry_late_exit: '진입 양호·늦은 청산',
    poor_entry: '진입 불리',
    unavailable: '판정 불가',
  };
  return isKo ? labels[item.quality_class] || item.quality_class : item.quality_class.replace(/_/g, ' ');
}

export default function EvidenceTradePanel({
  request,
  trades,
  qualityItems,
  entries,
  isKo,
  onClear,
}: {
  request: EvidenceRequest;
  trades: AnalyzedTrade[];
  qualityItems: TradeQualityItem[];
  entries: JournalEntry[];
  isKo: boolean;
  onClear: () => void;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const qualityById = useMemo(() => new Map(qualityItems.map((item) => [item.journal_id, item])), [qualityItems]);
  const rows = useMemo(() => trades
    .filter((trade) => trade.entry.id != null && request.tradeIds.includes(trade.entry.id))
    .sort((left, right) => new Date(right.entry.datetime || right.entry.entry_datetime || 0).getTime() - new Date(left.entry.datetime || left.entry.entry_datetime || 0).getTime()), [request.tradeIds, trades]);
  const visibleRows = showAll ? rows : rows.slice(0, 10);
  const holdContext = request.exitHold;
  const selectedTrade = selectedId == null ? undefined : rows.find((trade) => trade.entry.id === selectedId);
  const selectedQuality = selectedId == null ? undefined : qualityById.get(selectedId);

  return (
    <section className="border border-primary-400/35 bg-dark-950/55 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="inline-flex border border-primary-400/35 bg-primary-500/10 px-2 py-1 text-[10px] text-primary-200">{isKo ? '근거 필터 적용' : 'Evidence filter active'}</span>
          <h2 className="mt-2 text-base font-semibold text-white">{request.title}</h2>
          <div className="mt-1 text-xs text-dark-400">{request.filterLabel}</div>
          <div className="mt-1 text-[11px] text-dark-500">{isKo ? '거래를 누르면 해당 1건의 차트 복기를 엽니다.' : 'Select a trade to open its single-trade review.'}</div>
        </div>
        <button type="button" onClick={onClear} className="border border-dark-700 px-2.5 py-1.5 text-xs text-dark-300 hover:border-dark-400 hover:text-white">{isKo ? '근거 필터 해제' : 'Clear evidence filter'}</button>
      </div>

      <div className="mt-4 hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] text-xs">
          <thead className="text-dark-500"><tr className="border-b border-dark-700"><th className="py-2 text-left">{isKo ? '날짜' : 'Date'}</th><th className="py-2 text-left">{isKo ? '거래' : 'Trade'}</th>{holdContext ? <><th className="py-2 text-right">{isKo ? '실제 청산' : 'Actual exit'}</th><th className="py-2 text-right">{exitPointLabel(holdContext.holdId, holdContext.interval, isKo)}</th><th className="py-2 text-right">{isKo ? '차이' : 'Difference'}</th></> : <><th className="py-2 text-right">{isKo ? '수익률' : 'Return'}</th><th className="py-2 text-right">{isKo ? '유리한 움직임' : 'Favorable move'}</th><th className="py-2 text-right">{isKo ? '불리한 움직임' : 'Adverse move'}</th></>}<th className="py-2 text-right">PnL</th><th className="py-2 text-right">{isKo ? '리포트' : 'Report'}</th></tr></thead>
          <tbody>{visibleRows.map((trade) => {
            const entry = trade.entry;
            const holdResult = entry.id == null ? undefined : holdContext?.resultsByJournalId[entry.id];
            return <tr key={entry.id} className="border-b border-dark-800 hover:bg-dark-900/50"><td className="py-2 text-dark-300">{dateLabel(holdResult?.exitTime || entry.datetime || entry.entry_datetime, isKo)}</td><td className="py-2 text-dark-200">{entry.symbol || '-'} · {entry.direction || '-'}</td>{holdContext ? <><td className="py-2 text-right font-mono">{signed(holdResult?.actualReturnPct)}%</td><td className="py-2 text-right font-mono">{signed(holdResult?.holdReturnPct)}%</td><td className={`py-2 text-right font-mono ${(holdResult?.differencePct || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{holdResult?.differencePct == null ? '-' : `${signed(holdResult.differencePct)}%p`}</td></> : <><td className="py-2 text-right font-mono">{signed(netReturnPct(entry))}%</td><td className="py-2 text-right font-mono text-bull">{plain(trade.excursion?.mfe_pct)}%</td><td className="py-2 text-right font-mono text-bear">{plain(trade.excursion?.mae_pct)}%</td></>}<td className={`py-2 text-right font-mono ${(entry.realized_pnl || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{signed(entry.realized_pnl)} USDT</td><td className="py-2 text-right"><button type="button" onClick={() => setSelectedId(entry.id as number)} className="text-primary-200 hover:text-white">{qualityLabel(entry.id == null ? undefined : qualityById.get(entry.id), isKo)} · {isKo ? '보기 →' : 'Open →'}</button></td></tr>;
          })}</tbody>
        </table>
      </div>
      <div className="mt-4 space-y-2 md:hidden">{visibleRows.map((trade) => {
        const entry = trade.entry;
        return <button key={entry.id} type="button" onClick={() => setSelectedId(entry.id as number)} className="w-full border border-dark-700 bg-dark-950/60 p-3 text-left hover:border-primary-400/50"><div className="flex items-start justify-between gap-2"><span className="text-xs text-dark-200">{entry.symbol || '-'} · {entry.direction || '-'}</span><span className={`font-mono text-xs ${(entry.realized_pnl || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{signed(entry.realized_pnl)} USDT</span></div><div className="mt-1 text-[11px] text-dark-500">{dateLabel(entry.datetime || entry.entry_datetime, isKo)} · {qualityLabel(entry.id == null ? undefined : qualityById.get(entry.id), isKo)}</div></button>;
      })}</div>
      {rows.length === 0 && <div className="py-6 text-center text-xs text-dark-500">{isKo ? '표시할 거래가 없습니다.' : 'No matching trades.'}</div>}
      {rows.length > visibleRows.length && <div className="mt-4 text-center"><button type="button" onClick={() => setShowAll(true)} className="border border-dark-700 px-3 py-2 text-xs text-primary-200 hover:border-primary-400">{isKo ? `전체 ${rows.length}건 보기` : `View all ${rows.length} trades`}</button></div>}
      {selectedTrade && <TradeReportModal entry={selectedTrade.entry} allEntries={entries} excursion={selectedTrade.excursion} qualityItem={selectedQuality} isKo={isKo} onClose={() => setSelectedId(null)} />}
    </section>
  );
}
