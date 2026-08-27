import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentProps } from 'react';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import type { JournalEntry, PlanEvaluation, PlanLabData, TradingPlan } from '../types';
import {
  calculateTargetRiskReward,
  calculateTargetRiskRewardFromDraft,
  nextMissingTrade,
  planEntryLabel,
  planStatusForEntry,
  revisionPayload,
  shouldLoadPlanLabAnalysis,
  type PlanDraft,
} from '../features/planLab/pastTradePlan';
import { PlanDetailsDrawer } from '../features/planLab/PlanTradeDetailDrawer';
import { planCoverageItems } from '../features/planLab/planCoverage';
import { PlanForm } from './PlanLabPage';

const draft: PlanDraft = {
  exchange: 'binance',
  symbol: 'BTC/USDT',
  side: 'Long',
  entryMode: 'exact',
  entryPrice: '',
  entryMin: '',
  entryMax: '',
  stopLoss: '98',
  takeProfit: '104',
  takeProfit2: '',
  maxHoldHours: '',
  setup: 'pullback',
  entryNote: 'support held',
  exitNote: 'target or stop',
  memo: '',
};

function trade(id: number, entryDatetime: string): JournalEntry {
  return {
    id,
    symbol: 'BTC/USDT',
    direction: 'Long',
    entry_datetime: entryDatetime,
    datetime: '2026-01-02T00:00:00Z',
    entry_price: 100,
    exit_price: 103,
    realized_pnl: 30,
    r_multiple: 1.5,
  };
}

function plan(source: TradingPlan['source'], journalEntryId: number): TradingPlan {
  const revision = {
    id: journalEntryId,
    plan_id: journalEntryId,
    version: 1,
    entry_price: source === 'RETROSPECTIVE' ? null : 100,
    entry_min: null,
    entry_max: null,
    stop_loss: 98,
    take_profit: 104,
    take_profit_2: null,
    received_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
  };
  return {
    id: journalEntryId,
    exchange: 'binance',
    symbol: 'BTC/USDT',
    symbol_key: 'BTCUSDT',
    side: 'Long',
    status: 'linked',
    source,
    received_at: revision.received_at,
    created_at: revision.created_at,
    updated_at: revision.created_at,
    revisions: [revision],
    latest_revision: revision,
    link: {
      id: journalEntryId,
      plan_id: journalEntryId,
      journal_entry_id: journalEntryId,
      link_status: 'LINKED',
      linked_at: revision.created_at,
      updated_at: revision.created_at,
    },
  };
}

function splitEvaluation(overrides: Partial<PlanEvaluation> = {}): PlanEvaluation {
  return {
    plan_id: 1,
    journal_id: 1,
    side: 'Long',
    plan_source: 'VERIFIED_PRETRADE',
    evaluation_status: 'TP1_TP2',
    plan_execution_mode: 'SPLIT_TP_50_50',
    planned_result_r: 9.99,
    planned_result_pnl: 199.8,
    actual_r: 1.5,
    execution_delta_r: -8.49,
    r_basis: 'usdt',
    plan_legs: [
      { type: 'TP1', fraction: 0.5, exit_price: 104, price_r: 1, contribution_r: 0.5, status: 'FILLED' },
      { type: 'TP2', fraction: 0.5, exit_price: 108, price_r: 3, contribution_r: 1.5, status: 'FILLED' },
    ],
    revisions: [],
    ...overrides,
  };
}

function renderPlanForm(overrides: Partial<ComponentProps<typeof PlanForm>> = {}) {
  return renderToStaticMarkup(<PlanForm
    draft={draft}
    isKo
    trade={trade(1, '2026-01-01T10:00:00Z')}
    pending={false}
    error={null}
    saved={false}
    hasNextMissing
    onChange={() => undefined}
    onSubmit={() => undefined}
    onCancel={() => undefined}
    onViewAnalysis={() => undefined}
    onNextMissing={() => undefined}
    {...overrides}
  />);
}

