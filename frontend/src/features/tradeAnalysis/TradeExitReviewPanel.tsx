import type { TradeQualityItem } from '../../types';
import { buildExitReview, exitReviewConclusion, type ExitReviewRow } from './tradeExitReview';

function signed(value: number | null, digits = 2): string {
  if (value == null) return '-';
  return `${value >= 0 ? '+' : ''}${value.toLocaleString(undefined, { maximumFractionDigits: digits })}%`;
}

function rowValue(row: ExitReviewRow): string {
  return row.available ? signed(row.returnPct) : row.reason === 'not_triggered' ? '신호 없음' : '계산 불가';
}

export default function TradeExitReview({
  qualityItem,
  isKo,
}: {
  qualityItem?: TradeQualityItem | null;
  isKo: boolean;
}) {
  const review = buildExitReview(qualityItem);
  if (!review) {
    return <section className="mb-5 border border-dark-700 bg-dark-900/20 p-4 text-xs text-dark-400">
      {isKo ? '이 거래는 청산 복기에 필요한 4시간봉 시장 데이터가 부족합니다.' : 'This trade does not have enough 4H market data for an exit review.'}
    </section>;
  }

  return <details className="group mb-5 border border-dark-700 bg-dark-900/20" open>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-dark-900/50">
      <div>
        <div className="text-sm font-semibold text-white">{isKo ? '거래별 청산 복기' : 'Trade Exit Review'}</div>
        <div className="mt-0.5 text-[11px] text-dark-500">{isKo ? '실제 청산과 같은 진입을 다른 시점에 청산했을 때의 가격 수익률 비교' : 'Price-return comparison using the same entry and alternative exits'}</div>
      </div>
      <div className="text-right text-xs text-primary-200">{exitReviewConclusion(review)}</div>
    </summary>
    <div className="space-y-4 border-t border-dark-700 p-4">
      <div className="grid gap-px bg-dark-700 sm:grid-cols-4">
        <div className="bg-dark-950 p-3"><div className="text-[10px] text-dark-500">{isKo ? '실제 청산' : 'Actual exit'}</div><div className="mt-1 font-mono text-sm text-white">{signed(review.actual?.returnPct ?? null)}</div></div>
        <div className="bg-dark-950 p-3"><div className="text-[10px] text-dark-500">{isKo ? '청산 후 최대 추가 기회' : 'Best move after exit'}</div><div className="mt-1 font-mono text-sm text-bull">{signed(review.postExitMfePct)}</div></div>
        <div className="bg-dark-950 p-3"><div className="text-[10px] text-dark-500">{isKo ? '수익 구간을 챙긴 비율' : 'Profit captured'}</div><div className="mt-1 font-mono text-sm text-white">{review.captureRatioPct == null ? '-' : `${review.captureRatioPct.toFixed(1)}%`}</div></div>
        <div className="bg-dark-950 p-3"><div className="text-[10px] text-dark-500">{isKo ? '수익 반납 폭' : 'Profit given back'}</div><div className="mt-1 font-mono text-sm text-amber-300">{signed(review.profitGiveUpPct)}</div></div>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium text-dark-200">{isKo ? '조금 더 보유했다면' : 'If held longer'}</div>
        <div className="grid gap-px bg-dark-700 sm:grid-cols-3 lg:grid-cols-6">
          {[review.actual, ...review.holds].filter((row): row is ExitReviewRow => row != null).map((row) => <div key={row.id} className="bg-dark-950 p-2.5 text-center"><div className="text-[10px] text-dark-500">{row.label}</div><div className={`mt-1 font-mono text-sm ${row.returnPct != null && row.returnPct >= 0 ? 'text-bull' : 'text-bear'}`}>{rowValue(row)}</div></div>)}
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium text-dark-200">{isKo ? '보조지표 신호로 청산했다면' : 'If exited on an indicator signal'}</div>
        <div className="grid gap-x-6 md:grid-cols-2">
          {review.signals.map((row) => <div key={row.id} className="flex items-center justify-between gap-3 border-b border-dark-800 py-2 text-xs"><span className="text-dark-300">{row.label}</span><span className={`font-mono ${row.returnPct != null && row.returnPct >= 0 ? 'text-bull' : row.returnPct != null ? 'text-bear' : 'text-dark-500'}`}>{rowValue(row)}</span></div>)}
        </div>
      </div>
      <div className="text-[10px] leading-4 text-dark-500">{isKo ? '모든 값은 실제 진입가 기준의 가격 수익률입니다. 청산 뒤의 결과는 사후 복기용이며 실시간 추천 신호가 아닙니다.' : 'All values are price returns from the actual entry. Post-exit results are retrospective reviews, not live signals.'}</div>
    </div>
  </details>;
}
