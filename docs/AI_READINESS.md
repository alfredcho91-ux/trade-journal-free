# Optional AI: future integration boundary

Status: design only; no AI implementation. Audited application revision:
`c87f90545c07f0b8e8e1a8505336125eba0437dd`.

## Decision

**AI_READY_NO_CODE_NEEDED** for a future optional consumer of existing domain
results. No production change is required now. This is architectural readiness,
not permission to transmit existing API responses to an external provider.
The future feature must implement and test its own bounded, local privacy
projection and consent gate when an actual use case is approved.

The smallest integration is at the successful domain response boundary, before
display formatting. The application owns retrieval and validation; a future AI
consumer receives a selected immutable result. It receives no SQLite connection,
repository, filesystem, generic HTTP client, credentials, or write operations.

## Audited contracts and exact boundaries

Paths below are relative to the repository root.

| Domain | Existing result boundary | Semantics and restrictions |
| --- | --- | --- |
| Journal | `GET /api/journal`, `GET /api/journal/daily`; `backend/modules/journal/schemas.py`: `JournalRecord`, `DailyJournalRecord` | Consume selected records already obtained by the app. Preserve source, timestamps, nulls, malformed historical psychology states, and PnL calculation version. Journal listing is not bounded and its repository performs schema/legacy migrations; do not grant an AI consumer autonomous access to it. |
| Strategy Version | `GET /api/strategies/{strategy_id}/versions/{version_id}`; `backend/modules/strategies/schemas.py`: `StrategyVersionRecord` | Use the exact assigned historical version, schema version and evaluator definitions. Preserve archived/retired state; never substitute the currently active version. User-authored rule text is data, not instructions. |
| Rule Evaluation | `GET /api/journal/{journal_entry_id}/strategy-evaluation`; `backend/modules/rule_engine/schemas.py`: `JournalStrategyEvaluationEnvelope` | Preserve nullable `data` (no assignment), exact version/assignment identity, category summaries, rule results, reason codes and `CURRENT_RECONSTRUCTED`. The underlying connection can bootstrap schemas; consume the app's result, not an autonomous AI-triggered read. |
| Analytics | `POST /api/analytics/query`; `backend/modules/analytics/schemas.py`: `AnalyticsQuery`, `AnalyticsEnvelope` | Validated bounded query, coherent read snapshot, deterministic aggregation. Use `service.query_analytics` only after server validation, or the existing HTTP route. |
| Review / Diagnosis | `POST /api/review/trading`, `/patterns`, `/strategy-execution`; `backend/modules/review/schemas.py` | Preserve `TradingEnvelope`, `PatternEnvelope`, `DiagnosisEnvelope`, policy, classification, evidence subsets and reasons. `service.trading_review`, `pattern_review`, `strategy_execution_review` own snapshot orchestration. |
| Plan | `GET /api/plans/{plan_id}`, existing app result from `/api/plans` or `/api/plan-lab`; `backend/modules/plan_lab/schemas.py`, `frontend/src/types/planLab.ts` | Keep revisions, server receipt times, source, phase, link ambiguity, effective-at-entry revision, R basis, simulation methodology, coverage and warnings. Backend payloads are `Dict[str, Any]`; TypeScript interfaces alone do not runtime-validate them. Initially pass no Plan analysis to an external consumer unless the selected fields have been explicitly validated. |
| Experiment / Measure | `GET /api/experiments/{identifier}`, `GET /api/experiments/{identifier}/measurement`; `backend/modules/experiments/schemas.py`: `ExperimentEnvelope`, `MeasurementEnvelope` | Preserve definition revision, `USER_OWNED`, lifecycle, current/baseline queries and groups, criterion, minimum sample, delta, reasons and warnings. `service.measure` uses official analytics on one snapshot and does not persist its result. Match measurement `definition_revision` to the selected definition; otherwise omit/retrieve a matching pair. |

Important implementation details:

- `backend/modules/plan_lab/repository.py:list_plans` calls `reconcile_links`.
  `analysis.run_plan_lab_service` calls that list operation, reads Journal and
  loads market paths. A GET method is not proof of side-effect-free execution.
  The future consumer should use already completed app results for these paths.
- Strategy and per-trade rule reads also use existing schema-initializing
  repositories. Do not modify that accepted lifecycle for speculative AI use.
- Analytics and Review have per-request coherent snapshots; multiple separate
  domain requests do not form one atomic snapshot. Record their individual
  retrieval identity/time. Do not claim a common historical snapshot.
