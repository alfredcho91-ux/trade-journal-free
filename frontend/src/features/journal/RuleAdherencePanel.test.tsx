// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getJournalStrategyEvaluation } from '../../api/journal';
import type {
  JournalStrategyEvaluation,
  RuleEvaluationResult,
  RuleEvaluationSummary,
} from '../../types';
import RuleAdherencePanel from './RuleAdherencePanel';

vi.mock('../../api/journal', () => ({
  getJournalStrategyEvaluation: vi.fn(),
}));

const mockedGetEvaluation = vi.mocked(getJournalStrategyEvaluation);

const summary = (overrides: Partial<RuleEvaluationSummary> = {}): RuleEvaluationSummary => ({
  total_rules: 3,
  evaluable_rules: 2,
  followed_rules: 1,
  violated_rules: 1,
  not_evaluable_rules: 1,
  adherence_pct: '50.00',
  coverage_pct: '66.67',
  ...overrides,
});

const rule = (overrides: Partial<RuleEvaluationResult> = {}): RuleEvaluationResult => ({
  rule_id: 'entry-confidence',
  category: 'ENTRY',
  text: 'Only enter with confidence',
  status: 'FOLLOWED',
  reason_code: null,
  condition: {
    metric_id: 'psychology.confidence_score',
    operator: 'gte',
    expected: '4',
    unit: 'score',
    value_type: 'numeric',
  },
  observation: {
    available: true,
    value: '5',
    unit: 'score',
    source: 'journal_entry',
    record_id: 41,
    reason_code: null,
  },
  explanation: {
    template_id: 'numeric_gte_followed',
    message: 'Observed 5 score met the minimum of 4 score.',
  },
  ...overrides,
});

function evaluation(overrides: Partial<JournalStrategyEvaluation> = {}): JournalStrategyEvaluation {
  return {
    journal_entry_id: 41,
    evaluation_basis: 'CURRENT_RECONSTRUCTED',
    strategy: { id: 2, name: 'Breakout Momentum', archived_at: null },
    strategy_version: {
      id: 12,
      strategy_id: 2,
      sequence: 3,
      version_label: 'v3.0',
      description: 'Strict breakout rules',
      is_active: true,
      retired_at: null,
      created_at: '2026-08-01T00:00:00Z',
      assigned_at: '2026-08-02T00:00:00Z',
      assignment_updated_at: '2026-08-03T00:00:00Z',
    },
    summary: {
      overall: summary(),
      entry: summary({ total_rules: 1, evaluable_rules: 1, followed_rules: 1, violated_rules: 0, not_evaluable_rules: 0, adherence_pct: '100.00', coverage_pct: '100.00' }),
      risk: summary({ total_rules: 1, evaluable_rules: 1, followed_rules: 0, violated_rules: 1, not_evaluable_rules: 0, adherence_pct: '0.00', coverage_pct: '100.00' }),
      exit: summary({ total_rules: 1, evaluable_rules: 0, followed_rules: 0, violated_rules: 0, not_evaluable_rules: 1, adherence_pct: null, coverage_pct: '0.00' }),
    },
    rules: [
      rule(),
      rule({
        rule_id: 'risk-stop',
        category: 'RISK',
        text: 'Keep stop risk below limit',
        status: 'VIOLATED',
        condition: { metric_id: 'plan.stop_distance_pct', operator: 'lte', expected: '1.5', unit: 'percent', value_type: 'numeric' },
        observation: { available: true, value: '2.0', unit: 'percent', source: 'plan_revision', record_id: 99, reason_code: null },
        explanation: { template_id: 'numeric_lte_violated', message: 'Observed 2.0 percent exceeded 1.5 percent.' },
      }),
      rule({
        rule_id: 'exit-r',
        category: 'EXIT',
        text: 'Close above one R',
        status: 'NOT_EVALUABLE',
        reason_code: 'TRADE_NOT_CLOSED',
        condition: null,
        observation: { available: false, value: null, unit: null, source: null, record_id: null, reason_code: 'TRADE_NOT_CLOSED' },
        explanation: { template_id: 'not_evaluable', message: 'This rule cannot be evaluated until the trade closes.' },
      }),
    ],
    ...overrides,
  };
}

function renderPanel(entryId = 41, isKo = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><RuleAdherencePanel entryId={entryId} isKo={isKo} /></QueryClientProvider>);
  return { client, ...view };
}

