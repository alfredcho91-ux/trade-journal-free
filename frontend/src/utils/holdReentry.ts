export type TradeDirection = 'long' | 'short';

export const BASE_FEE_PERCENT = 0.04;
export const MAX_LEVERAGE = 50;

export interface HoldReentryInputs {
  direction: TradeDirection;
  entryPrice: number;
  currentPrice: number;
  reentryPrice: number;
  targetPrice: number;
  marginUsd: number;
  leverage: number;
  feePercent?: number;
}

export interface HoldReentryResult {
  isValid: boolean;
  positionQuantity: number;
  reentryQuantity: number;
  positionNotional: number;
  effectiveFeePercent: number;
  currentPnl: number;
  currentPnlPercent: number;
  holdingPnl: number;
  holdingPnlPercent: number;
  realizedPnl: number;
  reentryPnl: number;
  reentryFinalPnl: number;
  grossReentryAdvantage: number;
  incrementalFees: number;
  netReentryAdvantage: number;
}

export function calculateHoldReentry(inputs: HoldReentryInputs): HoldReentryResult {
  const { direction, entryPrice, currentPrice, reentryPrice, targetPrice, marginUsd, leverage } = inputs;
  const feePercent = inputs.feePercent ?? leverage * BASE_FEE_PERCENT;
  const isValid = [entryPrice, currentPrice, reentryPrice, targetPrice, marginUsd].every(
    (value) => Number.isFinite(value) && value > 0,
  ) && Number.isFinite(leverage) && leverage >= 1 && leverage <= MAX_LEVERAGE
    && Number.isFinite(feePercent) && feePercent >= 0 && feePercent <= 10;

  if (!isValid) {
    return {
      isValid: false, positionQuantity: 0, reentryQuantity: 0, positionNotional: 0, effectiveFeePercent: 0,
      currentPnl: 0, currentPnlPercent: 0, holdingPnl: 0, holdingPnlPercent: 0, realizedPnl: 0,
      reentryPnl: 0, reentryFinalPnl: 0, grossReentryAdvantage: 0, incrementalFees: 0, netReentryAdvantage: 0,
    };
  }

  const side = direction === 'long' ? 1 : -1;
  const positionNotional = marginUsd * leverage;
  const positionQuantity = positionNotional / entryPrice;
  const reentryQuantity = positionNotional / reentryPrice;
  const currentPnl = (currentPrice - entryPrice) * positionQuantity * side;
  const holdingPnl = (targetPrice - entryPrice) * positionQuantity * side;
  const reentryPnl = (targetPrice - reentryPrice) * reentryQuantity * side;
  const reentryFinalPnl = currentPnl + reentryPnl;
  const grossReentryAdvantage = reentryFinalPnl - holdingPnl;
  const feeRate = feePercent / 100;
  const holdingExitFee = targetPrice * positionQuantity * feeRate;
  const reentryScenarioFees = (currentPrice * positionQuantity + reentryPrice * reentryQuantity + targetPrice * reentryQuantity) * feeRate;
  const incrementalFees = reentryScenarioFees - holdingExitFee;

  return {
    isValid: true,
    positionQuantity,
    reentryQuantity,
    positionNotional,
    effectiveFeePercent: feePercent,
    currentPnl,
    currentPnlPercent: ((currentPrice - entryPrice) / entryPrice) * 100 * side * leverage,
    holdingPnl,
    holdingPnlPercent: ((targetPrice - entryPrice) / entryPrice) * 100 * side * leverage,
    realizedPnl: currentPnl,
    reentryPnl,
    reentryFinalPnl,
    grossReentryAdvantage,
    incrementalFees,
    netReentryAdvantage: grossReentryAdvantage - incrementalFees,
  };
}