describe('Past Trade Plan Input reliability', () => {
  it('calculates a live LONG target R:R for a TP1-only plan', () => {
    const result = calculateTargetRiskReward({ direction: 'Long', entry: 100, stopLoss: 98, tp1: 104 });
    expect(result).toMatchObject({ mode: 'TP1_ONLY', riskDistance: 2, riskPct: 2, tp1R: 2, tp2R: null, splitTargetR: null, valid: true });
  });

  it('calculates the same fixed 50/50 split for LONG and SHORT', () => {
    const long = calculateTargetRiskReward({ direction: 'Long', entry: 100, stopLoss: 98, tp1: 102, tp2: 106 });
    const short = calculateTargetRiskReward({ direction: 'Short', entry: 100, stopLoss: 102, tp1: 98, tp2: 94 });
    expect(long).toMatchObject({ mode: 'SPLIT_TP_50_50', tp1R: 1, tp2R: 3, splitTargetR: 2, valid: true });
    expect(short).toMatchObject({ mode: 'SPLIT_TP_50_50', tp1R: 1, tp2R: 3, splitTargetR: 2, valid: true });
  });

  it('uses retrospective actual entry only as a preview reference, never as a plan entry', () => {
    const result = calculateTargetRiskRewardFromDraft(draft, 100);
    const payload = revisionPayload(draft, true);
    expect(result).toMatchObject({ valid: true, tp1R: 2, mode: 'TP1_ONLY' });
    expect(payload?.entry_price).toBeNull();
    expect(payload).not.toHaveProperty('targetRR');
    expect(payload).not.toHaveProperty('targetRiskReward');
    expect(payload).not.toHaveProperty('splitTargetR');
    const html = renderPlanForm();
    expect(html).toContain('목표 손익비');
    expect(html).toContain('실제 진입가를 기준으로 현재 입력한 SL/TP 가격 구조');
    expect(html).toContain('공식 계획 결과(Plan R)는 실제 가격 경로로 별도 계산');
  });

  it('keeps unsupported split post-exit coverage separate from the official analysis n', () => {
    const rows = planCoverageItems({ coverage: {
      closed_trades: 5,
      plan_recorded: 5,
      official_r: 3,
      price_r_only: 0,
      r_unavailable: 0,
      ambiguous: 0,
      not_evaluable: 0,
      verified_pretrade: 0,
      retrospective: 5,
      legacy_single_tp: 3,
      split_tp: 2,
      split_post_exit_unsupported: 2,
    } } as Pick<PlanLabData, 'coverage'>, true);

    expect(rows.find((row) => row.label === '공식 USDT R')?.value).toBe(3);
    expect(rows.find((row) => row.label === '분할 계획 청산 후 분석 제외')?.value).toBe(2);
  });

  it('does not produce numeric R:R for missing or invalid price structures', () => {
    expect(calculateTargetRiskReward({ direction: 'Long', entry: null, stopLoss: 98, tp1: 104 }).mode).toBe('INCOMPLETE');
    expect(calculateTargetRiskReward({ direction: 'Long', entry: 100, stopLoss: 100, tp1: 104 }).mode).toBe('INVALID');
    expect(calculateTargetRiskReward({ direction: 'Long', entry: 100, stopLoss: 98, tp1: 104, tp2: 103 }).validationError).toBe('LONG_TP2_ORDER');
    expect(calculateTargetRiskRewardFromDraft({ ...draft, takeProfit2: 'not-a-number' }, 100).validationError).toBe('TP2_INVALID');
  });

  it('keeps retrospective actual entry out of planned entry fields', () => {
    expect(revisionPayload(draft, true)).toMatchObject({
      entry_price: null,
      entry_min: null,
      entry_max: null,
      stop_loss: 98,
      take_profit: 104,
    });
    expect(planEntryLabel(plan('RETROSPECTIVE', 1).latest_revision)).toBe('-');
    expect(revisionPayload(draft, false)).toBeNull();
  });

  it('sends TP2 as the optional trigger for the official fixed split rule', () => {
    expect(revisionPayload({ ...draft, entryPrice: '100', takeProfit2: '108' })).toMatchObject({
      take_profit: 104,
      take_profit_2: 108,
    });
    expect(revisionPayload({ ...draft, entryPrice: '100', takeProfit2: '' })).toMatchObject({
      take_profit_2: null,
    });
    expect(revisionPayload({ ...draft, entryPrice: '100', takeProfit2: '0' })).toBeNull();
  });

  it('restores saved TP2 and keeps old TP1-only plans explicitly unset', () => {
    const stored = plan('VERIFIED_PRETRADE', 1);
    stored.latest_revision.take_profit_2 = 108;
    stored.revisions[0].take_profit_2 = 108;
    const savedHtml = renderToStaticMarkup(<PlanDetailsDrawer
      plan={stored}
      entry={trade(1, '2026-01-01T10:00:00Z')}
      entries={[]}
      analysisRequested={false}
      analysisLoading={false}
      isKo
      onClose={() => undefined}
      onRevise={() => undefined}
      onLoadAnalysis={() => undefined}
    />);
    const legacyHtml = renderToStaticMarkup(<PlanDetailsDrawer
      plan={plan('VERIFIED_PRETRADE', 1)}
      entries={[]}
      analysisRequested={false}
      analysisLoading={false}
      isKo
      onClose={() => undefined}
      onRevise={() => undefined}
      onLoadAnalysis={() => undefined}
    />);

    expect(savedHtml).toContain('108');
    expect(savedHtml).toContain('TP1 · 50%');
    expect(savedHtml).toContain('TP2 · 잔여 50%');
    expect(legacyHtml).toContain('미설정');
    expect(legacyHtml).toContain('TP1 · 100%');
    expect(legacyHtml).not.toContain('계획 실행 결과');
    expect(savedHtml).toContain('Actual vs Plan');
  });

  it('renders official split legs and never recomputes total Plan R or Delta in the frontend', () => {
    const stored = plan('VERIFIED_PRETRADE', 1);
    stored.latest_revision.take_profit_2 = 108;
    stored.revisions[0].take_profit_2 = 108;
    const html = renderToStaticMarkup(<PlanDetailsDrawer
      plan={stored}
      entry={trade(1, '2026-01-01T10:00:00Z')}
      evaluation={splitEvaluation()}
      entries={[]}
      analysisRequested
      analysisLoading={false}
      isKo
      onClose={() => undefined}
      onRevise={() => undefined}
      onLoadAnalysis={() => undefined}
    />);

    expect(html).toContain('+9.99R');
    expect(html).toContain('-8.49R');
    expect(html).toContain('+199.80 USDT');
    expect(html).toContain('1차 익절');
    expect(html).toContain('2차 익절');
    expect(html).toContain('해당 가격의 R');
    expect(html).toContain('전체 결과 기여 R');
    expect(html).toContain('TP1에서 50% 청산 후 남은 50%가 TP2에서 청산');
  });

  it('shows the official not-evaluable reason without inventing an exit order', () => {
    const stored = plan('VERIFIED_PRETRADE', 1);
    stored.latest_revision.take_profit_2 = 108;
    stored.revisions[0].take_profit_2 = 108;
    const html = renderToStaticMarkup(<PlanDetailsDrawer
      plan={stored}
      entry={trade(1, '2026-01-01T10:00:00Z')}
      evaluation={splitEvaluation({
        evaluation_status: 'NOT_EVALUABLE',
        planned_result_r: null,
        planned_result_pnl: null,
        execution_delta_r: null,
        plan_legs: [],
        simulation_ambiguity_reason: 'TP1_SL_SAME_CANDLE',
      })}
      entries={[]}
      analysisRequested
      analysisLoading={false}
      isKo
      onClose={() => undefined}
      onRevise={() => undefined}
      onLoadAnalysis={() => undefined}
    />);

    expect(html).toContain('같은 완료봉에서 TP1과 손절가가 모두 닿아');
    expect(html).toContain('평가 가능한 가격 경로가 없습니다');
  });

  it('explains TP1-to-stop and TP1-to-horizon from backend leg outcomes', () => {
    const stored = plan('VERIFIED_PRETRADE', 1);
    stored.latest_revision.take_profit_2 = 108;
    stored.revisions[0].take_profit_2 = 108;
    const renderOutcome = (evaluation: PlanEvaluation) => renderToStaticMarkup(<PlanDetailsDrawer
      plan={stored}
      entry={trade(1, '2026-01-01T10:00:00Z')}
      evaluation={evaluation}
      entries={[]}
      analysisRequested
      analysisLoading={false}
      isKo
      onClose={() => undefined}
      onRevise={() => undefined}
      onLoadAnalysis={() => undefined}
    />);
    const stopHtml = renderOutcome(splitEvaluation({
      evaluation_status: 'TP1_SL',
      plan_legs: [
        { type: 'TP1', fraction: 0.5, exit_price: 104, price_r: 1, contribution_r: 0.5, status: 'FILLED' },
        { type: 'SL', fraction: 0.5, exit_price: 98, price_r: -1, contribution_r: -0.5, status: 'FILLED' },
      ],
    }));
    const horizonHtml = renderOutcome(splitEvaluation({
      evaluation_status: 'TP1_HORIZON',
      plan_legs: [
        { type: 'TP1', fraction: 0.5, exit_price: 104, price_r: 1, contribution_r: 0.5, status: 'FILLED' },
        { type: 'HORIZON', fraction: 0.5, exit_price: 101, price_r: 0.5, contribution_r: 0.25, status: 'FILLED' },
      ],
    }));

    expect(stopHtml).toContain('남은 50%가 원래 계획 손절가에서 청산');
    expect(horizonHtml).toContain('남은 50%는 TP2와 손절가에 도달하지 않아 관찰 종료 가격');
  });

  it('distinguishes missing, retrospective, and verified states after refresh', () => {
    expect(planStatusForEntry(1, [])).toBe('NO_PLAN');
    expect(planStatusForEntry(1, [plan('RETROSPECTIVE', 1)])).toBe('RETROSPECTIVE');
    expect(planStatusForEntry(1, [plan('VERIFIED_PRETRADE', 1)])).toBe('VERIFIED_PRETRADE');
  });

  it('does not request heavy analysis on cold mount', async () => {
    expect(shouldLoadPlanLabAnalysis(false, true)).toBe(false);
    expect(shouldLoadPlanLabAnalysis(true, true)).toBe(true);
    expect(shouldLoadPlanLabAnalysis(true, false)).toBe(false);

    const request = vi.fn().mockResolvedValue({ success: true });
    const client = new QueryClient();
    const observer = new QueryObserver(client, {
      queryKey: ['plan-lab', 'cold-mount'],
      queryFn: request,
      enabled: shouldLoadPlanLabAnalysis(false, true),
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(0);

    observer.setOptions({
      queryKey: ['plan-lab', 'cold-mount'],
      queryFn: request,
      enabled: shouldLoadPlanLabAnalysis(true, true),
    });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    unsubscribe();
    client.clear();
  });

  it('moves to the next missing trade and reports the last one', () => {
    const newest = trade(3, '2026-01-03T10:00:00Z');
    const older = trade(2, '2026-01-02T10:00:00Z');
    expect(nextMissingTrade(newest, [newest, older])?.id).toBe(2);
    expect(nextMissingTrade(newest, [newest])).toBeUndefined();
    expect(renderPlanForm({ saved: true, hasNextMissing: false })).toContain('계획 미입력 거래를 모두 입력했습니다');
  });

  it('renders save success and failure without stale status', () => {
    expect(renderPlanForm({ saved: true })).toContain('회고 계획이 저장되었습니다');
    const failed = renderPlanForm({ saved: false, error: '저장 실패' });
    expect(failed).toContain('저장 실패');
    expect(failed).not.toContain('회고 계획이 저장되었습니다');
  });

  it('hides hindsight result fields before retrospective save', () => {
    const html = renderPlanForm({ saved: false });
    expect(html).toContain('실제 진입가');
    expect(html).toContain('실제 청산가');
    expect(html).toContain('TP2 · 잔여 50%');
    expect(html).toContain('거래 분석');
    expect(html).not.toContain('Setup');
    expect(html).not.toContain('실제 결과');
    expect(html).not.toContain('1.50R');
    expect(html).not.toContain('MFE');
    expect(html).not.toContain('Actual R');
  });
});