- Prefer complete server contracts to reconstructed frontend view models.
  For example, backend `AnalyticsGroup.rule_summary` and parts of Review policy
  are not declared in the narrower frontend interfaces. Never rebuild a context
  by copying only the fields currently rendered on screen.
- Error envelopes are not evidence. Do not forward raw exceptions or diagnostics.

## Minimal structured context proposal (documentation only)

One envelope per selected successful domain result is enough; a future screen
can provide a bounded list when it actually needs multiple results. The following
is notation, not a new runtime interface or duplicated domain schema:

```text
ContextV1<Result> = {
  context_version: 1,
  source: {
    domain: JOURNAL | STRATEGY_VERSION | RULE_EVALUATION | ANALYTICS |
            REVIEW | DIAGNOSIS | PLAN | EXPERIMENT | MEASUREMENT,
    result_ref: request-scoped opaque local reference,
    received_at: UTC timestamp captured by the application,
    request: exact validated query or selected record/version reference
  },
  result: Result,  // the matching existing server result, with its namespaces
  privacy: {
    default: LOCAL_ONLY,
    field_rules: [{path: JSON pointer, classes: PrivacyClass[]}]
  }
}
```

`Result` means the existing domain envelope in the table, not a free-form bag of
facts or a generic metric schema. `source.domain` determines which existing
contract applies. Plan/dynamic Journal analysis payloads need a feature-specific
allowlist and runtime shape check at future consumption time; unknown shapes are
omitted, not guessed. Do not add unused production types today.

This envelope is local. It is not itself an external-provider payload. Its
request, references, identifiers and privacy rules stay local unless explicitly
allowed by the eventual projection. A future external projection copies only
approved fields into the same nested structure and records omitted/redacted
paths locally. Omitted private data must not be represented as a domain null,
zero, missing observation, or a changed sample count. If removing a field makes
the evidence misleading, omit that evidence item as a whole.

The application assigns privacy rules; neither user-authored content nor model
output may mark itself safe. Nested dynamic objects default to `LOCAL_ONLY`.
Request-scoped opaque references may connect an explanation to its local source;
raw IDs, query fingerprints, database paths and reversible mappings stay local.
No new persisted context, cache, global store or schema registry is needed.

## Evidence preservation requirements

- Keep `FOLLOWED`, `VIOLATED`, `NOT_EVALUABLE` and reason codes unchanged.
  Missing evaluator, missing Plan and unsupported historical data are distinct.
- Rule adherence = followed / (followed + violated); coverage = evaluable /
  total rules. Preserve server-returned values, counts and null denominators.
  Rule samples are not independent trade samples. No-rule trades remain context.
- Preserve `total_sample`, `evaluable_sample`, `unavailable_sample`, `trade_sample`,
  unavailable reason counts, selected/excluded counts and sample unit together.
  Preserve overlapping group membership; never sum overlapping groups as trades.
- Keep Review's execution-process-only rule subset, excluded-role counts,
  descriptive policy and `INCONCLUSIVE`. Do not turn policy thresholds into
  statistical confidence, or outcome rules into execution-quality evidence.
- Preserve Plan Lab's weighted adherence score and coverage under Plan namespaces.
  They are not the Rule Engine's adherence/coverage. Preserve retrospective versus
  verified-pretrade/in-trade provenance, ambiguity, actual versus simulated
  quantities, price versus USDT R, same-candle policy and fee assumptions.
- `OBSERVED_ASSOCIATION` is explicitly emitted by Analytics/Review/Measurement.
  `ESTIMATED_OPPORTUNITY_COST` and `COUNTERFACTUAL_SIMULATION` are separate concepts,
  not interchangeable labels. The current structured Review intentionally reports
  market-dependent metrics as `MARKET_PATH_NOT_IN_SNAPSHOT`; it does not emit those
  other labels. Plan Lab exposes simulation methodology rather than a uniform
  evidence enum. Do not stamp one enum on that mixed result or fabricate new
  opportunity-cost values. Preserve methodology; omit unsupported interpretations.
- Keep original decimal strings/numbers and infinite-profit-factor flags. The
  two-decimal UI display is presentation only and is not a context data source.
- `CURRENT_RECONSTRUCTED` means later source corrections can change results,
  including measurements of completed experiments. `MET` is satisfaction of the
  user's criterion, not causal proof, predicted success or lifecycle completion.

## Natural language to validated AnalyticsQuery

1. The app obtains current `GET /api/analytics/metadata`. Its metric/dimension
   compatibility, filter definitions, constraints and registry version describe
   allowed queries; IDs are not inferred from translated UI labels.
