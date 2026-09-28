import type { PlanRevision, PlanSource } from '../../types';

export const planValue = (value: unknown): string => value == null || value === '' ? '—' : String(value);

export function planSourceLabel(source: PlanSource, isKo: boolean): string {
  switch (source) {
    case 'VERIFIED_PRETRADE': return isKo ? '진입 전 기록이 있는 계획' : 'Plan with pre-entry evidence';
    case 'RETROSPECTIVE': return isKo ? '거래 후 복기를 위해 기록한 계획' : 'Plan recorded after the trade for review';
    case 'IN_TRADE': return isKo ? '진입 후 기록한 계획' : 'Plan recorded after entry';
    default: return isKo ? '거래에 연결되지 않은 계획' : 'Plan not linked to a trade';
  }
}

export function revisionTiming(revision: PlanRevision, isKo: boolean): string {
  switch (revision.phase) {
    case 'PRE_TRADE': return isKo ? '진입 전에 기록됨' : 'Recorded before entry';
    case 'POST_ENTRY_EDIT': return isKo ? '진입 시점 또는 이후에 기록됨' : 'Recorded at or after entry';
    case 'POST_TRADE_INPUT': return isKo ? '거래 종료 후 기록됨' : 'Recorded after trade exit';
    default: return isKo ? '기록 시점과 진입의 선후관계 미확인' : 'Timing relative to entry not verified';
  }
}

export const revisionFields = [
  ['entry_price', '진입가', 'Entry'], ['entry_min', '진입 범위 하한', 'Entry range minimum'],
  ['entry_max', '진입 범위 상한', 'Entry range maximum'], ['stop_loss', '손절가', 'Stop'],
  ['take_profit', '1차 목표가', 'Target 1'], ['take_profit_2', '2차 목표가', 'Target 2'],
  ['setup', '매매 설정', 'Setup'], ['entry_note', '진입 근거', 'Entry rationale'],
  ['exit_note', '청산 조건', 'Exit condition'], ['memo', '메모', 'Notes'],
  ['max_hold_hours', '최대 보유시간(시간)', 'Maximum hold (hours)'],
] as const;

/** Compare stored fields only; never select an eligible revision or change a value. */
export function revisionChanges(before: PlanRevision, after: PlanRevision, isKo: boolean) {
  return revisionFields.filter(([key]) => before[key] !== after[key])
    .map(([key, ko, en]) => ({ key, label: isKo ? ko : en, before: planValue(before[key]), after: planValue(after[key]) }));
}
