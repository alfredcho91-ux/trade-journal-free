import { useState } from 'react';
import { CandlestickChart, CircleDot } from 'lucide-react';

import type { JournalEntry } from '../../types';
import TradeReportModal from '../journal/TradeReportModal';
import { isOngoingFill } from '../journal/journalEntries';

function dateLabel(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '-';
}

export default function OngoingPositionFills({ entries, isKo }: { entries: JournalEntry[]; isKo: boolean }) {
  const [selected, setSelected] = useState<JournalEntry | null>(null);
  const rows = entries.filter(isOngoingFill).sort((left, right) => new Date(right.datetime || 0).getTime() - new Date(left.datetime || 0).getTime());
  if (rows.length === 0) return null;

  return <section className="border border-amber-400/30 bg-amber-400/5 p-4">
    <div className="flex items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-sm font-semibold text-white"><CircleDot className="h-4 w-4 text-amber-300" />{isKo ? '진행중 포지션 체결' : 'Open Position Fills'}</h2><p className="mt-1 text-[11px] text-dark-400">{isKo ? '아직 종료 포지션으로 확정되지 않은 진입·부분 청산 체결입니다. 종료 통계에는 포함하지 않습니다.' : 'Entry and partial-close fills not finalized as closed positions. Excluded from closed-trade statistics.'}</p></div><span className="font-mono text-xs text-amber-300">{rows.length}{isKo ? '건' : ''}</span></div>
    <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[680px] text-xs"><thead className="text-dark-500"><tr className="border-b border-dark-700"><th className="py-2 text-left">{isKo ? '체결시각' : 'Fill time'}</th><th className="py-2 text-left">{isKo ? '종목' : 'Symbol'}</th><th className="py-2 text-center">{isKo ? '방향' : 'Side'}</th><th className="py-2 text-right">{isKo ? '체결가' : 'Price'}</th><th className="py-2 text-right">{isKo ? '수량' : 'Size'}</th><th className="py-2 text-center">{isKo ? '상태' : 'Status'}</th><th className="py-2 text-center"><span className="sr-only">{isKo ? '리포트' : 'Report'}</span></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id || row.external_id || `${row.symbol}-${row.datetime}`} className="border-b border-dark-800 last:border-0"><td className="py-2 text-dark-300">{dateLabel(row.datetime)}</td><td className="py-2 text-dark-200">{row.symbol || '-'}</td><td className={`py-2 text-center ${row.direction === 'Long' ? 'text-bull' : 'text-bear'}`}>{row.direction || '-'}</td><td className="py-2 text-right font-mono">{row.entry_price?.toLocaleString(undefined, { maximumFractionDigits: 6 }) || '-'}</td><td className="py-2 text-right font-mono">{row.size?.toLocaleString(undefined, { maximumFractionDigits: 6 }) || '-'}</td><td className="py-2 text-center"><span className="border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-300">{isKo ? '진행중' : 'OPEN'}</span></td><td className="py-2 text-center"><button type="button" onClick={() => setSelected(row)} className="text-dark-400 hover:text-white" title={isKo ? '거래 리포트 열기' : 'Open trade report'}><CandlestickChart className="mx-auto h-4 w-4" /></button></td></tr>)}</tbody></table></div>
    {selected && <TradeReportModal entry={selected} allEntries={entries} isKo={isKo} onClose={() => setSelected(null)} />}
  </section>;
}
