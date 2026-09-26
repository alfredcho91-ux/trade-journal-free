// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { getReview } from '../../api/review';
import type { Classification, TradingReview } from '../../types/review';
import ReviewSummary from './ReviewSummary';
import ReviewWorkspace from './ReviewWorkspace';
import { diagnosisFixture, patternFixture, reviewDiscovery, tradingFixture } from './reviewFixtures';

vi.mock('../../api/review', () => ({ getReview: vi.fn() }));
vi.mock('../../api/strategies', () => ({ listStrategies: vi.fn(async () => []), listStrategyVersions: vi.fn(async () => []) }));
const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); vi.clearAllMocks(); });
function show(data = tradingFixture(), isKo = false) {
  const onPattern = vi.fn(), onDiagnosis = vi.fn();
  render(<ReviewSummary data={data} metadata={reviewDiscovery()} onPattern={onPattern} onDiagnosis={onDiagnosis} isKo={isKo} />);
  return { onPattern, onDiagnosis };
}
const primary = () => within(screen.getByLabelText('Primary findings'));
const full = () => fireEvent.click(screen.getByRole('button', { name: 'Open full review — all findings and evidence' }));

it('shows at most three meaningful findings in documented deterministic buckets, retaining server order', () => {
  const data = tradingFixture();
  const first = diagnosisFixture('STRATEGY_WEAK_EXECUTION_HEALTHY');
  const second = { ...diagnosisFixture('STRATEGY_POSITIVE_EXECUTION_DRAG'), identity: { ...first.identity, key: 'other', label: 'Second strategy' } };
  data.strategy_execution.diagnoses = [{ ...diagnosisFixture(), identity: { ...first.identity, key: 'healthy' } }, first, second, { ...diagnosisFixture('INCONCLUSIVE'), identity: { ...first.identity, key: 'unclear' } }];
  data.patterns.candidates = [{ ...patternFixture('INSUFFICIENT_EVIDENCE'), dimension: 'focus_score' }, { ...patternFixture(), dimension: 'symbol', signed_delta: '0' }, patternFixture(), { ...patternFixture(), metric: 'net_return_pct', signed_delta: '-999999' }];
  show(data);
  const cards = primary().getAllByRole('article');
  expect(cards).toHaveLength(3);
  expect(within(cards[0]).getByRole('heading').textContent).toBe('Weak results alongside healthy execution');
  expect(within(cards[1]).getByRole('heading').textContent).toBe('Positive results alongside execution drag');
  expect(within(cards[2]).getByRole('heading').textContent).toContain('Average recorded R');
  expect(primary().queryByText(/999999/)).toBeNull();
  expect(screen.queryByText(/OBSERVED_EXECUTION_HEALTHY/)).toBeNull();
  full();
  expect(screen.getByRole('region', { name: 'Pattern findings' }).textContent).toContain('net_return_pct');
});
it('shows fewer than three rather than padding the summary and keeps zero-delta results in full review', () => {
  const data = tradingFixture(); data.patterns.candidates = [{ ...patternFixture(), signed_delta: '0.000e+12' }];
  show(data); expect(primary().getAllByRole('article')).toHaveLength(1);
  full(); expect(screen.getByRole('region', { name: 'Pattern findings' }).textContent).toContain('Delta 0');
});
it.each([
  ['STRATEGY_WEAK_EXECUTION_HEALTHY', 'Strategy'], ['STRATEGY_POSITIVE_EXECUTION_DRAG', 'Execution'],
  ['STRATEGY_WEAK_EXECUTION_DRAG', 'Strategy & Execution'], ['STRATEGY_POSITIVE_EXECUTION_HEALTHY', 'Strategy & Execution'],
] as [Classification, string][])('preserves %s without a causal or confidence claim', (classification, category) => {
  const data = tradingFixture(); data.patterns.candidates = []; data.strategy_execution.diagnoses = [diagnosisFixture(classification)];
  show(data);
  expect(primary().getByText(`${category} · Historical v1`)).toBeTruthy();
  expect(primary().getByText(/8 trades with evaluable execution rules/)).toBeTruthy();
  expect(primary().getByText(/Entries within limit/).textContent).toContain('10/10');
  expect(primary().queryByText(/caused|proves|confidence|will improve/i)).toBeNull();
  expect(primary().queryByRole('button', { name: /experiment/i })).toBeNull();
});
it('explains a low-evidence review, small sample, missing plans and unclear signals without calling them failures', () => {
  const data = tradingFixture();
  data.strategy_execution.diagnoses = [{ ...diagnosisFixture('INCONCLUSIVE'), reasons: ['INSUFFICIENT_PLAN_ENTRY_SAMPLE', 'NO_EVALUABLE_EXECUTION_RULES', 'EXECUTION_SIGNALS_CONFLICT'] }];
  data.patterns.candidates = [patternFixture('INSUFFICIENT_EVIDENCE')];
  show(data);
  expect(primary().queryAllByRole('article')).toHaveLength(0);
  expect(screen.getByText('No strong finding to highlight yet')).toBeTruthy();
  expect(screen.getByText(/small sample — interpret cautiously/)).toBeTruthy();
  expect(screen.getByText(/comparing linked plans with actual entries/)).toBeTruthy();
  expect(screen.getByText(/Cannot be evaluated does not mean violated/)).toBeTruthy();
  expect(screen.queryByText(/INSUFFICIENT_PLAN_ENTRY_SAMPLE/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Inspect unclear diagnoses' }));
  expect(screen.getByText(/INSUFFICIENT_PLAN_ENTRY_SAMPLE/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /experiment/i })).toBeNull();
});
it('distinguishes empty data from unavailable comparisons and keeps raw reconstruction metadata accessible', () => {
  const data = tradingFixture(); data.state = 'EMPTY_PERIOD'; data.evidence_quality.selected_trade_count = 0;
  show(data);
  expect(screen.getByText('No closed trades match')).toBeTruthy();
  expect(primary().queryAllByRole('article')).toHaveLength(0);
  expect(screen.queryByText(/MARKET_PATH_NOT_IN_SNAPSHOT/)).toBeNull();
  full();
  expect(screen.getAllByText(/MARKET_PATH_NOT_IN_SNAPSHOT/)).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: 'Raw result, reason codes and reconstruction policy' }));
  expect(screen.getByText(/"evaluation_basis": "CURRENT_RECONSTRUCTED"/)).toBeTruthy();
});
it('translates value-style group labels and offers one primary action with exact pattern context', () => {
  const data = tradingFixture(); data.strategy_execution.diagnoses = [];
  data.patterns.candidates = [{ ...patternFixture(), dimension: 'confidence_score', observed: { ...patternFixture().observed, identity: { ...patternFixture().observed.identity, label: 'value:4' } } }];
  const { onPattern } = show(data);
  expect(primary().getByRole('heading').textContent).toContain(': 4');
  expect(screen.queryByText(/value:4/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open experiment draft for this comparison' }));
  expect(onPattern).toHaveBeenCalledWith(data.patterns.candidates[0]);
  const expand = screen.getByRole('button', { name: 'Expand comparison evidence' });
  expect(expand.getAttribute('aria-expanded')).toBe('false'); fireEvent.click(expand);
  expect(expand.getAttribute('aria-expanded')).toBe('true'); expect(screen.getByText(/value:4/)).toBeTruthy();
  fireEvent.click(expand); expect(screen.queryByText(/value:4/)).toBeNull();
});
it('opens the exact diagnosis evidence and preserves the supported Experiment handoff', () => {
  const data = tradingFixture(); data.patterns.candidates = [];
  const { onDiagnosis } = show(data);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect Strategy and Execution evidence' }));
  expect(screen.getByRole('region', { name: 'Execution axis' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Create experiment from diagnosis' }));
  expect(onDiagnosis).toHaveBeenCalledWith(data.strategy_execution.diagnoses[0]);
});
it('has localized summary, caveats and actions with wrap-safe primary content', () => {
  show(tradingFixture(), true);
  expect(screen.getByRole('heading', { name: '먼저 살펴볼 발견' })).toBeTruthy();
  expect(screen.getByText(/현재 저널 기록으로 계산/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '이 비교로 실험 초안 열기' })).toBeTruthy();
  expect(screen.getByRole('region', { name: '복기 요약' }).className).toContain('min-w-0');
  expect(screen.getByRole('region', { name: '복기 요약' }).className).toContain('break-words');
  expect(screen.queryByRole('table')).toBeNull();
});
it('hides the prior summary and expanded evidence on filter edits and hands off only the newer response', async () => {
  let resolve!: (value: TradingReview) => void;
  const late = new Promise<TradingReview>(r => { resolve = r; });
  const newer = tradingFixture(); newer.patterns.candidates = [{ ...patternFixture(), metric: 'adherence_pct' }];
  vi.mocked(getReview).mockResolvedValueOnce(tradingFixture()).mockReturnValueOnce(late).mockResolvedValueOnce(newer);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); clients.push(client);
  const handoff = vi.fn();
  render(<QueryClientProvider client={client}><ReviewWorkspace metadata={reviewDiscovery()} onExperiment={handoff} /></QueryClientProvider>);
  fireEvent.change(screen.getByLabelText('Start time *'), { target: { value: '2026-01-01T00:00:00.000' } });
  fireEvent.click(screen.getByText('Run review')); await screen.findByRole('region', { name: 'Review summary' }); full();
  fireEvent.change(screen.getByLabelText('End time *'), { target: { value: '2026-02-28T23:59:59.999' } });
  expect(screen.queryByRole('region', { name: 'Review summary' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Pattern findings' })).toBeNull();
  fireEvent.click(screen.getByText('Run review')); await screen.findByText('Loading review evidence…');
  fireEvent.change(screen.getByLabelText('End time *'), { target: { value: '2026-03-31T23:59:59.999' } });
  fireEvent.click(screen.getByText('Run review')); await screen.findByRole('region', { name: 'Review summary' });
  await act(async () => resolve(tradingFixture()));
  fireEvent.click(screen.getByRole('button', { name: 'Open experiment draft for this comparison' }));
  expect(handoff).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ metric: 'adherence_pct' }), baseline: expect.objectContaining({ end_time: Date.parse('2026-03-31T23:59:59.999Z') }) }));
  expect(screen.queryByRole('region', { name: 'Pattern findings' })).toBeNull();
});
