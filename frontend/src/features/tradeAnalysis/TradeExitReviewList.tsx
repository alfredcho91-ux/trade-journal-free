import { useMemo, useState } from 'react';
import { CandlestickChart } from 'lucide-react';

import type { JournalEntry, TradeQualityItem } from '../../types';
import TradeReportModal from '../journal/TradeReportModal';
import { buildExitReview, exitReviewConclusion } from './tradeExitReview';

function dateLabel(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '-';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function signed(value: number | null): string {
  if (value == null) return '-';
  return `${value >= 0 ? '+' : ''}${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

export default function TradeExitReviewList({
  entries,
  qualityItems,
  direction,
  isKo,
  onViewAll,
}: {
  entries: JournalEntry[];
  qualityItems: TradeQualityItem[];
  direction: 'Long' | 'Short';
  isKo: boolean;
  onViewAll?: (journalIds: number[]) => void;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'win' | 'loss' | 'early' | 'poor'>('all');
  const entryById = useMemo(() => new Map(entries.flatMap((entry) => entry.id == null ? [] : [[entry.id, entry] as const])), [entries]);
  const rows = useMemo(() => qualityItems
    .filter((item) => item.direction === direction)
    .map((item) => ({ item, entry: entryById.get(item.journal_id), review: buildExitReview(item) }))
    .filter((row): row is { item: TradeQualityItem; entry: JournalEntry; review: ReturnType<typeof buildExitReview> } => Boolean(row.entry))
    .sort((left, right) => new Date(right.item.exit_datetime || 0).getTime() - new Date(left.item.exit_datetime || 0).getTime()), [direction, entryById, qualityItems]);
  const selectedEntry = selectedId == null ? undefined : entryById.get(selectedId);
  const selectedQuality = selectedId == null ? undefined : qualityItems.find((item) => item.journal_id === selectedId);
  const filteredRows = useMemo(() => rows.filter(({ item, review }) => {
    if (filter === 'win') return (review?.actual?.returnPct ?? 0) > 0;
    if (filter === 'loss') return (review?.actual?.returnPct ?? 0) < 0;
    if (filter === 'early') return item.quality_class === 'good_entry_early_exit';
    if (filter === 'poor') return item.quality_class === 'poor_entry';
    return true;
  }), [filter, rows]);
  const visibleRows = filteredRows.slice(0, 6);

  const selectFilter = (next: typeof filter) => {
    setFilter(next);
  };

  return <section className="overflow-hidden rounded-[14px] border border-dark-700 bg-dark-900/20">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-dark-700 px-4 py-4">
      <div>
        <h2 className="text-sm font-semibold text-white">{isKo ? '거래별 청산 복기' : 'Exit Review by Trade'}</h2>
        <p className="mt-1 text-[11px] text-dark-500">{isKo ? '최신 거래부터 표시합니다. 거래를 누르면 해당 1건의 리포트를 엽니다.' : 'Newest trades first. Select a trade to open its single-trade report.'}</p>
      </div>
      <div className="flex items-center gap-3"><span className="font-mono text-xs text-dark-400">{direction.toUpperCase()} · {rows.length}{isKo ? '건' : ' trades'}</span>{onViewAll && <button type="button" onClick={() => onViewAll(filteredRows.map(({ item }) => item.journal_id))} className="text-xs text-primary-200 hover:text-white hover:underline">{isKo ? '전체 거래 보기 →' : 'View all →'}</button>}</div>
    </div>
    <div className="flex flex-wrap gap-1.5 border-b border-dark-700 px-4 py-2.5">
      {([
        ['all', isKo ? '전체' : 'All'],
        ['win', isKo ? '승리' : 'Wins'],
        ['loss', isKo ? '패배' : 'Losses'],
        ['early', isKo ? '조기 청산' : 'Early exit'],
        ['poor', isKo ? '진입 불리' : 'Poor entry'],
      ] as const).map(([id, label]) => <button key={id} type="button" onClick={() => selectFilter(id)} className={`border px-2.5 py-1 text-[11px] transition-colors ${filter === id ? 'border-primary-400/70 bg-primary-500/15 text-primary-100' : 'border-dark-700 bg-dark-950/60 text-dark-400 hover:text-white'}`}>{label}</button>)}
      <span className="ml-auto self-center text-[11px] text-dark-600">{filteredRows.length}{isKo ? '건' : ''}</span>
    </div>
    <div className="hidden max-h-[620px] overflow-auto md:block">
      <table className="w-full min-w-[900px] text-xs">
        <thead className="sticky top-0 bg-dark-900 text-dark-500"><tr className="border-b border-dark-700"><th className="px-4 py-2.5 text-left">{isKo ? '날짜' : 'Date'}</th><th className="px-4 py-2.5 text-left">{isKo ? '거래' : 'Trade'}</th><th className="px-4 py-2.5 text-right">{isKo ? '실제 수익률' : 'Return'}</th><th className="px-4 py-2.5 text-right">{isKo ? '최대 유리 움직임' : 'Favorable move'}</th><th className="px-4 py-2.5 text-right">{isKo ? '최대 불리 움직임' : 'Adverse move'}</th><th className="px-4 py-2.5 text-left">{isKo ? '핵심 판정' : 'Key judgment'}</th><th className="px-4 py-2.5 text-right">{isKo ? '리포트' : 'Report'}</th></tr></thead>
        <tbody>{visibleRows.map(({ item, review }) => <tr key={item.journal_id} className="cursor-pointer border-b border-dark-800 hover:bg-dark-900/60" onClick={() => setSelectedId(item.journal_id)}>
          <td className="px-4 py-2.5 text-dark-400">{dateLabel(item.exit_datetime)}</td>
          <td className="px-4 py-2.5 text-dark-200"><span>{item.symbol} · <span className={item.direction === 'Long' ? 'text-bull' : 'text-bear'}>{item.direction}</span></span><CandlestickChart className="ml-1 inline h-3.5 w-3.5 text-primary-300" /></td>
          <td className={`px-4 py-2.5 text-right font-mono ${(review?.actual?.returnPct || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{signed(review?.actual?.returnPct ?? null)}</td>
          <td className="px-4 py-2.5 text-right font-mono text-bull">+{Math.abs(item.excursion?.mfe_pct ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}%</td>
          <td className="px-4 py-2.5 text-right font-mono text-bear">-{Math.abs(item.excursion?.mae_pct ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}%</td>
          <td className="max-w-[280px] truncate px-4 py-2.5 text-dark-300">{exitReviewConclusion(review)}</td>
          <td className="px-4 py-2.5 text-right text-primary-200">{isKo ? '보기 →' : 'Open →'}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="space-y-2 p-3 md:hidden">
      {visibleRows.map(({ item, review }) => <button key={item.journal_id} type="button" className="w-full rounded-xl border border-dark-700 bg-dark-950/70 p-3 text-left hover:border-primary-400/60" onClick={() => setSelectedId(item.journal_id)}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-dark-100">{item.symbol} · <span className={item.direction === 'Long' ? 'text-bull' : 'text-bear'}>{item.direction}</span></div>
            <div className="mt-1 text-[10px] text-dark-500">{dateLabel(item.exit_datetime)} · {exitReviewConclusion(review)}</div>
          </div>
          <div className={`font-mono text-sm ${(review?.actual?.returnPct || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{signed(review?.actual?.returnPct ?? null)}</div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]"><span className="rounded-lg bg-dark-900 p-2 text-dark-500">{isKo ? '청산 후 기회' : 'After exit'}<b className="mt-1 block font-mono text-primary-200">{signed(review?.postExitMfePct ?? null)}</b></span><span className="rounded-lg bg-dark-900 p-2 text-dark-500">{isKo ? '보유시간' : 'Holding'}<b className="mt-1 block font-mono text-dark-200">{item.holding_minutes ? `${Math.round(item.holding_minutes / 60)}h` : '-'}</b></span><span className="rounded-lg bg-dark-900 p-2 text-dark-500">{isKo ? '리포트' : 'Report'}<b className="mt-1 block text-primary-200">{isKo ? '열기 →' : 'Open →'}</b></span></div>
      </button>)}
    </div>
    {filteredRows.length === 0 && <div className="p-6 text-center text-xs text-dark-500">{isKo ? '이 조건에 맞는 종료 거래가 없습니다.' : 'No closed trades match this filter.'}</div>}
    {filteredRows.length > visibleRows.length && <div className="border-t border-dark-700 p-3 text-center text-[11px] text-dark-500">{isKo ? `최근 ${visibleRows.length}건만 표시합니다.` : `Showing the latest ${visibleRows.length} trades.`}</div>}
    {selectedEntry && <TradeReportModal entry={selectedEntry} allEntries={entries} qualityItem={selectedQuality} isKo={isKo} onClose={() => setSelectedId(null)} />}
  </section>;
}
