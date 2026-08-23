import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, RefreshCw } from 'lucide-react';

import type {
  JournalStopLossAnalysisData,
  StopLossAnalysisItem,
  StopLossClassification,
  StopLossSummary,
} from '../../types';

type DisplayClass = Exclude<StopLossClassification, 'insufficient_data'>;

interface Props {
  data?: JournalStopLossAnalysisData;
  direction: 'Long' | 'Short';
  isLoading: boolean;
  isError: boolean;
  isKo: boolean;
  onRetry: () => void;
}

const CLASS_CONFIG: Array<{ id: DisplayClass; label: string; koLabel: string; tone: string }> = [
  { id: 'false_stop', label: 'False Stop', koLabel: '손절 위치 아쉬움', tone: 'text-amber-300' },
  { id: 'good_stop', label: 'Good Stop', koLabel: '적절한 손절', tone: 'text-bull' },
  { id: 'reversal_opportunity', label: 'Good Stop + Reversal', koLabel: '적절한 손절 + 반전 기회', tone: 'text-bear' },
  { id: 'noise_chop', label: 'Noise / Chop', koLabel: '횡보·소음', tone: 'text-dark-300' },
];

const REGIME_LABELS: Record<string, string> = {
  aligned_up: '주봉·일봉·4시간봉 상승 정렬',
  aligned_down: '주봉·일봉·4시간봉 하락 정렬',
  higher_up_4h_reentry: '상위 상승 추세로 4시간봉 재전환',
  higher_down_4h_reentry: '상위 하락 추세로 4시간봉 재전환',
  higher_up_4h_pullback: '상위 상승 추세 안의 4시간봉 조정',
  higher_down_4h_pullback: '상위 하락 추세 안의 4시간봉 반등',
  weekly_sideways_mid_up: '주봉 횡보·일봉/4시간봉 상승',
  weekly_sideways_mid_down: '주봉 횡보·일봉/4시간봉 하락',
  weekly_up_mid_down_conflict: '주봉 상승·일봉/4시간봉 하락 충돌',
  weekly_down_mid_up_conflict: '주봉 하락·일봉/4시간봉 상승 충돌',
  mixed: '주봉·일봉·4시간봉 혼합 추세',
  unavailable: '추세 확인 불가',
};

