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
}: {
  entries: JournalEntry[];
  qualityItems: TradeQualityItem[];
  direction: 'Long' | 'Short';
  isKo: boolean;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const entryById = useMemo(() => new Map(entries.flatMap((entry) => entry.id == null ? [] : [[entry.id, entry] as const])), [entries]);
  const rows = useMemo(() => qualityItems
    .filter((item) => item.direction === direction)
    .map((item) => ({ item, entry: entryById.get(item.journal_id), review: buildExitReview(item) }))
    .filter((row): row is { item: TradeQualityItem; entry: JournalEntry; review: ReturnType<typeof buildExitReview> } => Boolean(row.entry))
    .sort((left, right) => new Date(right.item.exit_datetime || 0).getTime() - new Date(left.item.exit_datetime || 0).getTime()), [direction, entryById, qualityItems]);
  const selectedEntry = selectedId == null ? undefined : entryById.get(selectedId);
  const selectedQuality = selectedId == null ? undefined : qualityItems.find((item) => item.journal_id === selectedId);

  return <section className="border border-dark-700 bg-dark-900/20">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-dark-700 px-4 py-3">
      <div>
        <h2 className="text-sm font-semibold text-white">{isKo ? '거래별 청산 복기' : 'Exit Review by Trade'}</h2>
        <p className="mt-1 text-[11px] text-dark-500">{isKo ? '최신 종료 거래부터 표시합니다. 행을 누르면 보유 기간·보조지표별 전체 비교를 볼 수 있습니다.' : 'Newest closed trades first. Select a row for complete hold and indicator comparisons.'}</p>
      </div>
      <span className="font-mono text-xs text-dark-400">{direction.toUpperCase()} · {rows.length}{isKo ? '건' : ' trades'}</span>
    </div>
    <div className="max-h-[620px] overflow-auto">
      <table className="w-full min-w-[860px] text-xs">
        <thead className="sticky top-0 bg-dark-900 text-dark-500"><tr className="border-b border-dark-700"><th className="px-4 py-2 text-left">{isKo ? '종료일' : 'Closed'}</th><th className="px-4 py-2 text-left">{isKo ? '거래' : 'Trade'}</th><th className="px-4 py-2 text-right">{isKo ? '실제 가격 수익률' : 'Actual return'}</th><th className="px-4 py-2 text-right">{isKo ? '청산 후 추가 기회' : 'After-exit opportunity'}</th><th className="px-4 py-2 text-left">{isKo ? '한 줄 결론' : 'Conclusion'}</th></tr></thead>
        <tbody>{rows.map(({ item, review }) => <tr key={item.journal_id} className="cursor-pointer border-b border-dark-800 hover:bg-dark-900/60" onClick={() => setSelectedId(item.journal_id)}>
          <td className="px-4 py-2.5 text-dark-400">{dateLabel(item.exit_datetime)}</td>
          <td className="px-4 py-2.5 text-dark-200"><span>{item.symbol} · <span className={item.direction === 'Long' ? 'text-bull' : 'text-bear'}>{item.direction}</span></span><CandlestickChart className="ml-1 inline h-3.5 w-3.5 text-primary-300" /></td>
          <td className={`px-4 py-2.5 text-right font-mono ${(review?.actual?.returnPct || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{signed(review?.actual?.returnPct ?? null)}</td>
          <td className="px-4 py-2.5 text-right font-mono text-primary-200">{signed(review?.postExitMfePct ?? null)}</td>
          <td className="px-4 py-2.5 text-dark-300">{exitReviewConclusion(review)}</td>
        </tr>)}</tbody>
      </table>
      {rows.length === 0 && <div className="p-6 text-center text-xs text-dark-500">{isKo ? '이 방향에서 청산 복기를 계산할 종료 거래가 없습니다.' : 'No closed trades with an exit review are available for this direction.'}</div>}
    </div>
    {selectedEntry && <TradeReportModal entry={selectedEntry} allEntries={entries} qualityItem={selectedQuality} isKo={isKo} onClose={() => setSelectedId(null)} />}
  </section>;
}
