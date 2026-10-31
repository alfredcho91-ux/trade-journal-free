# Strategy Discovery

Implementation: v1.0.29 limited-beta prerelease. The v1.0.28 ZIP does
not contain this feature. Route: `/strategy-discovery`; navigation: 전략 발견 /
Strategy Discovery. No dependency, exchange integration or existing financial
calculation changes are required.

## Product flow

Choose a period and optional symbols/direction → explicitly run discovery →
inspect candidates and frozen evidence → review/edit the existing Strategy
editor → explicitly register in Playbook. Registration creates the active first
version using existing Playbook behavior. Discovery does not assign a strategy
to past trades, execute orders, activate an Experiment, or call an LLM.

The MVP discovers symbol/direction conditions on **recorded closed positions**.
It does not reconstruct every market opportunity or generate risk/exit rules.
Users can add these in the editor, but the original candidate evidence then
does not apply to the changed definition.

## Backend boundaries

`backend/modules/strategy_discovery/`:

- `schemas.py`: bounded request and evidence contracts; only period, symbols,
  direction and the primary metric can select the analysis population.
- `feature_policy.py`: engine/policy version, allowlisted features and limits.
- `engine.py`: pure candidate enumeration, discovery-only ranking and holdout
  evaluation; no database or network access.
- `service.py`: one existing Analytics read snapshot, minimal input extraction,
  bounded work, then a short persistence transaction. One analysis may run at a
  time per process; another request receives `429 DISCOVERY_BUSY`.
- `repository.py`: immutable runs/candidates/adoptions in the selected profile's
  existing Journal SQLite database. GET endpoints do not create schemas or
  recalculate source data. Startup installs the additive schema.
- `adoption.py`: shared Strategy normalization and a transaction-scoped Strategy
  insert, with provenance saved in the same transaction.
- `router.py`: existing authentication, local-request security, error envelope
  and worker-thread execution.

The existing `AnalyticsFilters.symbols` exact-match meaning is unchanged.
Discovery normalizes its own symbol filter with the same function as Rule
Engine `trade.symbol`, so `BTC/USDT:USDT` and `BTCUSDT` match the generated rule.
Direction/time scope is read through Analytics; Discovery filters normalized
symbols from that snapshot before applying its selected-trade limit.

## Discovery and evaluation policy v1

- UTC inclusive close-time range. The split is at 70% of the **requested time
  interval**, not 70% of observed trade count.
- Trades entered before the requested start, missing/invalid entry/close times,
  and trades crossing the split are excluded and counted. Discovery trades
  close strictly before the split; holdout trades enter at/after it.
- Only discovery facts define the symbol/direction search space. Enumerate
  single conditions and symbol+direction pairs; deduplicate identical discovery
  memberships, keeping the simpler first definition. Whole-population conditions
  are not candidates.
- Requested symbol/direction scope is merged into every generated rule document
  (equality or membership). A Long candidate discovered inside BTCUSDT cannot
  silently become an all-symbol Long strategy. Dates remain research scope,
  not entry signals. Removing a scope rule changes the rule fingerprint.
- Primary metric: existing average net return on invested margin by default,
  or average recorded R. No R reconstruction from price return.
- Each compared population needs at least five evaluable trades and 80%
  coverage. Candidates need a positive discovery mean and positive uplift over
  all eligible discovery trades. The baseline includes the candidate subset.
- Rank by discovery uplift descending, then discovery sample descending and
  canonical conditions. Evaluate the fixed shortlist in holdout afterward;
  never choose/rerank by holdout results.
- Holdout states: `CONSISTENT`, `WEAKENED`, `INSUFFICIENT_EVIDENCE`. Consistent
  means the positive result and uplift both repeat with the required sample /
  coverage; it is not statistical significance or a future performance claim.
- Limits: 2,000 selected trades, 32 discovered symbols, two conditions,
  64 returned candidates. Attempted condition and shortlist counts are recorded.
  Existing Analytics snapshot/Plan row bounds still apply to source reads.
- Average R, average return and win rate reuse existing aggregations and missing
  value semantics. No verified PnL settlement currency is stored, so Profit
  Factor remains `PNL_CURRENCY_UNVERIFIED`; fee currency is not a substitute.
- No psychological/retrospective Setup, realized outcome, actual holding time,
  or close-hour feature is converted into an entry condition.

## Persistence and retry behavior

Three additive tables use foreign keys and UPDATE/DELETE guards:

| Table | Contents |
|---|---|
| `strategy_discovery_runs` | Request, request hash, unique idempotency key, engine/policy versions, input fingerprint, minimal frozen entries/observations, summary and timestamp |
| `strategy_discovery_candidates` | Run/rank, conditions, generated rule document, segment metrics/baselines, membership IDs, holdout status and reasons |
| `strategy_discovery_adoptions` | Candidate, unique idempotency key, request hash, Strategy/Version IDs, saved-rule fingerprint, modification flag and timestamp |

