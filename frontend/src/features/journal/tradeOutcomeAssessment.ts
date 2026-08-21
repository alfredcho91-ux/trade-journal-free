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
  isKo: boolean,
): TradeOutcomeAssessment {
  const mfe = number(excursion.mfe_pct);
  const mae = number(excursion.mae_pct);
  const realized = signed(excursion.realized_move_pct);

  if (excursion.classification === 'good_entry_poor_exit') {
    const capture = excursion.capture_pct == null ? null : number(excursion.capture_pct);
    return {
      label: isKo ? '진입 양호 · 종료 아쉬움' : 'Good Entry · Weak Exit',
      explanation: isKo
        ? `가격 기준으로 진입 후 최대 +${mfe}% 유리했지만 종료는 ${realized}%로${capture == null ? '' : `, 유리 움직임의 ${capture}%만 확보했습니다`}.`
        : `On a price-move basis, the trade moved up to +${mfe}% in favor but exited at ${realized}%${capture == null ? '' : `, capturing ${capture}% of the favorable move`}.`,
      tone: 'warning',
    };
  }

  if (excursion.classification === 'poor_entry') {
    return {
      label: isKo ? '진입 불리' : 'Poor Entry',
      explanation: isKo
        ? `가격 기준 최대 불리 움직임 -${mae}%가 최대 유리 움직임 +${mfe}%보다 컸고, 종료도 ${realized}%였습니다.`
        : `On a price-move basis, the maximum adverse move (-${mae}%) exceeded the favorable move (+${mfe}%), and the trade exited at ${realized}%.`,
      tone: 'negative',
    };
  }

  return {
    label: isKo ? '균형 종료' : 'Balanced Exit',
    explanation: isKo
      ? `가격 기준 최대 유리 +${mfe}%, 최대 불리 -${mae}%, 종료 ${realized}%로 현재 기준에서 진입·종료가 한쪽으로 크게 치우치지 않았습니다.`
      : `On a price-move basis, maximum favorable move was +${mfe}%, adverse move was -${mae}%, and exit was ${realized}%; neither entry nor exit is strongly skewed by the current rules.`,
    tone: 'neutral',
  };
}