beforeEach(() => mockedGetEvaluation.mockResolvedValue(evaluation()));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('RuleAdherencePanel', () => {
  it('loads the selected journal entry through the strategy-evaluation contract', async () => {
    renderPanel(41);
    expect(screen.getByLabelText('Rule Adherence')).toBeTruthy();
    expect(screen.getByText('Loading rule evaluation')).toBeTruthy();
    await screen.findByText('Breakout Momentum');
    expect(mockedGetEvaluation).toHaveBeenCalledWith(41);
    expect(screen.getByText('Based on current saved records')).toBeTruthy();
    expect(screen.getByText('50.00%')).toBeTruthy();
    expect(screen.getByText('66.67%')).toBeTruthy();
  });

  it('renders a neutral no-assignment state without inferring a strategy', async () => {
    mockedGetEvaluation.mockResolvedValue(null);
    renderPanel();
    expect(await screen.findByText('No Strategy Version assigned')).toBeTruthy();
    expect(screen.queryByText('Breakout Momentum')).toBeNull();
  });

  it('shows exact strategy/version provenance and active lifecycle', async () => {
    renderPanel();
    await screen.findByText('Breakout Momentum');
    expect(screen.getByText('v3.0')).toBeTruthy();
    expect(screen.getByText('ACTIVE')).toBeTruthy();
    expect(screen.getByText(/Assigned version #3/)).toBeTruthy();
  });

  it.each([
    [{ is_active: false, retired_at: null }, 'INACTIVE'],
    [{ is_active: false, retired_at: '2026-08-10T00:00:00Z' }, 'RETIRED'],
  ])('preserves inactive and retired version provenance', async (versionState, expectedLabel) => {
    mockedGetEvaluation.mockResolvedValue(evaluation({
      strategy_version: { ...evaluation().strategy_version, ...versionState },
    }));
    renderPanel();
    expect(await screen.findByText(expectedLabel)).toBeTruthy();
  });

  it('preserves archived Strategy provenance instead of hiding it', async () => {
    mockedGetEvaluation.mockResolvedValue(evaluation({
      strategy: { id: 2, name: 'Archived Breakout', archived_at: '2026-08-20T00:00:00Z' },
    }));
    renderPanel();
    expect(await screen.findByText('ARCHIVED STRATEGY')).toBeTruthy();
    expect(screen.getByText('Archived Breakout')).toBeTruthy();
  });

  it('renders backend statuses, explanations, conditions, observations, and provenance without recomputing', async () => {
    renderPanel();
    await screen.findByText('Only enter with confidence');
    expect(screen.getByText('FOLLOWED').closest('li')?.className).toContain('text-bull');
    expect(screen.getByText('VIOLATED').closest('li')?.className).toContain('text-bear');
    expect(screen.getByText('NOT EVALUABLE').closest('li')?.className).toContain('text-dark-400');
    expect(screen.getByText('Observed 5 score met the minimum of 4 score.')).toBeTruthy();
    expect(screen.getByText(/psychology.confidence_score gte 4 score/)).toBeTruthy();
    expect(screen.getByText(/Source: journal_entry #41/)).toBeTruthy();
  });

  it('explains TRADE_NOT_CLOSED as neutral and keeps the backend explanation', async () => {
    renderPanel();
    await screen.findByText('Close above one R');
    expect(screen.getByText('Available after the trade closes')).toBeTruthy();
    expect(screen.getByText('This rule cannot be evaluated until the trade closes.')).toBeTruthy();
  });

  it('explains descriptive NO_EVALUATOR rules as neutral', async () => {
    const descriptive = rule({
      rule_id: 'descriptive',
      text: 'Wait for a clean structure',
      status: 'NOT_EVALUABLE',
      reason_code: 'NO_EVALUATOR',
      condition: null,
      observation: { available: false, value: null, unit: null, source: null, record_id: null, reason_code: 'NO_EVALUATOR' },
      explanation: { template_id: 'no_evaluator', message: 'This descriptive rule has no evaluator.' },
    });
    mockedGetEvaluation.mockResolvedValue(evaluation({
      summary: { ...evaluation().summary, entry: summary({ total_rules: 1, evaluable_rules: 0, followed_rules: 0, violated_rules: 0, not_evaluable_rules: 1, adherence_pct: null, coverage_pct: '0.00' }) },
      rules: [descriptive],
    }));
    renderPanel();
    expect(await screen.findByText('Not automatically evaluable')).toBeTruthy();
    expect(screen.queryByText('VIOLATED')).toBeNull();
  });

  it('keeps adherence and coverage distinct and renders null as unavailable, never zero', async () => {
    mockedGetEvaluation.mockResolvedValue(evaluation({
      summary: {
        ...evaluation().summary,
        overall: summary({ evaluable_rules: 0, followed_rules: 0, violated_rules: 0, not_evaluable_rules: 3, adherence_pct: null, coverage_pct: '0.00' }),
      },
    }));
    renderPanel();
    await screen.findByText('Breakout Momentum');
    const panel = screen.getByLabelText('Rule Adherence');
    expect(within(panel).getByText('Unavailable')).toBeTruthy();
    expect(within(panel).getAllByText('0.00%').length).toBeGreaterThan(0);
    expect(within(panel).queryByText('0%', { exact: true })).toBeNull();
  });

  it('renders null coverage as unavailable rather than inventing zero coverage', async () => {
    mockedGetEvaluation.mockResolvedValue(evaluation({
      summary: { ...evaluation().summary, overall: summary({ coverage_pct: null }) },
    }));
    renderPanel();
    await screen.findByText('Breakout Momentum');
    const panel = screen.getByLabelText('Rule Adherence');
    expect(within(panel).getByText('Unavailable')).toBeTruthy();
    expect(within(panel).getByText('50.00%')).toBeTruthy();
  });

  it('uses backend entry/risk/exit summaries directly', async () => {
    renderPanel();
    await screen.findByText('Breakout Momentum');
    expect(screen.getByText('ENTRY').parentElement?.textContent).toContain('Adherence 100.00%');
    expect(screen.getByText('RISK').parentElement?.textContent).toContain('Adherence 0.00%');
    expect(screen.getByText('EXIT').parentElement?.textContent).toContain('Coverage 0.00%');
  });

  it('omits category clutter when the backend reports zero rules', async () => {
    mockedGetEvaluation.mockResolvedValue(evaluation({
      summary: { ...evaluation().summary, exit: summary({ total_rules: 0, evaluable_rules: 0, followed_rules: 0, violated_rules: 0, not_evaluable_rules: 0, adherence_pct: null, coverage_pct: null }) },
      rules: evaluation().rules.filter((item) => item.category !== 'EXIT'),
    }));
    renderPanel();
    await screen.findByText('Breakout Momentum');
    expect(screen.queryByRole('heading', { name: 'EXIT' })).toBeNull();
  });

  it('contains API failures and retries without removing the panel', async () => {
    mockedGetEvaluation.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(evaluation());
    const user = userEvent.setup();
    renderPanel();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByLabelText('Rule Adherence')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Breakout Momentum')).toBeTruthy();
    expect(mockedGetEvaluation.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mockedGetEvaluation).toHaveBeenLastCalledWith(41);
  });

  it('isolates async A/B loads so a late A response cannot hydrate B', async () => {
    let resolveA: ((value: JournalStrategyEvaluation) => void) | undefined;
    mockedGetEvaluation.mockImplementation((entryId) => entryId === 41
      ? new Promise((resolve) => { resolveA = resolve; })
      : Promise.resolve(evaluation({ journal_entry_id: 42, strategy: { id: 3, name: 'Strategy B', archived_at: null } })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><RuleAdherencePanel entryId={41} isKo={false} /></QueryClientProvider>);
    view.rerender(<QueryClientProvider client={client}><RuleAdherencePanel entryId={42} isKo={false} /></QueryClientProvider>);
    expect(await screen.findByText('Strategy B')).toBeTruthy();
    await act(async () => resolveA?.(evaluation({ strategy: { id: 2, name: 'Late Strategy A', archived_at: null } })));
    expect(screen.getByText('Strategy B')).toBeTruthy();
    expect(screen.queryByText('Late Strategy A')).toBeNull();
  });

  it('renders Korean labels without altering backend status data', async () => {
    renderPanel(41, true);
    await screen.findByText('Breakout Momentum');
    expect(screen.getByText('규칙 준수')).toBeTruthy();
    expect(screen.getByText('현재 저장된 기록을 기준으로 재구성')).toBeTruthy();
    expect(screen.getByText('거래 종료 후 평가 가능')).toBeTruthy();
  });
});