function number(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function signed(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${number(value, digits)}`;
}

function date(value: string | null | undefined): string {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString();
}

function trendArrow(item: StopLossAnalysisItem, interval: string): string {
  const direction = item.stop_trend_states?.[interval]?.direction;
  if (direction === 'up') return '↑';
  if (direction === 'down') return '↓';
  if (direction === 'sideways') return '→';
  return '?';
}

function entryReason(item: StopLossAnalysisItem, isKo: boolean): string {
  const regime = item.entry_market_regime;
  const expectedBias = item.direction === 'Long' ? 'up' : 'down';
  if (regime.alignment === 'conflict') {
    return isKo
      ? '진입 당시 주봉·일봉·4시간봉 방향이 서로 충돌해 방향성이 불명확했습니다.'
      : 'Weekly, Daily and 4H directions conflicted at entry.';
  }
  if (regime.trade_bias === 'neutral') {
    return isKo
      ? '진입 당시 상위 시간대에서 뚜렷한 주 방향을 확인하기 어려웠습니다.'
      : 'The higher-timeframe market bias was unclear at entry.';
  }
  if (regime.trade_bias !== expectedBias) {
    return isKo
      ? '진입 방향이 당시 상위 시간대의 주 추세와 반대였습니다.'
      : 'The trade was entered against the higher-timeframe bias.';
  }
  return isKo
    ? '진입 방향은 당시 상위 추세와 일치해 추세 측면의 뚜렷한 문제는 없었습니다.'
    : 'Entry direction agreed with the higher-timeframe bias.';
}

function entryNeedsReview(item: StopLossAnalysisItem): boolean {
  const expectedBias = item.direction === 'Long' ? 'up' : 'down';
  return item.entry_market_regime.alignment === 'conflict'
    || item.entry_market_regime.trade_bias === 'neutral'
    || item.entry_market_regime.trade_bias !== expectedBias;
}

function stopReviewLabel(item: StopLossAnalysisItem, isKo: boolean): string {
  if (!isKo) return 'Stop result';
  if (item.classification === 'false_stop') return '손절 아쉬운 이유';
  if (item.classification === 'reversal_opportunity') return '손절 후 아쉬운 점';
  return '손절 판단';
}

function stopResult(item: StopLossAnalysisItem, isKo: boolean): string {
  if (item.classification === 'false_stop') {
    return isKo
      ? '손절 직후 진입가를 회복하고 원래 방향으로 크게 움직였습니다. 손절 위치나 여유 폭을 다시 볼 거래입니다.'
      : 'Price recovered the entry and moved strongly in the original direction. Review stop placement and room.';
  }
  if (item.classification === 'good_stop') {
    return isKo
      ? '손절 후 가격이 계속 반대로 진행했습니다. 더 큰 손실을 막은 유효한 손절이었습니다.'
      : 'Price continued against the position after the stop, preventing a larger loss.';
  }
  if (item.classification === 'reversal_opportunity') {
    return isKo
      ? '손절 후 반대 방향으로 1% 이상 진행하고 4시간봉 추세도 전환됐습니다. 손절은 적절했고 반대 포지션 기회가 있었던 거래입니다.'
      : 'Price moved at least 1% against the original position and the 4H trend reversed. The stop was valid and a reversal setup followed.';
  }
  return isKo
    ? '손절 후 양쪽 모두 뚜렷하게 진행하지 않았습니다. 방향보다 횡보 소음의 영향이 컸습니다.'
    : 'Neither direction developed clearly after the stop; chop dominated.';
}

function overallConclusion(summary: StopLossSummary, isKo: boolean): string {
  if (summary.classified_stop_count === 0) {
    return isKo ? '아직 설명할 수 있는 확정 손절 표본이 없습니다.' : 'No classified confirmed stops are available yet.';
  }
  const dominant = CLASS_CONFIG.reduce((best, item) =>
    (summary.class_counts[item.id] || 0) > (summary.class_counts[best.id] || 0) ? item : best,
  );
  if (dominant.id === 'false_stop') {
    return isKo
      ? '현재는 진입 방향보다 손절 위치가 더 아쉽습니다. 손절 후 원래 방향을 회복한 거래가 가장 많았습니다.'
      : 'Stop placement is the main issue: most stopped trades recovered in the original direction.';
  }
  if (dominant.id === 'good_stop') {
    return isKo
      ? '현재 손절은 추가 손실을 막는 역할을 대체로 잘했습니다.'
      : 'Stops generally prevented larger losses.';
  }
  if (dominant.id === 'reversal_opportunity') {
    return isKo
      ? '손절 자체보다 손절 후 반대 추세를 놓친 경우가 가장 많았습니다.'
      : 'The main missed opportunity was the opposite trend after the stop.';
  }
  return isKo
    ? '손절 이후 횡보가 많아 손절 위치보다 진입 구간의 소음을 먼저 검토할 필요가 있습니다.'
    : 'Post-stop chop was most common; review noisy entry zones first.';
}

function hitText(hits: Record<string, boolean> | undefined): string {
  return ['1', '2', '3'].map((target) => `${target}R ${hits?.[target] ? '도달' : '미도달'}`).join(' · ');
}

function horizonText(item: StopLossAnalysisItem): string {
  return [1, 2, 3]
    .map((horizon) => {
      const result = item.horizon_results?.[String(horizon)];
      return `+${horizon}봉 ${result?.available ? `${signed(result.original_position_r)}R` : '-'}`;
    })
    .join(' · ');
}

function TradeDetails({ item, isKo }: { item: StopLossAnalysisItem; isKo: boolean }) {
  const targetHits = item.classification === 'false_stop'
    ? item.original_target_hits
    : item.reversal_target_hits;
  return (
    <div className="border-t border-dark-800 bg-dark-950/55 px-4 py-3">
      <div className="grid gap-x-6 gap-y-3 text-xs md:grid-cols-2 xl:grid-cols-3">
        <div>
          <div className="text-[10px] text-dark-600">{isKo ? '진입과 손절' : 'Entry and Stop'}</div>
          <div className="mt-1 font-mono text-dark-200">Entry {number(item.entry_price)} · SL {number(item.stop_price)}</div>
          <div className="mt-0.5 font-mono text-dark-500">1R {number(item.risk_amount)} · {number(item.risk_pct, 3)}%</div>
        </div>
        <div>
          <div className="text-[10px] text-dark-600">{isKo ? '손절 이후 움직임' : 'Post-Stop Movement'}</div>
          <div className="mt-1"><span className="text-bull">{isKo ? '원래 방향' : 'Original'} {number(item.original_direction_mfe_r, 2)}R ({number(item.original_direction_mfe_pct, 2)}%)</span> · <span className="text-bear">{isKo ? '반대 방향' : 'Opposite'} {number(item.opposite_direction_mfe_r, 2)}R ({number(item.opposite_direction_mfe_pct, 2)}%)</span></div>
          <div className="mt-0.5 text-dark-500">{isKo ? '진입가 회복' : 'Entry recovery'} {item.entry_recovered ? `+${item.recovery_bars}${isKo ? '봉' : ' bars'}` : '-'}</div>
        </div>
        <div>
          <div className="text-[10px] text-dark-600">R {isKo ? '목표' : 'Targets'}</div>
          <div className="mt-1 font-mono text-dark-300">{hitText(targetHits)}</div>
        </div>
        <div className="md:col-span-2">
          <div className="text-[10px] text-dark-600">{isKo ? '손절하지 않고 보유했을 때' : 'Original Position if Held'}</div>
          <div className="mt-1 font-mono text-dark-300">{horizonText(item)}</div>
        </div>
        <div>
          <div className="text-[10px] text-dark-600">{isKo ? '손절 당시 추세' : 'Trend at Stop'}</div>
          <div className="mt-1 font-mono text-dark-200">W {trendArrow(item, '1w')} · D {trendArrow(item, '1d')} · 4H {trendArrow(item, '4h')}</div>
          <div className="mt-0.5 text-dark-500">{REGIME_LABELS[item.entry_market_regime.id] || item.entry_market_regime.id}</div>
          {item.four_hour_reversal_bar && <div className="mt-0.5 text-bear">4H {isKo ? `반대 전환 +${item.four_hour_reversal_bar}봉` : `reversed at +${item.four_hour_reversal_bar}`}</div>}
        </div>
      </div>
      {item.opposite_trade && (
        <div className="mt-3 border-t border-dark-800 pt-2 text-xs text-dark-300">
          {isKo ? '실제 반대 포지션' : 'Actual opposite trade'}: {item.opposite_trade.direction} {signed(item.opposite_trade.realized_pnl)} USDT · <span className={(item.opposite_trade.combined_realized_pnl || 0) >= 0 ? 'text-bull' : 'text-bear'}>{isKo ? '손절 포함 최종' : 'Combined'} {signed(item.opposite_trade.combined_realized_pnl)} USDT</span>
        </div>
      )}
    </div>
  );
}

export default function StopLossAnalysis({ data, direction, isLoading, isError, isKo, onRetry }: Props) {
  const [selectedClass, setSelectedClass] = useState<DisplayClass>('false_stop');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const directionData = data?.direction_breakdown[direction];
  const directionItems = useMemo(
    () => data?.items.filter((item) => item.direction === direction) || [],
    [data?.items, direction],
  );
  const selectedItems = directionItems.filter((item) => item.classification === selectedClass);

  if (isLoading && !data) {
    return <section className="flex min-h-32 items-center justify-center border border-dark-700 bg-dark-900/20 text-xs text-dark-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{isKo ? '확정 손절 결과 정리 중' : 'Summarizing confirmed stop results'}</section>;
  }
  if (!data || !directionData) {
    return <section className="flex flex-wrap items-center justify-between gap-3 border border-bear/30 bg-bear/5 p-4 text-xs text-bear"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{isKo ? 'Stop-Loss 분석 데이터를 불러오지 못했습니다.' : 'Stop-loss analysis is unavailable.'}</span><button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 border border-bear/40 px-2.5 py-1.5"><RefreshCw className="h-3.5 w-3.5" />{isKo ? '다시 불러오기' : 'Retry'}</button></section>;
  }

  const summary = directionData.summary;
  const dominantRegime = directionData.regime_patterns[0];
  const historyLimited = Object.values(data.coverage.trigger_history).some((item) => item.history_limit_reached);

  return (
    <section className="border border-dark-700 bg-dark-900/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Stop-Loss {isKo ? '사후 분석' : 'Post Analysis'}</h2>
          <div className="mt-1 text-sm text-dark-200">{overallConclusion(summary, isKo)}</div>
          <div className="mt-1 text-[11px] text-dark-500">{direction} · {isKo ? `Deepcoin 확정 손절 ${summary.confirmed_stop_count}건` : `${summary.confirmed_stop_count} confirmed Deepcoin stops`}</div>
        </div>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-dark-400" />}
      </div>

      <div className="mt-4 grid gap-px bg-dark-700 sm:grid-cols-2 xl:grid-cols-4">
        {CLASS_CONFIG.map((config) => {
          const count = summary.class_counts[config.id] || 0;
          const selected = selectedClass === config.id;
          return (
            <button key={config.id} type="button" onClick={() => { setSelectedClass(config.id); setExpandedId(null); }} className={`min-h-16 bg-dark-950 p-3 text-left transition-colors ${selected ? 'bg-primary-500/10' : 'hover:bg-dark-900'}`}>
              <div className={`text-xs font-medium ${config.tone}`}>{isKo ? config.koLabel : config.label}</div>
              <div className="mt-1 text-[11px] text-dark-500">{count}{isKo ? '건' : ''} · {number(summary.class_pct[config.id])}%</div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 space-y-2">
        {selectedItems.map((item) => {
          const expanded = expandedId === item.journal_id;
          return (
            <article key={item.journal_id} className="border border-dark-800 bg-dark-950/25">
              <button type="button" onClick={() => setExpandedId(expanded ? null : item.journal_id)} className="flex w-full items-start justify-between gap-4 p-4 text-left" aria-expanded={expanded}>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-white">{item.symbol} · {item.direction} <span className="font-normal text-dark-600">{date(item.exit_datetime)}</span></div>
                  <div className="mt-2 text-xs leading-5"><span className="text-dark-500">{isKo ? (entryNeedsReview(item) ? '진입 아쉬운 이유' : '진입 판단') : 'Entry review'}:</span> <span className="text-dark-300">{entryReason(item, isKo)}</span></div>
                  <div className="mt-1 text-xs leading-5"><span className="text-dark-500">{stopReviewLabel(item, isKo)}:</span> <span className="text-dark-200">{stopResult(item, isKo)}</span></div>
                </div>
                {expanded ? <ChevronUp className="mt-0.5 h-4 w-4 shrink-0 text-dark-400" /> : <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-dark-400" />}
              </button>
              {expanded && <TradeDetails item={item} isKo={isKo} />}
            </article>
          );
        })}
        {selectedItems.length === 0 && <div className="border border-dark-800 py-8 text-center text-xs text-dark-600">{isKo ? '해당 결과의 확정 손절이 없습니다.' : 'No confirmed stops have this result.'}</div>}
      </div>

      {dominantRegime && (
        <div className="mt-4 border-t border-dark-700 pt-3 text-xs text-dark-400">
          <span className="text-dark-500">{isKo ? '자주 나온 진입 환경' : 'Common entry environment'}:</span> {REGIME_LABELS[dominantRegime.id] || dominantRegime.id} · {dominantRegime.stop_count}{isKo ? '건' : ''}. {isKo ? '표본이 적으면 참고 수준으로만 봅니다.' : 'Treat small samples as descriptive only.'}
        </div>
      )}
      {summary.pending_stop_count > 0 && <div className="mt-2 text-[11px] text-amber-300">{isKo ? `후속 4H 봉 부족 ${summary.pending_stop_count}건은 결과 비율에서 제외했습니다.` : `${summary.pending_stop_count} stops await completed 4H candles.`}</div>}
      {historyLimited && <div className="mt-2 text-[11px] text-amber-300">{isKo ? 'Deepcoin의 종목별 최신 주문 100건 제한으로 이전 손절은 누락될 수 있습니다.' : 'Older stops may be missing because Deepcoin limits each symbol to 100 trigger orders.'}</div>}

      <details className="mt-4 border-t border-dark-700 pt-3 text-[11px] text-dark-400" open>
        <summary className="cursor-pointer font-medium text-dark-200">{isKo ? '결과 분류 기준' : 'Classification Rules'}</summary>
        <div className="mt-2 space-y-1.5">
          <div>1R = {isKo ? '진입가와 실제 Deepcoin SL 사이 거리' : 'distance from entry to the confirmed Deepcoin SL'}</div>
          <div>{isKo ? '손절 위치 아쉬움' : 'False Stop'} = {isKo ? '진입가 회복 + 원래 방향 2R 이상 + 반대 움직임보다 1.25배 이상' : 'entry recovery + original move ≥ 2R + 1.25x dominance'}</div>
          <div>{isKo ? '적절한 손절' : 'Good Stop'} = {isKo ? '손절 후 원래 포지션의 반대 방향으로 1% 이상 진행' : 'price moves at least 1% against the original position after the stop'}</div>
          <div>{isKo ? '적절한 손절 + 반전 기회' : 'Good Stop + Reversal'} = {isKo ? '적절한 손절 조건 + 반대 방향 2R 이상 + 4시간봉 반대 추세 전환' : 'good-stop condition + opposite move ≥ 2R + opposite 4H trend transition'}</div>
          <div>{isKo ? '횡보·소음' : 'Noise / Chop'} = {isKo ? '나머지 확정 손절' : 'all remaining confirmed stops'}</div>
        </div>
      </details>

      {isError && <div className="mt-3 flex items-center justify-between text-[11px] text-amber-300"><span>{isKo ? '최신 갱신에 실패해 이전 결과를 표시합니다.' : 'Showing the previous result because refresh failed.'}</span><button type="button" onClick={onRetry} className="inline-flex items-center gap-1"><RefreshCw className="h-3 w-3" />{isKo ? '재시도' : 'Retry'}</button></div>}
    </section>
  );
}
