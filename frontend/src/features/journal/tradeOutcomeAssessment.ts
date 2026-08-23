import type { TradeExcursion } from '../../types';

export type TradeOutcomeAssessmentTone = 'warning' | 'negative' | 'neutral';

export interface TradeOutcomeAssessment {
  label: string;
  explanation: string;
  tone: TradeOutcomeAssessmentTone;
}

function number(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${number(value)}`;
}

export function tradeOutcomeAssessment(
  excursion: TradeExcursion,
  qualityClass: string | null | undefined,
  isKo: boolean,
): TradeOutcomeAssessment {
  const mfe = number(excursion.mfe_pct);
  const mae = number(excursion.mae_pct);
  const realized = signed(excursion.realized_move_pct);

  if (qualityClass === 'good_entry_early_exit') {
    const capture = excursion.capture_pct == null ? null : number(excursion.capture_pct);
    return {
      label: isKo ? '진입 양호 · 너무 빠른 종료' : 'Good Entry · Early Exit',
      explanation: isKo
        ? `가격 기준으로 진입 후 최대 +${mfe}% 유리했지만 종료는 ${realized}%로${capture == null ? '' : `, 유리 움직임의 ${capture}%만 확보했습니다`}.`
        : `On a price-move basis, the trade moved up to +${mfe}% in favor but exited at ${realized}%${capture == null ? '' : `, capturing ${capture}% of the favorable move`}.`,
      tone: 'warning',
    };
  }

  if (qualityClass === 'good_entry_late_exit') {
    return {
      label: isKo ? '진입 양호 · 너무 늦은 종료' : 'Good Entry · Late Exit',
      explanation: isKo
        ? `진입 후 최대 +${mfe}% 유리했지만 수익 일부를 반납해 ${realized}%로 종료했습니다.`
        : `The trade moved up to +${mfe}% in favor but gave back part of that move and exited at ${realized}%.`,
      tone: 'warning',
    };
  }

  if (qualityClass === 'poor_entry') {
    return {
      label: isKo ? '진입 불리' : 'Poor Entry',
      explanation: isKo
        ? `가격 기준 최대 불리 움직임 -${mae}%가 최대 유리 움직임 +${mfe}%보다 컸고, 종료도 ${realized}%였습니다.`
        : `On a price-move basis, the maximum adverse move (-${mae}%) exceeded the favorable move (+${mfe}%), and the trade exited at ${realized}%.`,
      tone: 'negative',
    };
  }

  if (qualityClass !== 'good_entry_good_exit') {
    return {
      label: isKo ? '판정 표본 부족' : 'Insufficient Classification Sample',
      explanation: isKo
        ? `최대 유리 +${mfe}%, 최대 불리 -${mae}%, 종료 ${realized}%의 흐름은 계산됐지만 품질 판정에 필요한 표본이 부족합니다.`
        : `The path was measured at +${mfe}% favorable, -${mae}% adverse, and ${realized}% realized, but the quality sample is insufficient.`,
      tone: 'neutral',
    };
  }

  return {
    label: isKo ? '진입·종료 양호' : 'Good Entry · Good Exit',
    explanation: isKo
      ? `가격 기준 최대 유리 +${mfe}%, 최대 불리 -${mae}%, 종료 ${realized}%로 진입과 종료가 모두 양호한 구간에 속합니다.`
      : `The price moved +${mfe}% in favor, -${mae}% against, and exited at ${realized}%, placing both entry and exit in the favorable range.`,
    tone: 'neutral',
  };
}
