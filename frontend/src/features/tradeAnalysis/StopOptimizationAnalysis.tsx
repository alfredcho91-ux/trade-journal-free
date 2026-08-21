import { Crosshair, Loader2, RotateCcw } from 'lucide-react';
import type {
  JournalStopOptimizationData,
  StopOptimizationCandidate,
  StopOptimizationRecommendation,
} from '../../types';

type Props = {
  data?: JournalStopOptimizationData;
  direction: 'Long' | 'Short';
  isLoading: boolean;
  isError: boolean;
  isKo: boolean;
  onRetry: () => void;
};

function number(value?: number | null, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '-' : value.toFixed(digits);
}

function signed(value?: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function regimeLabel(id: string): string {
  const labels: Record<string, string> = {
    aligned_up: 'Weekly · Daily · 4H 상승 정렬',
    aligned_down: 'Weekly · Daily · 4H 하락 정렬',
    higher_up_4h_pullback: '상위 상승 · 4H 조정',
    higher_down_4h_pullback: '상위 하락 · 4H 반등',
    higher_up_4h_reentry: '상위 상승 · 4H 재정렬',
    higher_down_4h_reentry: '상위 하락 · 4H 재정렬',
    weekly_sideways_mid_up: 'Weekly 횡보 · Daily/4H 상승',
    weekly_sideways_mid_down: 'Weekly 횡보 · Daily/4H 하락',
    mixed: '추세 충돌',
  };
  return labels[id] || id;
}

function recommendationReason(
  recommendation: StopOptimizationRecommendation,
  p75?: number | null,
  drop?: { from_pct: number; to_pct: number; drop_pct_points: number } | null,
): string {
  const reasons = [];
  if (p75 != null) reasons.push(`승리 거래 75%의 MAE가 ${p75.toFixed(2)}% 이내`);
  if (drop) reasons.push(`${drop.from_pct.toFixed(2)}~${drop.to_pct.toFixed(2)}%에서 패배 거래 회복률이 ${drop.drop_pct_points.toFixed(1)}%p 하락`);
  reasons.push(`과거 구간 점수로 ${recommendation.selected_pct.toFixed(2)}%를 선택하고 최근 구간에서 별도 검증`);
  return reasons.join(' · ');
}

function CandidateTable({ candidates, selected }: { candidates: StopOptimizationCandidate[]; selected?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-xs">
        <thead className="text-dark-500">
          <tr className="border-b border-dark-700">
            <th className="py-2 text-left">Stop</th>
            <th className="py-2 text-right">승리 보존</th>
            <th className="py-2 text-right">False Stop</th>
            <th className="py-2 text-right">평균 R</th>
            <th className="py-2 text-right">PF</th>
            <th className="py-2 text-right">Max DD</th>
            <th className="py-2 text-right">검증 PF</th>
            <th className="py-2 text-right">표본</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate) => {
            const isSelected = candidate.type === 'fixed' && candidate.value === selected;
            return (
              <tr key={`${candidate.type}-${candidate.value}`} className={`border-b border-dark-800 ${isSelected ? 'bg-primary-500/10 text-primary-100' : ''}`}>
                <td className="py-2 font-mono">
                  {candidate.type === 'fixed' ? `${candidate.value.toFixed(2)}%` : `${candidate.value.toFixed(1)} ATR`}
                  {candidate.type === 'atr' && <span className="ml-1 text-dark-500">평균 {number(candidate.average_stop_pct)}%</span>}
                </td>
                <td className="py-2 text-right font-mono">{number(candidate.train.winner_preservation_pct, 1)}%</td>
                <td className="py-2 text-right font-mono">{number(candidate.train.false_stop_pct, 1)}%</td>
                <td className="py-2 text-right font-mono">{signed(candidate.train.average_r)}</td>
                <td className="py-2 text-right font-mono">{number(candidate.train.profit_factor)}</td>
                <td className="py-2 text-right font-mono">{number(candidate.train.max_drawdown_pct_points)}%p</td>
                <td className="py-2 text-right font-mono">{number(candidate.validation.profit_factor)}</td>
                <td className="py-2 text-right font-mono text-dark-500">{candidate.train.trade_count} / {candidate.validation.trade_count}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function StopOptimizationAnalysis({ data, direction, isLoading, isError, isKo, onRetry }: Props) {
  if (isLoading) {
    return <section className="flex min-h-32 items-center justify-center border border-dark-700 text-xs text-dark-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{isKo ? '손절 위치 분석 중' : 'Optimizing stop distance'}</section>;
  }
  if (isError || !data) {
    return (
      <section className="flex min-h-32 flex-col items-center justify-center gap-3 border border-dark-700 text-xs text-dark-400">
        <span>{isKo ? '손절 위치 분석 데이터를 불러오지 못했습니다.' : 'Stop optimization is unavailable.'}</span>
        <button type="button" onClick={onRetry} className="flex items-center gap-1 text-primary-300"><RotateCcw className="h-3.5 w-3.5" />{isKo ? '다시 시도' : 'Retry'}</button>
      </section>
    );
  }

  const analysis = data.direction_breakdown[direction];
  const recommendation = analysis.recommendation;
  const mae = analysis.winner_mae_distribution;
  const recovery = analysis.loser_recovery;
  const effect = analysis.expected_effect;
  const regimes = data.regime_breakdown[direction];
  const usefulRecovery = recovery.points.filter((point) => point.reached_count > 0);
  const maxMae = Math.max(mae.p95 || 0, 0.01);

  return (
    <section className="border border-dark-700 bg-dark-900/20">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-dark-700 p-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><Crosshair className="h-4 w-4 text-primary-300" />Stop-Loss 최적 위치</h2>
          <p className="mt-1 text-[11px] text-dark-500">{direction.toUpperCase()} · 15분봉 실제 경로 · 과거 70% 선택 / 최근 30% 검증</p>
        </div>
        <div className="text-right text-[11px] text-dark-500">분석 {analysis.trade_count}건 · 검증 {analysis.validation_count}건</div>
      </div>

      {!recommendation ? (
        <div className="p-5 text-sm text-dark-400">추천 범위를 계산할 거래 경로가 부족합니다.</div>
      ) : (
        <>
          <div className="border-b border-dark-700 p-4">
            <div className="text-xs text-dark-500">{recommendation.validation_status === 'passed' ? '검증된 추천 Stop 범위' : '과거 구간 추천 후보'}</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-primary-200">{number(recommendation.lower_pct)}% ~ {number(recommendation.upper_pct)}%</div>
            <div className="mt-2 text-xs leading-5 text-dark-300">{recommendationReason(recommendation, mae.p75, recovery.steepest_drop)}</div>
            {recommendation.validation_status === 'failed' && <div className="mt-2 text-xs text-bear">최근 30% 검증 구간에서는 기존 방식 대비 개선이 재현되지 않았습니다. 실전 기준으로 확정하지 마세요.</div>}
            {recommendation.validation_status === 'neutral' && <div className="mt-2 text-xs text-dark-400">최근 30% 검증 구간에서는 기존 방식과 결과가 같아 개선 효과가 확인되지 않았습니다.</div>}
            {recommendation.validation_status === 'insufficient' && <div className="mt-2 text-xs text-amber-300">최근 검증 표본이 부족해 개선 여부를 판단할 수 없습니다.</div>}
            {recommendation.sample_quality === 'low' && <div className="mt-2 text-xs text-amber-300">표본이 적어 임시 범위로만 보세요.</div>}
          </div>

          <div className="grid border-b border-dark-700 md:grid-cols-3">
            <div className="border-b border-dark-700 p-4 md:border-b-0 md:border-r">
              <div className="text-[11px] text-dark-500">검증 구간 PF 변화</div>
              <div className={`mt-1 font-mono text-lg ${(effect?.profit_factor_delta || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{signed(effect?.profit_factor_delta)}</div>
            </div>
            <div className="border-b border-dark-700 p-4 md:border-b-0 md:border-r">
              <div className="text-[11px] text-dark-500">거래당 평균 수익 변화</div>
              <div className={`mt-1 font-mono text-lg ${(effect?.average_return_delta_pct || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{signed(effect?.average_return_delta_pct)}%p</div>
            </div>
            <div className="p-4">
              <div className="text-[11px] text-dark-500">Max DD 감소 예상</div>
              <div className={`mt-1 font-mono text-lg ${(effect?.max_drawdown_reduction_pct_points || 0) >= 0 ? 'text-bull' : 'text-bear'}`}>{signed(effect?.max_drawdown_reduction_pct_points)}%p</div>
            </div>
          </div>
        </>
      )}

      <div className="grid border-b border-dark-700 lg:grid-cols-2">
        <div className="border-b border-dark-700 p-4 lg:border-b-0 lg:border-r">
          <h3 className="text-xs font-semibold text-white">승리 거래 MAE 분포</h3>
          <p className="mt-1 text-[11px] text-dark-500">순실현 PnL이 양수인 {mae.winner_count}건이 수익 전까지 견딘 최대 역행폭</p>
          <div className="mt-4 space-y-3">
            {([['50%', mae.p50], ['75%', mae.p75], ['90%', mae.p90], ['95%', mae.p95]] as const).map(([label, value]) => (
              <div key={label} className="grid grid-cols-[42px_1fr_58px] items-center gap-2 text-xs">
                <span className="text-dark-400">{label}</span>
                <div className="h-1.5 bg-dark-800"><div className="h-full bg-primary-400" style={{ width: `${Math.min(100, ((value || 0) / maxMae) * 100)}%` }} /></div>
                <span className="text-right font-mono text-dark-200">{number(value)}%</span>
              </div>
            ))}
          </div>
        </div>
        <div className="p-4">
          <h3 className="text-xs font-semibold text-white">패배 거래 회복 확률</h3>
          <p className="mt-1 text-[11px] text-dark-500">역행 도달 뒤 다음 15분봉부터 진입가를 회복한 비율 · 패배 {recovery.loser_count}건</p>
          {recovery.steepest_drop ? (
            <div className="mt-4 text-sm text-dark-200">회복률 급락 구간 <strong className="font-mono text-amber-300">{number(recovery.steepest_drop.from_pct)}% → {number(recovery.steepest_drop.to_pct)}%</strong></div>
          ) : <div className="mt-4 text-sm text-dark-400">급락 구간을 판단할 표본이 부족합니다.</div>}
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-primary-300">구간별 회복률 보기</summary>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {usefulRecovery.map((point) => <div key={point.threshold_pct} className="flex justify-between border-b border-dark-800 py-1.5"><span>-{number(point.threshold_pct)}%</span><span className="font-mono">{number(point.recovery_probability_pct, 1)}% <span className="text-dark-600">({point.recovered_count}/{point.reached_count})</span></span></div>)}
            </div>
          </details>
        </div>
      </div>

      <details open className="border-b border-dark-700 p-4">
        <summary className="cursor-pointer text-xs font-semibold text-white">고정 % Stop 후보 비교</summary>
        <p className="mt-1 text-[11px] text-dark-500">승리 보존율, PF, 평균 R, Drawdown을 함께 반영 · 굵은 행이 선택값</p>
        <div className="mt-3"><CandidateTable candidates={analysis.fixed_candidates} selected={recommendation?.selected_pct} /></div>
      </details>

      <details className="border-b border-dark-700 p-4">
        <summary className="cursor-pointer text-xs font-semibold text-white">ATR Stop 후보 비교</summary>
        <p className="mt-1 text-[11px] text-dark-500">진입 직전 완료된 4시간봉 ATR 기준</p>
        <div className="mt-3"><CandidateTable candidates={analysis.atr_candidates} /></div>
      </details>

      {regimes.length > 0 && (
        <details className="p-4">
          <summary className="cursor-pointer text-xs font-semibold text-white">장세별 추천 범위</summary>
          <div className="mt-3 space-y-2 text-xs">
            {regimes.map((regime) => <div key={regime.id} className="flex flex-wrap justify-between gap-2 border-b border-dark-800 py-2"><span>{regimeLabel(regime.id)}</span><span className="font-mono text-primary-200">{regime.recommendation ? `${number(regime.recommendation.lower_pct)}% ~ ${number(regime.recommendation.upper_pct)}%` : '-'} <span className="text-dark-600">n={regime.trade_count}</span></span></div>)}
          </div>
        </details>
      )}

      <div className="border-t border-dark-700 px-4 py-2 text-[10px] leading-4 text-dark-600">승패는 수수료·펀딩 반영 순실현 PnL로 구분합니다. 후보 성과는 포지션 규모 차이를 제거한 가격 변동률 기준이며 실제 체결 슬리피지는 포함하지 않습니다.</div>
    </section>
  );
}
