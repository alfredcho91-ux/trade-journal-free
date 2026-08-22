import { AlertTriangle, ChevronDown, Loader2, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';

import type {
  JournalQualityAnalysisData,
  TradeQualityBestExit,
  TradeQualityGroup,
  TradeQualityRegime,
} from '../../types';

interface Props {
  data?: JournalQualityAnalysisData;
  isLoading: boolean;
  isError: boolean;
  isKo: boolean;
  direction: 'Long' | 'Short';
  onRetry: () => void;
}

const REGIME_LABELS: Record<string, string> = {
  aligned_up: '주·일·4H 강한 상승 정렬',
  aligned_down: '주·일·4H 강한 하락 정렬',
  higher_up_4h_reentry: '상위 상승 추세로 4H 재전환',
  higher_down_4h_reentry: '상위 하락 추세로 4H 재전환',
  higher_up_4h_pullback: '상위 상승 추세 내 4H 조정',
  higher_down_4h_pullback: '상위 하락 추세 내 4H 반등',
  weekly_sideways_mid_up: '주봉 횡보·일/4H 상승',
  weekly_sideways_mid_down: '주봉 횡보·일/4H 하락',
  weekly_up_mid_down_conflict: '주봉 상승·일/4H 하락 충돌',
  weekly_down_mid_up_conflict: '주봉 하락·일/4H 상승 충돌',
  weekly_up_mid_sideways_conflict: '주봉 상승·일/4H 횡보 충돌',
  weekly_down_mid_sideways_conflict: '주봉 하락·일/4H 횡보 충돌',
  mixed: '혼합 추세',
  unavailable: '추세 확인 불가',
};

const STRATEGY_LABELS: Record<string, string> = {
  rsi_overheat: 'RSI 과열 도달',
  stoch_rsi_overheat: 'Stoch RSI 과열 도달',
  slow_5_overheat: 'Slow 5-3-3 과열 도달',
  slow_10_overheat: 'Slow 10-6-6 과열 도달',
  slow_20_overheat: 'Slow 20-12-12 과열 도달',
  slow_5_cross: 'Slow 5-3-3 과열 후 반대 크로스',
  slow_10_cross: 'Slow 10-6-6 과열 후 반대 크로스',
  slow_20_cross: 'Slow 20-12-12 과열 후 반대 크로스',
  macd_weakening: 'MACD 모멘텀 약화',
  atr_trailing_stop: 'ATR 트레일링 스톱',
};

function number(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function signed(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${number(value, digits)}`;
}

function regimeLabel(id: string, isKo: boolean): string {
  return isKo ? REGIME_LABELS[id] || id : id.replace(/_/g, ' ');
}

function strategyLabel(id: string, isKo: boolean): string {
  return isKo ? STRATEGY_LABELS[id] || id : id.replace(/_/g, ' ');
}

function sampleLabel(regime: TradeQualityRegime, isKo: boolean): string {
  if (regime.sample_quality === 'low') return isKo ? '표본 적음' : 'Low sample';
  if (regime.sample_quality === 'medium') return isKo ? '보통 표본' : 'Medium sample';
  return isKo ? '충분한 표본' : 'Strong sample';
}

function bestExitLabel(exit: TradeQualityBestExit | null | undefined, isKo: boolean): string {
  if (!exit) return '-';
  if (exit.type === 'hold') {
    return exit.id === 'actual' ? (isKo ? '실제 청산' : 'Actual exit') : `+${exit.id}${isKo ? '봉 홀딩' : ' bars'}`;
  }
  return strategyLabel(exit.id, isKo);
}

function group(data: TradeQualityGroup[], id: string): TradeQualityGroup | undefined {
  return data.find((item) => item.id === id);
}

export default function TradeQualityAnalysis({ data, isLoading, isError, isKo, direction, onRetry }: Props) {
  if (isLoading && !data) {
    return (
      <section className="flex min-h-40 items-center justify-center border border-dark-700 bg-dark-900/20 text-xs text-dark-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {isKo ? '주봉·일봉·4시간봉 품질 분석 중' : 'Analyzing Weekly, Daily and 4H quality'}
      </section>
    );
  }
  if (!data) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 border border-bear/30 bg-bear/5 p-4 text-xs text-bear">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          {isKo ? '매매 품질 분석 데이터를 불러오지 못했습니다.' : 'Trade quality analysis is unavailable.'}
        </div>
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 border border-bear/40 px-2.5 py-1.5 text-bear hover:bg-bear/10">
          <RefreshCw className="h-3.5 w-3.5" />
          {isKo ? '다시 불러오기' : 'Retry'}
        </button>
      </section>
    );
  }

  const analysis = data.direction_breakdown[direction];
  const { summary } = analysis;
  const aligned = group(analysis.alignment_stats, 'aligned');
  const conflict = group(analysis.alignment_stats, 'conflict');
  const withTrend = group(analysis.trade_alignment_stats, 'with_trend');
  const counterTrend = group(analysis.trade_alignment_stats, 'counter_trend');
  const holdRows = ['actual', '1', '2', '3', '5', '10'].map((id) => ({ id, ...analysis.hold_results[id] }));
  const strategies = Object.entries(analysis.virtual_exit_strategies)
    .filter(([, value]) => value.triggered_count >= 3)
    .sort(([, left], [, right]) => (right.average_return_pct ?? -Infinity) - (left.average_return_pct ?? -Infinity));
  const issueText = summary.issue_balance === 'entry'
    ? (isKo ? '청산보다 진입 문제가 더 많이 발견됨' : 'Entry issues were more common than exit issues')
    : summary.issue_balance === 'exit'
      ? (isKo ? '진입보다 청산 문제가 더 많이 발견됨' : 'Exit issues were more common than entry issues')
      : summary.issue_balance === 'balanced'
        ? (isKo ? '진입과 청산 문제 비중이 비슷함' : 'Entry and exit issues were balanced')
        : (isKo ? '판정 표본 부족' : 'Insufficient classification sample');

  return (
    <div className="space-y-4">
      <section className="border border-dark-700 bg-dark-900/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">{isKo ? '매매 품질 핵심 결론' : 'Trade Quality Findings'}</h2>
            <div className="mt-0.5 text-[11px] text-dark-500">
              {isKo
                ? `${direction.toUpperCase()} 종료 거래 ${summary.trade_count}건 · 진입 직전 완료된 주봉/일봉/4H만 사용`
                : `${direction.toUpperCase()} · ${summary.trade_count} closed trades · completed pre-entry W/D/4H candles only`}
            </div>
            <div className="mt-1 text-[10px] text-dark-600">
              {isKo ? '시장 데이터' : 'Market data'}: {data.market_data_sources.length ? data.market_data_sources.join(' · ') : '-'}
            </div>
          </div>
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-dark-400" />}
        </div>

        <div className="mt-4 grid gap-px bg-dark-700 sm:grid-cols-2 xl:grid-cols-4">
          <div className="bg-dark-950 p-3">
            <div className="text-[11px] text-dark-500">PnL</div>
            <div className={`mt-1 font-mono text-lg ${(summary.total_pnl || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{signed(summary.total_pnl)} USDT</div>
          </div>
          <div className="bg-dark-950 p-3">
            <div className="text-[11px] text-dark-500">{isKo ? '승률' : 'Win Rate'}</div>
            <div className="mt-1 font-mono text-lg text-white">{number(summary.win_rate_pct)}%</div>
          </div>
          <div className="bg-dark-950 p-3">
            <div className="text-[11px] text-dark-500">Profit Factor</div>
            <div className="mt-1 font-mono text-lg text-white">{number(summary.profit_factor, 2)}</div>
          </div>
          <div className="bg-dark-950 p-3">
            <div className="text-[11px] text-dark-500">{isKo ? '평균 R' : 'Average R'}</div>
            <div className="mt-1 font-mono text-lg text-white">{signed(summary.average_r, 2)}</div>
          </div>
        </div>

        <div className="mt-3 grid gap-px bg-dark-700 md:grid-cols-3">
          <div className="bg-dark-950 p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-bull"><TrendingUp className="h-3.5 w-3.5" />{isKo ? '평균 수익이 가장 높은 시장 상황' : 'Highest Average PnL Regime'}</div>
            <div className="mt-2 text-sm font-semibold text-white">{summary.best_regime ? regimeLabel(summary.best_regime.id, isKo) : '-'}</div>
            <div className="mt-1 font-mono text-xs text-dark-400">{summary.best_regime ? `${signed(summary.best_regime.average_pnl)} USDT · ${isKo ? '승률' : 'win'} ${number(summary.best_regime.win_rate_pct)}% · n=${summary.best_regime.trade_count}` : (isKo ? '최소 표본 미달' : 'Below sample threshold')}</div>
          </div>
          <div className="bg-dark-950 p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-bear"><TrendingDown className="h-3.5 w-3.5" />{isKo ? '평균 손실이 가장 큰 시장 상황' : 'Lowest Average PnL Regime'}</div>
            <div className="mt-2 text-sm font-semibold text-white">{summary.worst_regime ? regimeLabel(summary.worst_regime.id, isKo) : '-'}</div>
            <div className="mt-1 font-mono text-xs text-dark-400">{summary.worst_regime ? `${signed(summary.worst_regime.average_pnl)} USDT · ${isKo ? '승률' : 'win'} ${number(summary.worst_regime.win_rate_pct)}% · n=${summary.worst_regime.trade_count}` : (isKo ? '최소 표본 미달' : 'Below sample threshold')}</div>
          </div>
          <div className="bg-dark-950 p-3">
            <div className="text-[11px] text-dark-500">{isKo ? '청산 타이밍' : 'Exit Tendency'}</div>
            <div className="mt-2 text-sm font-semibold text-white">{isKo ? `조기 ${number(summary.early_exit_ratio_pct)}% · 지연 ${number(summary.late_exit_ratio_pct)}%` : `Early ${number(summary.early_exit_ratio_pct)}% · Late ${number(summary.late_exit_ratio_pct)}%`}</div>
            <div className="mt-1 text-xs text-dark-400">{isKo ? '수익 구간을 챙긴 비율' : 'Capture'} {number(summary.average_capture_ratio_pct)}%</div>
          </div>
          <div className="bg-dark-950 p-3">
            <div className="text-[11px] text-dark-500">{isKo ? '가장 먼저 고칠 점' : 'Primary Issue'}</div>
            <div className="mt-2 text-sm font-semibold text-white">{issueText}</div>
            <div className="mt-1 text-xs text-dark-400">{isKo ? `분포 기준 미분류 ${summary.quality_counts.unavailable || 0}건` : `${summary.quality_counts.unavailable || 0} unclassified`}</div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 text-xs lg:grid-cols-2">
          <div className="border-t border-dark-700 pt-3">
            <div className="mb-2 font-medium text-dark-200">{isKo ? '큰 흐름이 같은 경우 vs 엇갈린 경우' : 'Aligned vs Conflicting Trends'}</div>
            <div className="flex justify-between text-dark-400"><span>{isKo ? '세 시간대가 같은 방향' : 'Aligned'} <span className="text-dark-600">n={aligned?.trade_count || 0}</span></span><span className="font-mono">{number(aligned?.win_rate_pct)}% · {signed(aligned?.average_pnl)} USDT</span></div>
            <div className="mt-1 flex justify-between text-dark-400"><span>{isKo ? '시간대별 방향이 엇갈림' : 'Conflict'} <span className="text-dark-600">n={conflict?.trade_count || 0}</span></span><span className="font-mono">{number(conflict?.win_rate_pct)}% · {signed(conflict?.average_pnl)} USDT</span></div>
          </div>
          <div className="border-t border-dark-700 pt-3">
            <div className="mb-2 font-medium text-dark-200">{isKo ? '큰 흐름을 따른 거래 vs 거스른 거래' : 'With-Trend vs Counter-Trend'}</div>
            <div className="flex justify-between text-dark-400"><span>{isKo ? '큰 흐름과 같은 방향' : 'With trend'} <span className="text-dark-600">n={withTrend?.trade_count || 0}</span></span><span className="font-mono">{number(withTrend?.win_rate_pct)}% · {signed(withTrend?.average_pnl)} USDT</span></div>
            <div className="mt-1 flex justify-between text-dark-400"><span>{isKo ? '큰 흐름과 반대 방향' : 'Counter trend'} <span className="text-dark-600">n={counterTrend?.trade_count || 0}</span></span><span className="font-mono">{number(counterTrend?.win_rate_pct)}% · {signed(counterTrend?.average_pnl)} USDT</span></div>
          </div>
        </div>
      </section>

      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between border border-dark-700 bg-dark-900/30 px-4 py-3 text-sm font-medium text-dark-200 hover:text-white">
          <span>{isKo ? '시장 상황과 청산 시점 자세히 보기' : 'Regime and Exit Details'}</span>
          <span className="flex items-center gap-2 text-[11px] font-normal text-dark-500">{analysis.regimes.length}{isKo ? '개 시장 상황' : ' regimes'}<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></span>
        </summary>
        <div className="mt-3 space-y-3">
          <section className="border border-dark-700 bg-dark-900/20 p-4">
            <h2 className="text-sm font-semibold text-white">{isKo ? '진입 당시 시장 상황 (주봉·일봉·4시간봉)' : 'Weekly / Daily / 4H Regimes'}</h2>
            <div className="mt-0.5 text-[11px] text-dark-500">{isKo ? `최소 ${data.minimum_regime_conclusion_sample}건 미만은 표본 적음으로 표시` : `Fewer than ${data.minimum_regime_conclusion_sample} trades is marked low sample`}</div>
            <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[920px] text-xs">
            <thead className="text-dark-500"><tr className="border-b border-dark-700"><th className="py-2 text-left">{isKo ? '시장 상황' : 'Regime'}</th><th className="py-2 text-right">{isKo ? '거래 수' : 'Trades'}</th><th className="py-2 text-right">{isKo ? '승률' : 'Win rate'}</th><th className="py-2 text-right">{isKo ? '수익/손실 비율' : 'PF'}</th><th className="py-2 text-right">{isKo ? '최대 이익 / 최대 손실 움직임' : 'MFE / MAE'}</th><th className="py-2 text-right">{isKo ? '너무 일찍 청산' : 'Early exits'}</th><th className="py-2 text-right">{isKo ? '수익 구간을 챙긴 비율' : 'Capture'}</th><th className="py-2 text-right">{isKo ? '더 나았던 청산 방법' : 'Best exit'}</th></tr></thead>
            <tbody>{analysis.regimes.map((regime) => (
              <tr key={regime.id} className="border-b border-dark-800">
                <td className="py-2 text-dark-200">{regimeLabel(regime.id, isKo)} <span className={regime.sample_quality === 'low' ? 'text-amber-300' : 'text-dark-600'}>· {sampleLabel(regime, isKo)}</span></td>
                <td className="py-2 text-right font-mono">{regime.trade_count}</td>
                <td className="py-2 text-right font-mono">{number(regime.win_rate_pct)}%</td>
                <td className="py-2 text-right font-mono">{number(regime.profit_factor, 2)}</td>
                <td className="py-2 text-right font-mono text-dark-300">{number(regime.average_mfe_pct)} / {number(regime.average_mae_pct)}%</td>
                <td className="py-2 text-right font-mono">{number(regime.early_exit_ratio_pct)}%</td>
                <td className="py-2 text-right font-mono">{number(regime.average_capture_ratio_pct)}%</td>
                <td className="py-2 text-right text-primary-200">{bestExitLabel(regime.best_exit_method, isKo)} {regime.best_exit_method && <span className="font-mono text-dark-500">{signed(regime.best_exit_method.average_return_pct)}% · n={regime.best_exit_method.triggered_count || regime.best_exit_method.available_count || 0}</span>}</td>
              </tr>
            ))}</tbody>
          </table>
            </div>
          </section>

          <section className="border border-dark-700 bg-dark-900/20 p-4">
            <h2 className="text-sm font-semibold text-white">{isKo ? '청산 방법 비교' : 'Exit Method Comparison'}</h2>
            <div className="mt-0.5 text-[11px] text-dark-500">{isKo ? '4H 완료봉 종가 기준 · R 미저장 거래는 가격 수익률만 표시' : 'Completed 4H closes · price return shown when R is unavailable'}</div>
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-medium text-dark-200">{isKo ? '조금 더 보유했다면' : 'Actual Exit vs Additional Holding'}</h3>
            <div className="mt-2 grid grid-cols-3 gap-px bg-dark-700 sm:grid-cols-6">
              {holdRows.map((row) => <div key={row.id} className="bg-dark-950 px-2 py-3 text-center"><div className="text-[11px] text-dark-500">{row.id === 'actual' ? (isKo ? '실제' : 'Actual') : `+${row.id}${isKo ? '봉' : ''}`}</div><div className={`mt-1 font-mono text-sm ${(row.average_return_pct || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{signed(row.average_return_pct)}%</div><div className="mt-1 text-[10px] text-dark-600">n={row.available_count || 0}</div></div>)}
            </div>
          </div>
          <div>
            <h3 className="text-xs font-medium text-dark-200">{isKo ? '보조지표 신호가 나왔을 때 청산했다면' : 'Indicator-Based Virtual Exits'}</h3>
            <div className="mt-2 space-y-1.5">{strategies.slice(0, 6).map(([id, value]) => <div key={id} className="flex items-center justify-between gap-3 border-b border-dark-800 pb-1.5 text-xs"><span className="text-dark-300">{strategyLabel(id, isKo)} <span className="text-dark-600">n={value.triggered_count}</span></span><span className={`font-mono ${(value.average_return_pct || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{signed(value.average_return_pct)}%</span></div>)}</div>
          </div>
            </div>
          </section>
        </div>
      </details>

      {data.warnings.length > 0 && <div className="text-[11px] text-amber-300">{isKo ? 'R 배수는 손절 위험값이 저장된 거래에서만 계산합니다. 일부 시장 데이터가 없으면 해당 항목은 제외됩니다.' : data.warnings.join(' ')}</div>}
      {isError && <div className="flex items-center justify-between gap-3 text-[11px] text-amber-300"><span>{isKo ? '최신 데이터 갱신에 실패해 이전 분석 결과를 표시합니다.' : 'Showing the previous result because the latest refresh failed.'}</span><button type="button" onClick={onRetry} className="inline-flex items-center gap-1 text-amber-200"><RefreshCw className="h-3 w-3" />{isKo ? '재시도' : 'Retry'}</button></div>}
    </div>
  );
}
