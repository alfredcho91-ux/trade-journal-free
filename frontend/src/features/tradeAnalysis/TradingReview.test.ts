import { describe, expect, it } from 'vitest';

import {
  buildBehaviorReviewCard,
  buildPlanCoverageRows,
  buildPlanReviewCard,
  buildStrengthReviewCard,
} from './TradingReview';
import type { JournalBehaviorAnalysisData, JournalQualityAnalysisData, PlanLabData } from '../../types';

describe('TradingReview adapters', () => {
  it('keeps the official behavior impact and evidence IDs unchanged', () => {
    const data = {
      biggest_leaks: [{
        id: 'EARLY_EXIT', label: '조기 청산', trade_count: 4,
        loss_impact_pnl: 12.5, loss_impact_r: 1.25,
        conclusion_eligible: true, evidence_journal_ids: [8, 3],
      }],
    } as JournalBehaviorAnalysisData;

    const card = buildBehaviorReviewCard(data, true);

    expect(card.impact).toBe(12.5);
    expect(card.impactUnit).toBe('USDT');
    expect(card.evidence?.journalIds).toEqual([8, 3]);
    expect(card.evidence?.direction).toBe('All');
  });

  it('keeps behavior selection, headline, and chart rows on the official PnL metric', () => {
    const data = {
      biggest_leaks: [
        {
          id: 'large-pnl', label: 'A', trade_count: 6,
          loss_impact_pnl: 1_000, loss_impact_r: 1,
          conclusion_eligible: true, evidence_journal_ids: [1],
        },
        {
          id: 'large-r', label: 'B', trade_count: 6,
          loss_impact_pnl: 100, loss_impact_r: 5,
          conclusion_eligible: true, evidence_journal_ids: [2],
        },
      ],
    } as JournalBehaviorAnalysisData;

    const card = buildBehaviorReviewCard(data, true);

    expect(card.label).toBe('A');
    expect(card.impact).toBe(1_000);
    expect(card.impactUnit).toBe('USDT');
    expect(card.rows.map((row) => row.value)).toEqual([1_000, 100]);
  });

  it('does not switch behavior metrics for partial or missing R coverage', () => {
    const data = {
      biggest_leaks: [
        { id: 'a', label: 'A', trade_count: 6, loss_impact_pnl: 40, loss_impact_r: null, conclusion_eligible: true, evidence_journal_ids: [1] },
        { id: 'b', label: 'B', trade_count: 6, loss_impact_pnl: 20, loss_impact_r: 8, conclusion_eligible: true, evidence_journal_ids: [2] },
      ],
    } as JournalBehaviorAnalysisData;

    const card = buildBehaviorReviewCard(data, true);

    expect(card.impactUnit).toBe('USDT');
    expect(card.rows.map((row) => row.value)).toEqual([40, 20]);
  });

  it('selects strength by official average R and only matching R evidence', () => {
    const data = {
      direction_breakdown: {
        Long: {
          summary: { best_regime: { id: 'aligned_up', average_pnl: 900, average_r: null, trade_count: 20, sample_quality: 'high' } },
          regimes: [
            { id: 'aligned_up', average_pnl: 900, average_r: null, trade_count: 20, r_sample_count: 0 },
            { id: 'mixed', average_pnl: 100, average_r: 0.8, trade_count: 12, r_sample_count: 10 },
          ],
        },
        Short: { summary: {}, regimes: [] },
      },
      items: [
        ...Array.from({ length: 10 }, (_, index) => ({
          journal_id: index + 1, direction: 'Long', market_regime: { id: 'mixed' }, r_multiple: 0.8,
        })),
        { journal_id: 20, direction: 'Long', market_regime: { id: 'aligned_up' }, r_multiple: null },
      ],
    } as unknown as JournalQualityAnalysisData;

    const card = buildStrengthReviewCard(data, 'Long', true);

    expect(card.label).toBe('혼합 추세');
    expect(card.averageR).toBe(0.8);
    expect(card.tradeCount).toBe(10);
    expect(card.evidence?.journalIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('does not present a PnL-selected regime as an R strength without an R sample', () => {
    const data = {
      direction_breakdown: {
        Long: {
          summary: { best_regime: { id: 'aligned_up', average_pnl: 218.45, average_r: null, trade_count: 30 } },
          regimes: [{ id: 'aligned_up', average_pnl: 218.45, average_r: null, trade_count: 30, r_sample_count: 0 }],
        },
        Short: { summary: {}, regimes: [] },
      },
      items: [],
    } as unknown as JournalQualityAnalysisData;

    expect(buildStrengthReviewCard(data, 'Long', true)).toEqual({ status: 'insufficient', rows: [] });
  });

  it('does not promote a low-confidence R sample as a repeatable strength', () => {
    const data = {
      direction_breakdown: {
        Long: {
          summary: {},
          regimes: [{ id: 'aligned_up', average_r: 1.2, trade_count: 5, r_sample_count: 5 }],
        },
        Short: { summary: {}, regimes: [] },
      },
      items: Array.from({ length: 5 }, (_, index) => ({
        journal_id: index + 1, direction: 'Long', market_regime: { id: 'aligned_up' }, r_multiple: 1.2,
      })),
    } as unknown as JournalQualityAnalysisData;

    expect(buildStrengthReviewCard(data, 'Long', true)).toEqual({ status: 'insufficient', rows: [] });
  });

  it('distinguishes strength loading and error from insufficient samples', () => {
    expect(buildStrengthReviewCard(undefined, 'Long', true, true, false).status).toBe('loading');
    expect(buildStrengthReviewCard(undefined, 'Long', true, false, true).status).toBe('error');
    expect(buildStrengthReviewCard(undefined, 'Long', true).status).toBe('insufficient');
  });

  it('shows Plan Lab values without deriving new Plan metrics', () => {
    const data = {
      summary: { official_r_count: 2, plan_expectancy_r: 0.4, actual_expectancy_r: 0.1, execution_delta_r: -0.3 },
      coverage: { plan_recorded: 3, closed_trades: 9, official_r: 2 },
      diagnosis: 'PLAN_OUTPERFORMED_ACTUAL',
      primary_attribution: [
        { id: 'COMMON', trade_count: 20, total_execution_delta_r: -2, journal_ids: [1, 2] },
        { id: 'EARLY_TP_EXIT', trade_count: 2, total_execution_delta_r: -8, journal_ids: [4, 9] },
      ],
      largest_execution_gap: { id: 'EARLY_TP_EXIT', trade_count: 2, total_execution_delta_r: -8, journal_ids: [4, 9] },
    } as unknown as PlanLabData;

    const card = buildPlanReviewCard(data, 'Long', true);

    expect(card.status).toBe('available');
    expect(card.planExpectancyR).toBe(0.4);
    expect(card.actualExpectancyR).toBe(0.1);
    expect(card.executionDeltaR).toBe(-0.3);
    expect(card.primaryIssue?.evidence.journalIds).toEqual([4, 9]);
    expect(card.primaryIssue?.evidence.direction).toBe('Long');
  });

  it('distinguishes unsupported minimum-return scope from not-loaded and insufficient Plan data', () => {
    expect(buildPlanReviewCard(undefined, 'Long', true, 2).status).toBe('unsupported_filter');
    expect(buildPlanReviewCard(undefined, 'Long', true, 0).status).toBe('not_loaded');
    const insufficient = {
      summary: { official_r_count: 0 },
      coverage: { plan_recorded: 1, closed_trades: 9, official_r: 0 },
      diagnosis: 'INSUFFICIENT_PLANS',
      primary_attribution: [],
    } as unknown as PlanLabData;
    expect(buildPlanReviewCard(insufficient, 'Long', true, 0).status).toBe('insufficient');
  });

  it('distinguishes a matching Plan query error from a cache miss', () => {
    expect(buildPlanReviewCard(undefined, 'Long', true, 0, 'error').status).toBe('error');
    expect(buildPlanReviewCard(undefined, 'Long', true, 0, 'pending').status).toBe('loading');
    expect(buildPlanReviewCard(undefined, 'Long', true, 0).status).toBe('not_loaded');
  });

  it('exposes existing Plan coverage reasons without deriving new counts', () => {
    const data = {
      coverage: {
        closed_trades: 20,
        plan_recorded: 12,
        official_r: 7,
        price_r_only: 2,
        r_unavailable: 1,
        ambiguous: 1,
        not_evaluable: 1,
      },
    } as PlanLabData;

    expect(buildPlanCoverageRows(data, true).map((row) => [row.id, row.value])).toEqual([
      ['recorded', 12],
      ['official', 7],
      ['price', 2],
      ['unavailable', 1],
      ['ambiguous', 1],
      ['not_evaluable', 1],
    ]);
  });
});