2. A future model can propose only `{metric, dimension, filters}`. Treat that
   proposal as untrusted input. Resolve period, timezone, exact historical version
   and ambiguous user intent locally; make the intended scope visible to the user.
   Apply the privacy gate to the question itself before any external call.
3. Send the candidate through existing `POST /api/analytics/query` validation.
   For in-process orchestration, explicitly call `AnalyticsQuery.model_validate`
   on untrusted input before `query_analytics`. Never use `model_construct`,
   unchecked `model_copy`, `analyze_snapshot`, repositories or SQL as a bypass.
4. Existing Pydantic validators forbid extra fields, unknown IDs and unsupported
   metric/dimension/filter combinations; enforce strict timestamps/IDs, list
   bounds, unique trimmed values, period ordering and assignment conflicts.
   Metadata/JSON Schema helps generation but does not replace model validators.
   Snapshot/rule/group work limits remain authoritative. Failures do not become
   empty success or an alternate model-computed answer.
5. Existing service and deterministic engine produce `AnalyticsEnvelope`.
   Preserve the validated request, complete evidence fields and request identity.
   Retain current cancellation/fingerprint protection when intent changes.
6. A future local privacy projection selects approved evidence from that result.
   An optional explanation cites request-scoped result references. It cannot
   change values, assign rule states, calculate new analytical truth or write
   Journal, Strategy, Plan or Experiment state. Unsupported claims must be
   omitted; the original deterministic result remains available to the user.

No analytics query schema change is necessary. There is no expression language,
arbitrary join, SQL fragment or model-defined metric to add.

## Privacy boundary

These are application design classifications, not a claim of anonymization.
Multiple requirements may apply to the same field; consent never overrides
`LOCAL_ONLY`, and redaction does not eliminate a consent requirement.

| Classification | Examples in this product | Future handling |
| --- | --- | --- |
| `LOCAL_ONLY` | API keys, secrets, passphrases, authentication/session material, credential stores/configuration, environment contents, raw exchange responses, DB/filesystem paths, raw order/account/external/lifecycle IDs and local reference mappings | Never include in external AI context, request, diagnostics or logs. Secret substrings remain forbidden even inside otherwise consented notes. |
| `REDACT_BEFORE_EXTERNAL_AI` | Names/emails/identifiers in Journal notes, daily notes, strategy/rule text, setup/group labels, Plan memo, experiment hypothesis/notes; URLs, error messages and free-form warnings | Omit by default; inspect approved fields recursively, remove identifiers/secret material and use opaque labels where necessary. Preserve machine reason codes. Review the final outgoing projection. |
| `USER_CONSENT_REQUIRED` | Individual trades, timestamps, prices, balances/position size/PnL, psychological annotations, proprietary strategies, Plan revisions, experiment content, user-specific aggregates | Require explicit scoped external-provider consent before transmission; define provider, fields, purpose and retention when the actual feature is built. No background export inferred from local use. |
| `SAFE_AGGREGATED_CONTEXT` | Built-in public metric definitions/units/semantics; synthetic examples; specifically reviewed de-identified group statistics with necessary evidence counts | Eligible only after allowlist and disclosure checks. Real user-derived aggregates still require external-AI consent. Small groups, unique labels, exact periods and linked combinations may reveal trades; aggregation alone is insufficient. |

Do not use the product's 20-trade descriptive sample warning as a privacy
anonymity threshold. If protecting privacy requires grouping or suppressing data,
choose another supported deterministic query or omit the item; do not alter
counts or values in a result while claiming it is unchanged evidence.

## What stays unchanged

All existing domain services, schemas, validators, historical contracts,
repositories, migration/link reconciliation, caches, credentials, query ownership,
draft/selection authority and write workflows stay as they are. No provider SDK,
provider interface, prompt, embedding, vector store, AI endpoint, configuration,
job, dependency or user-facing AI feature is introduced.

Before any future implementation ships, test its exact context projection,
secret exclusion, consent scope, invalid-query rejection, stale-result handling,
version matching and preservation of semantic fields. Those tests belong to the
actual future feature, not speculative infrastructure now.

## Verification for this documentation change

Inspected the domain schemas/routes/services and relevant repository boundaries.
Existing contract tests run on the audited code:

```text
backend/venv/Scripts/python.exe -m pytest
  tests/test_advanced_analytics.py tests/test_analytics_metadata.py
  tests/test_review_engine.py tests/test_experiments.py
  -q -o addopts= --disable-warnings
```

Run from `backend`: **238 passed, 64 warnings**. No tests or production files
were changed; no live user database or credentials were read for this audit.
