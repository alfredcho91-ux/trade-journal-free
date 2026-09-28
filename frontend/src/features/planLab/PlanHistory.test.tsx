// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import type { PlanRevision, TradingPlan } from '../../types';
import PlanHistory from './PlanHistory';
import { revisionChanges, revisionTiming } from './planPresentation';

afterEach(cleanup);
const before: PlanRevision = { id: 1, plan_id: 7, version: 2, entry_price: 90000, stop_loss: 88200, take_profit: 93600, setup: 'Pullback', entry_note: 'Support', received_at: '2026-01-01T08:00:00.123Z', created_at: '2026-01-01T08:00:00.123Z', phase: 'PRE_TRADE' };
const later: PlanRevision = { ...before, id: 2, version: 3, take_profit: 94500, setup: 'Retest', entry_note: 'Later rationale', phase: 'POST_TRADE_INPUT', received_at: '2026-01-03T08:00:00Z' };
const plan: TradingPlan = { id: 7, source: 'VERIFIED_PRETRADE', exchange: 'binance', symbol: 'BTCUSDT', symbol_key: 'BTCUSDT', side: 'Long', status: 'linked', revisions: [before, later], latest_revision: later, received_at: before.received_at, created_at: before.created_at, updated_at: later.received_at, link: { id: 9, plan_id: 7, journal_entry_id: 10, link_status: 'LINKED', linked_at: later.received_at, updated_at: later.received_at } };

it.each([false, true])('keeps entry-time and latest separate, exact history hidden but inspectable, locale %s', async isKo => {
  const snapshot = structuredClone(plan);
  render(<PlanHistory plan={plan} entryRevision={before} analysisRevision={before} analysisBasis="VERIFIED_PRETRADE" isKo={isKo} />);
  expect(screen.getByRole('heading', { name: isKo ? '진입 시점의 계획 · 진입 전에 기록됨 · v2' : 'At trade entry · recorded before entry · v2' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: isKo ? '현재 계획 버전 · v3' : 'Current plan revision · v3' })).toBeTruthy();
  expect(screen.getByText(isKo ? '1차 목표가: 93600 → 94500' : 'Target 1: 93600 → 94500', { selector: 'article p' })).toBeTruthy();
  expect(screen.getByText(isKo ? '거래 종료 후 기록됨' : 'Recorded after trade exit', { selector: 'article p' })).toBeTruthy();
  const raw = screen.getByText(/"analysis_basis": "VERIFIED_PRETRADE"/);
  expect(raw.closest('details')?.open).toBe(false);
  const user = userEvent.setup();
  await user.click(screen.getByText(isKo ? '전체 버전 이력과 정확한 기록 정보' : 'Full version history and exact provenance'));
  expect(screen.getByText(before.received_at, { selector: 'time' }).closest('details')?.open).toBe(true);
  expect(screen.getByText(before.received_at, { selector: 'time' })).toBeTruthy();
  await user.click(screen.getByText(isKo ? '원본 식별자·출처·저장 값' : 'Raw IDs, provenance and stored values'));
  expect(raw.closest('details')?.open).toBe(true);
  expect(JSON.parse(raw.textContent!).plan).toEqual(snapshot);
  expect(plan).toEqual(snapshot);
});

it('does not infer entry eligibility or latest timing from source or version ordering', () => {
  const unknown = { ...later, phase: undefined };
  render(<PlanHistory plan={{ ...plan, revisions: [before, unknown], latest_revision: unknown }} entryRevision={before} analysisBasis="NOT_ELIGIBLE" isKo={false} />);
  expect(screen.queryByRole('heading', { name: /At trade entry/ })).toBeNull();
  expect(screen.getByText('No version is verified as this trade’s pre-entry plan.')).toBeTruthy();
  expect(screen.getByText('Timing relative to entry not verified', { selector: 'article p' })).toBeTruthy();
  expect(revisionTiming({ ...before, phase: 'POST_ENTRY_EDIT' }, false)).toBe('Recorded at or after entry');
});

it.each([false, true])('labels retrospective comparison without inventing an original plan, locale %s', isKo => {
  render(<PlanHistory plan={{ ...plan, source: 'RETROSPECTIVE' }} analysisRevision={later} analysisBasis="RETROSPECTIVE" isKo={isKo} />);
  expect(screen.getByText(isKo ? /거래 후 복기를 위해 기록한 계획/ : /Plan recorded after the trade for review/)).toBeTruthy();
  expect(screen.getByText(isKo ? /회고 비교에 사용하는 버전/ : /Version used for retrospective comparison/)).toBeTruthy();
  expect(screen.queryByRole('heading', { name: /At trade entry|진입 시점의 계획/ })).toBeNull();
});

it('compares stored entry ranges, text and cleared values without mutation', () => {
  const next = { ...later, entry_price: null, entry_min: 89000, entry_max: 91000, stop_loss: 87000, take_profit_2: 95000, entry_note: '', max_hold_hours: 4 };
  const snapshot = structuredClone([before, next]);
  const changes = revisionChanges(before, next, false);
  expect(changes).toContainEqual({ key: 'entry_price', label: 'Entry', before: '90000', after: '—' });
  expect(changes).toContainEqual({ key: 'entry_note', label: 'Entry rationale', before: 'Support', after: '—' });
  expect([before, next]).toEqual(snapshot);
});

it('identifies the same current and entry-time version without inventing a later update', () => {
  render(<PlanHistory plan={{ ...plan, revisions: [before], latest_revision: before }} entryRevision={before} analysisBasis="VERIFIED_PRETRADE" isKo={false} />);
  const current = screen.getByRole('heading', { name: 'Current plan revision · v2' }).closest('article')!;
  expect(within(current).getByText(/Same as the entry-time version/)).toBeTruthy();
  expect(screen.queryByText(/Changes from/)).toBeNull();
});
