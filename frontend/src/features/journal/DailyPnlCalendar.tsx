import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

import type { JournalPeriod } from './journalPeriod';
import { dailyPnlByCloseDate, monthlyPnlByCloseMonth } from './dailyPnlUtils';
import type { JournalEntry } from '../../types';

function monthStart(value: string): Date {
  const date = new Date(`${value || '1970-01-01'}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthIndex(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth();
}

function formatSignedPnl(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export default function DailyPnlCalendar({
  trades,
  period,
  isKo,
}: {
  trades: JournalEntry[];
  period: JournalPeriod;
  isKo: boolean;
}) {
  const endMonth = useMemo(() => monthStart(period.end), [period.end]);
  const startMonth = useMemo(() => monthStart(period.start), [period.start]);
  const [visibleMonth, setVisibleMonth] = useState(endMonth);

  useEffect(() => {
    setVisibleMonth(endMonth);
  }, [endMonth]);

  const dailyPnl = useMemo(() => dailyPnlByCloseDate(trades), [trades]);
  const availableMonths = useMemo(() => Object.keys(dailyPnl).map((dateKey) => monthStart(dateKey)), [dailyPnl]);
  const firstAvailableMonth = useMemo(
    () => availableMonths.reduce<Date | null>((earliest, month) => (!earliest || month < earliest ? month : earliest), null),
    [availableMonths],
  );
  const lastAvailableMonth = useMemo(
    () => availableMonths.reduce<Date | null>((latest, month) => (!latest || month > latest ? month : latest), null),
    [availableMonths],
  );
  const firstWeekday = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1).getDay();
  const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
  const monthKey = `${visibleMonth.getFullYear()}-${String(visibleMonth.getMonth() + 1).padStart(2, '0')}`;
  const monthlyPnl = useMemo(() => monthlyPnlByCloseMonth(trades), [trades]);
  const monthSummary = monthlyPnl[monthKey] || { pnl: 0, tradeCount: 0 };
  const minimumMonth = firstAvailableMonth || startMonth;
  const maximumMonth = lastAvailableMonth || endMonth;
  const canGoPrevious = monthIndex(visibleMonth) > monthIndex(minimumMonth);
  const canGoNext = monthIndex(visibleMonth) < monthIndex(maximumMonth);
  const weekdayLabels = isKo ? ['일', '월', '화', '수', '목', '금', '토'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthLabel = new Intl.DateTimeFormat(isKo ? 'ko-KR' : 'en-US', { year: 'numeric', month: 'long' }).format(visibleMonth);
  const cells = Array.from({ length: firstWeekday + daysInMonth }, (_, index) => index < firstWeekday ? null : index - firstWeekday + 1);

  return (
    <section className="mt-4 border border-dark-700 bg-dark-900/35 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><CalendarDays className="h-4 w-4 text-primary-300" />{isKo ? '일별 수익 / 손실' : 'Daily Profit / Loss'}</h3>
          <p className="mt-1 text-[11px] text-dark-500">{isKo ? '종료일 기준 순실현손익 합계 · 선택한 달의 기록을 월 전체로 표시' : 'Net realized PnL by close date · shows the full selected month'}</p>
          <div className={`mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs ${monthSummary.pnl >= 0 ? 'text-bull' : 'text-bear'}`}>
            <span className="text-[10px] text-dark-500">{isKo ? '월간 누적 손익' : 'Monthly cumulative PnL'}</span>
            <span className="font-mono font-bold">{formatSignedPnl(monthSummary.pnl)} USDT</span>
            <span className="text-[10px] text-dark-500">{monthSummary.tradeCount}{isKo ? '건 종료' : ' closed'}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setVisibleMonth((value) => new Date(value.getFullYear(), value.getMonth() - 1, 1))} disabled={!canGoPrevious} className="grid h-7 w-7 place-items-center border border-dark-700 text-dark-300 hover:border-dark-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-35" aria-label={isKo ? '이전 달' : 'Previous month'}><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-28 text-center text-xs font-medium text-dark-200">{monthLabel}</span>
          <button type="button" onClick={() => setVisibleMonth((value) => new Date(value.getFullYear(), value.getMonth() + 1, 1))} disabled={!canGoNext} className="grid h-7 w-7 place-items-center border border-dark-700 text-dark-300 hover:border-dark-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-35" aria-label={isKo ? '다음 달' : 'Next month'}><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-l border-t border-dark-800">
        {weekdayLabels.map((label, index) => <div key={label} className={`border-b border-r border-dark-800 py-1.5 text-center text-[10px] ${index === 0 ? 'text-bear/80' : index === 6 ? 'text-primary-300/80' : 'text-dark-500'}`}>{label}</div>)}
        {cells.map((day, index) => {
          if (day == null) return <div key={`blank-${index}`} className="min-h-[62px] border-b border-r border-dark-800 bg-dark-950/20" />;
          const key = `${monthKey}-${String(day).padStart(2, '0')}`;
          const summary = dailyPnl[key];
          const tone = !summary ? 'bg-dark-950/10' : summary.pnl > 0 ? 'bg-bull/10' : summary.pnl < 0 ? 'bg-bear/10' : 'bg-dark-800/40';
          const valueTone = !summary ? 'text-dark-500' : summary.pnl > 0 ? 'text-bull' : summary.pnl < 0 ? 'text-bear' : 'text-dark-300';
          const title = summary ? `${key}: ${formatSignedPnl(summary.pnl)} USDT (${summary.tradeCount}${isKo ? '건' : ' trades'})` : key;
          return (
            <div key={key} title={title} className={`min-h-[62px] border-b border-r border-dark-800 px-1.5 py-1.5 sm:min-h-[70px] ${tone}`}>
              <div className="text-[10px] text-dark-500">{day}</div>
              {summary && <><div className={`mt-1 truncate font-mono text-[11px] font-bold sm:text-xs ${valueTone}`}>{formatSignedPnl(summary.pnl)}</div><div className="mt-0.5 text-[9px] text-dark-500">{summary.tradeCount}{isKo ? '건' : 'T'}</div></>}
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-dark-500">
        <span><i className="mr-1 inline-block h-2 w-2 bg-bull/70" />{isKo ? '수익일' : 'Profit day'}</span>
        <span><i className="mr-1 inline-block h-2 w-2 bg-bear/70" />{isKo ? '손실일' : 'Loss day'}</span>
        <span>{isKo ? '금액 단위: USDT' : 'Amounts in USDT'}</span>
      </div>
    </section>
  );
}
