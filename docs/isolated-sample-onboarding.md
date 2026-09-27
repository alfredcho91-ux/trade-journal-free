# Isolated sample onboarding

The normal workspace offers sample exploration before requesting an exchange
connection. First run means zero Journal rows and no acknowledged onboarding
preference. Strategies and credential presence do not decide onboarding state.
Use-own-data and Skip persist one profile-local JSON preference beside the DB.
Sample entry and exit do not acknowledge onboarding or write the normal DB.

## Process and storage boundaries

Existing repository modules import their database paths at startup. The sample
therefore runs in a separate process; the normal process never switches its
settings or repository globals. Source builds launch `backend.desktop`;
PyInstaller builds launch the same executable with a fresh bootloader environment.

The parent creates a new `TemporaryDirectory` and ownership marker, chooses a
loopback port, and passes an allowlisted environment. Credentials, encryption
keys, proxies, authentication settings, and normal DB/import overrides are not
inherited. Sample startup requires all of the following before dotenv loading:

- A sample root directly beneath the configured OS temporary directory.
- The expected directory prefix and a matching unpredictable ownership token.
- Application data, Journal directory, SQLite DB and CSV paths within that root.
- `CREDENTIAL_STORAGE=disabled`.

The explicit identity is `sample:` followed by the SHA-256 of the resolved root.
It cannot equal the canonical normal credential identity. Sample settings do not
own any legacy `.env`; source and frozen sample runs select the sample data root
before evaluating dotenv ownership.

Credential resolution returns no credentials, save rejects, and delete is a
no-op. Low-level OS vault, encrypted-store, and authenticated exchange adapter
entry points independently reject sample access. Exchange mutation routes also
reject before invoking services. Public market functions return their unavailable
state; an audit hook installed after event-loop creation denies outgoing sockets,
including outgoing loopback requests. Incoming local HTTP continues to work.
CSV market paths are sample-local and caches use memory only.

The parent verifies the child's profile identity, disabled credential backend,
and fixture count before returning its URL. Reset gracefully stops the child and
removes only its owned temporary directory, then builds a fresh sample. Normal
application shutdown also closes the child. Sample edits last for the parent
session or until reset; they are never exported to the normal profile.

## Fixture and real calculations

Fixture v1 contains 36 synthetic January 2026 trades, three symbols, both sides,
wins/losses/break-even, two Strategies and three exact Strategy Versions. It
includes incomplete psychology and R values, three daily reflections, 24
pre-trade Plans, six retrospective Plans, six trades without Plans, and six later
revisions. Journal planning notes explicitly remain unverified legacy notes.
Fixed source records and received-at timestamps are inserted into the existing
production schema. No analytical answers, Review findings or experiments are
seeded. Normal Rule Engine, Analytics, Review and PlanningContext calculations
run on these records. Market-path results are unavailable because there is no
live or synthetic candle feed; unavailable never becomes zero or a violation.

## Frontend boundary and value path

Bootstrap verifies workspace metadata before importing App or persisted settings.
Transitions unmount pages, cancel queries, clear the old QueryClient, and navigate
to a full document on the destination origin. The new document owns a new JS heap
and QueryClient. Later navigation intent supersedes earlier async preparation.
Sample preferences also have a separate localStorage key.

A persistent synthetic-data banner offers four optional steps: representative
Journal trade, confidence comparison in Guided Analytics, existing Review
summary, and a brief explanation of the product loop. Review can open the
existing experiment editor; no experiment is automatically saved or activated.
Live charts explicitly show their unavailability. Real-data setup remains the
existing Journal connector UI, and sample can be reopened after Skip.

## Regression coverage

- `test_sample_workspace.py`: fail-closed paths, credential/store/adapter guards,
  offline sockets, deterministic real-engine outputs, Plan provenance, first-run
  preference, and normal-storage/Analytics/Review preservation across reset.
- Existing credential/profile, lifecycle, exchange, Rule Engine, Analytics,
  PlanningContext, Review and Experiment tests retain their original contracts.
- Frontend tests cover landing, Skip/own data, entry/exit/reset, safe failure,
  stale responses in both directions, newer intent, sample Journal, Guided query,
  Review snapshot and no automatic experiment save.
- Synthetic frozen tests exercise Windows/Linux/macOS selection branches. They
  are not a substitute for execution on those operating systems or hosted CI.

Manual acceptance must use a newly isolated normal test profile with disabled
credentials. Never launch against the developer's actual normal DB or OS vault.
