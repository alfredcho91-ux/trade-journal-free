import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentProps } from 'react';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import type { JournalEntry, TradingPlan } from '../types';
import {
  nextMissingTrade,
  planEntryLabel,
  planStatusForEntry,
  revisionPayload,
  shouldLoadPlanLabAnalysis,
  type PlanDraft,
} from '../features/planLab/pastTradePlan';
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
    expect(html).not.toContain('실제 결과');
    expect(html).not.toContain('1.50R');
    expect(html).not.toContain('MFE');
    expect(html).not.toContain('Actual R');
  });
});