Minimal frozen inputs contain calculation fields, source identity/times and the
required Rule Engine observations. They do not copy API keys, free-form notes,
psychological fields, Setup tags or entire Plan documents. A fingerprint alone
is not used as a substitute for preserved inputs. Original result records remain
fixed when source trades are edited/deleted. Original calculation code/version
is required to reproduce old results; future calculation changes must version
the discovery contract appropriately.

Runs persist only after successful computation, atomically with all candidates.
An interrupted computation does not leave a fake completed run. A lost response
can be retried with the same UUID `Idempotency-Key`; the original persisted
result is returned without rereading mutable source records. Changed content
under the same key returns 409.

Adoption inserts Strategy, its active first Version and provenance atomically.
A failure rolls back all three. A candidate can be registered once; an identical
replay returns the same registration and conflicting content returns 409.
Rule fingerprints ignore evaluated-rule labels/IDs/order but preserve evaluator
semantics, category and descriptive rules. Adding/changing risk or exit rules
marks the saved strategy as needing separate evaluation. Names/descriptions do
not alter the rule fingerprint. The original candidate is never rewritten.

## API

Existing `{success, data}` envelopes and error handling apply.

| Method | Path after `/api/strategy-discovery` | Behavior |
|---|---|---|
| GET | `/metadata` | Supported features, metrics, policies and limits |
| POST | `/runs` | Explicit compute-and-save; UUID `Idempotency-Key` required |
| GET | `/runs?offset=0&limit=20` | Run history, max page size 50 |
| GET | `/runs/{id}` | Stored run and ranked candidates |
| GET | `/candidates/{id}` | Stored candidate and registration if present |
| GET | `/candidates/{id}/evidence?offset=0&limit=50` | Frozen, paginated evidence trades |
| POST | `/candidates/{id}/adopt` | `{strategy: StrategyCreate}`; UUID key required |

Profile/database paths are server-bound, not supplied in the request. Existing
isolated sample processes use their own database and offline/credential boundary.

## Frontend

`StrategyDiscoveryPage` owns route selection and mutation coordination;
`features/strategyDiscovery/` contains filters, candidate list/detail and the
adapter to the existing `NewStrategyDrawer`. API/types/query keys have dedicated
files. React Query owns server data; forms own unsaved input. No global discovery
store or duplicated financial calculation is introduced.

`?run=...&candidate=...` survives refresh. Analysis is explicit, never a mount /
focus side effect. The filter form configures a new analysis; stored results
show the selected run's own period and metric. Retry keys survive request errors. Submission authority keeps
an older response from replacing a newer selection. Candidate evidence loads
only when requested. Registration uses the existing focus/dirty-state hooks,
locks controls while saving, preserves input after errors, and links to
`/playbook?strategy=...` after success. Modified-rule registration is visibly
distinguished from unchanged-rule registration.

Existing tokens, 56px header and desktop/tablet shell remain in use. The list
and detail stack below the existing xl breakpoint; wide tables retain internal
scrolling. No mobile navigation is added.

## Verification and limitations

Local verification completed 2026-10-27 (Asia/Seoul):

| Check | Result |
|---|---|
| Frontend full suite | 49 files / 502 tests passed |
| Backend full suite | 1093 passed / 1 optional TA-Lib comparison skipped / 215 dependency deprecation warnings |
| Lint / TypeScript / production build | Passed; final label-only change also checked with all 10 Discovery UI tests |
| Core / route / Plan Lab isolation / version guards | Passed |
| KO / EN at 768 / 1024 / 1440px | Verified with synthetic data; no page horizontal overflow; 56px header maintained |
| Browser interactions | Explicit analysis, date keyboard edit, normalized symbol filter, frozen evidence, unchanged/modified-rule registration, exact Playbook link, Tab wrap, visible focus, nested dirty confirmation, Escape and focus return |
| Final browser console | No warning/error entries |

Final source was built and reloaded for browser checks. Sample registration
created only disposable sample strategies. Final-scope checks also confirmed
the generated BTCUSDT + Long constraints in the saved Playbook version.
Screenshots and local API/layout evidence are ignored under
`.cache/strategy-discovery/`; they are not release assets or source fixtures.

Tests cover chronological separation, holdout-independent selection, duplicate
trades, limits/coverage, null/zero/nonfinite values, normalized symbols, frozen
source evidence, atomic failure/retry/concurrent adoption, profile isolation,
API/static-route contracts, stale responses, dirty drafts, registration errors
and pending keyboard/navigation protection. The existing API surface and static
entry tests were extended, not relaxed.

Browser verification uses the official isolated synthetic sample. Its 36 trades
end on January 19; a full January request intentionally produces no holdout
trades after the January 22 split. A January 1–19 request has discovery 24 /
holdout 12 and includes both consistent and insufficient-evidence candidates.

Real exchange acceptance, external market opportunities, statistical multiple-
testing significance, automatically generated SL/TP rules, long-running job
queues, and Experiment handoff are outside this MVP. No real credentials or
production journal records are required for the sample verification.
