// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { JournalBehaviorAnalysisData } from '../../types';
import TradeBehaviorAnalysis from './TradeBehaviorAnalysis';

afterEach(cleanup);

it.each([false, true])('shows current legacy values without claiming verified pre-trade evidence (ko=%s)', (isKo) => {
  const stats = { trade_count: 1, pnl_sample_count: 1, r_sample_count: 0 };
  const data: JournalBehaviorAnalysisData = {
    items: [{ journal_id: 1, symbol: 'BTC/USDT', direction: 'Long', market_regime: {}, trend_states: {},
      setup_tags: [], mistake_tags: [], rule_checks: [], rule_status: 'unknown', issues: [],
      plan: { planned_stop_pct: 4, planned_target_pct: 2, planned_rr: 0.5,
        recording_phase: 'before_entry', eligible_for_exit_plan_review: false, eligible_for_entry_rule_review: false,
        stop_status: 'overrun', target_status: 'gave_back_after_hit' } }],
    summary: stats, plan_summary: { recorded_trade_count: 1, full_plan_trade_count: 1, stop_overrun_count: 0, target_giveback_count: 0, post_exit_record_count: 0 },
    setup_stats: [], mistake_stats: [], biggest_leaks: [], rule_status_stats: { compliant: stats, violation: stats, unknown: stats },
    rules: [], condition_options: [], minimum_conclusion_sample: 5,
    coverage: { selected_closed_positions: 1, behavior_items: 1, missing_quality_items: 0 }, warnings: [],
  };
  render(<TradeBehaviorAnalysis data={data} isLoading={false} isError={false} startTime={1} endTime={2}
    minimumAbsNetReturnPct={0} isKo={isKo} onRetry={vi.fn()} onSelectTrade={vi.fn()} showRules={false} showComparison={false} />);
  expect(screen.getByText(/SL 4% · TP 2% · RR 1:0.5/)).toBeTruthy();
  const label = screen.getByText(isKo ? '현재 기록: 과거 진입 전 상태 검증 불가' : 'Current note: historical pre-trade status unavailable');
  expect(label.className).not.toContain('text-bear');
  expect(screen.queryByText(/edited after entry|진입 후 수정/i)).toBeNull();
  expect(screen.queryByText(isKo ? '계획 손절률 초과' : 'Stop exceeded')).toBeNull();
});
