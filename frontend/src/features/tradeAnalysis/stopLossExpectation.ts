import type { AnalyzedTrade } from './tradeAnalysis';
import { investedAmount, netReturnPct } from '../journal/journalReturns';

export type StopLossBasis = 'margin' | 'price';

export interface StopLossExpectationResult {
  basis: StopLossBasis;
  stopPct: number;
  tradeCount: number;
  excludedTradeCount: number;
  stopHitCount: number;
  falseStopCount: number;
  winCount: number;
  lossCount: number;
  breakevenCount: number;
  winRatePct: number | null;
  stopHitRatePct: number | null;
  falseStopRatePct: number | null;
  expectancyPct: number | null;
  averageWinPct: number | null;
  averageLossPct: number | null;
  profitFactor: number | null;
  baselineExpectancyPct: number | null;
  baselineWinRatePct: number | null;
  expectancyDeltaPctPoints: number | null;
  winRateDeltaPctPoints: number | null;
}

type SimulationRow = {
  actualReturnPct: number;
  simulatedReturnPct: number;
  stopHit: boolean;
};

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function winRate(values: number[]): number | null {
  if (values.length === 0) return null;
  return (values.filter((value) => value > 0).length / values.length) * 100;
}

function simulationRow(
  trade: AnalyzedTrade,
  stopPct: number,
  basis: StopLossBasis,
): SimulationRow | null {
  const excursion = trade.excursion;
  if (!excursion || !finite(excursion.mae_pct) || !finite(excursion.realized_move_pct)) {
    return null;
  }

  const leverage = trade.entry.leverage;
  if (basis === 'margin' && (!finite(leverage) || leverage <= 0)) {
    return null;
  }

  const multiplier = basis === 'margin' ? leverage as number : 1;
  const adverseMovePct = Math.abs(excursion.mae_pct) * multiplier;
  const actualReturnPct = basis === 'margin'
    ? netReturnPct(trade.entry)
    : excursion.realized_move_pct;
  if (!finite(actualReturnPct)) return null;

  const stopHit = adverseMovePct >= stopPct;
  const invested = basis === 'margin' ? investedAmount(trade.entry) : null;
  const feePct = basis === 'margin' && invested != null
    ? (Math.abs(trade.entry.fee || 0) / invested) * 100
    : 0;

  return {
    actualReturnPct,
    simulatedReturnPct: stopHit ? -stopPct - feePct : actualReturnPct,
    stopHit,
  };
}

export function calculateStopLossExpectation(
  trades: AnalyzedTrade[],
  stopPct: number,
  basis: StopLossBasis,
): StopLossExpectationResult {
  const validStopPct = finite(stopPct) && stopPct > 0 ? stopPct : 0;
  const rows = validStopPct > 0
    ? trades.flatMap((trade) => simulationRow(trade, validStopPct, basis) ?? [])
    : [];
  const simulated = rows.map((row) => row.simulatedReturnPct);
  const baseline = rows.map((row) => row.actualReturnPct);
  const wins = simulated.filter((value) => value > 0);
  const losses = simulated.filter((value) => value < 0);
  const stopHits = rows.filter((row) => row.stopHit);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const expectancyPct = average(simulated);
  const baselineExpectancyPct = average(baseline);
  const simulatedWinRate = winRate(simulated);
  const baselineWinRate = winRate(baseline);

  return {
    basis,
    stopPct: validStopPct,
    tradeCount: rows.length,
    excludedTradeCount: trades.length - rows.length,
    stopHitCount: stopHits.length,
    falseStopCount: stopHits.filter((row) => row.actualReturnPct > 0).length,
    winCount: wins.length,
    lossCount: losses.length,
    breakevenCount: simulated.filter((value) => value === 0).length,
    winRatePct: simulatedWinRate,
    stopHitRatePct: rows.length > 0 ? (stopHits.length / rows.length) * 100 : null,
    falseStopRatePct: stopHits.length > 0
      ? (stopHits.filter((row) => row.actualReturnPct > 0).length / stopHits.length) * 100
      : null,
    expectancyPct,
    averageWinPct: average(wins),
    averageLossPct: average(losses),
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null,
    baselineExpectancyPct,
    baselineWinRatePct: baselineWinRate,
    expectancyDeltaPctPoints: expectancyPct != null && baselineExpectancyPct != null
      ? expectancyPct - baselineExpectancyPct
      : null,
    winRateDeltaPctPoints: simulatedWinRate != null && baselineWinRate != null
      ? simulatedWinRate - baselineWinRate
      : null,
  };
}
