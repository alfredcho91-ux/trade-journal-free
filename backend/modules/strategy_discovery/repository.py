"""Immutable local evidence. Reads never bootstrap or change the Journal database."""

from contextlib import closing, contextmanager
import hashlib
import json
from pathlib import Path
import sqlite3

from backend.modules.journal import repository as journal
from backend.modules.strategies import repository as strategies
from backend.modules.strategy_discovery import feature_policy as policy
from backend.modules.strategy_discovery.schemas import AdoptionRecord, Candidate, RunDetail, RunPage, RunRecord
from backend.utils.error_handler import APIError, NotFoundError


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def fingerprint(value):
    return hashlib.sha256(encode(value).encode("utf-8")).hexdigest()


def conflict(message):
    return APIError(message, error_code="DISCOVERY_CONFLICT", status_code=409)


def _ensure_schema(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS strategy_discovery_runs (
            id INTEGER PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE,
            request_hash TEXT NOT NULL, request_json TEXT NOT NULL,
            engine_version INTEGER NOT NULL, policy_version INTEGER NOT NULL,
            input_fingerprint TEXT NOT NULL, snapshot_json TEXT NOT NULL,
            summary_json TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS strategy_discovery_candidates (
            id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES strategy_discovery_runs(id) ON DELETE RESTRICT,
            rank INTEGER NOT NULL, candidate_json TEXT NOT NULL, UNIQUE(run_id, rank)
        );
        CREATE TABLE IF NOT EXISTS strategy_discovery_adoptions (
            candidate_id INTEGER PRIMARY KEY REFERENCES strategy_discovery_candidates(id) ON DELETE RESTRICT,
            idempotency_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
            strategy_id INTEGER NOT NULL REFERENCES strategies(id) ON DELETE RESTRICT,
            version_id INTEGER NOT NULL REFERENCES strategy_versions(id) ON DELETE RESTRICT,
            rules_modified INTEGER NOT NULL CHECK(rules_modified IN (0,1)),
            saved_rules_fingerprint TEXT NOT NULL, created_at TEXT NOT NULL
        );
    """)
    for table in ("runs", "candidates", "adoptions"):
        for action in ("UPDATE", "DELETE"):
            conn.execute(f"""CREATE TRIGGER IF NOT EXISTS discovery_{table}_no_{action.lower()}
                BEFORE {action} ON strategy_discovery_{table}
                BEGIN SELECT RAISE(ABORT, 'Discovery evidence is immutable'); END""")
    conn.commit()


@contextmanager
def write_connection(db_path=None):
    with closing(strategies._connect(db_path)) as conn:
        _ensure_schema(conn)
        with conn:
            conn.execute("BEGIN IMMEDIATE")
            yield conn


def initialize_schema(*, db_path=None):
    with closing(strategies._connect(db_path)) as conn:
        _ensure_schema(conn)


@contextmanager
def read_connection(db_path=None):
    path = Path(db_path or journal.JOURNAL_DB_PATH).resolve()
    if not path.exists():
        yield None
        return
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=30)) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA query_only = ON")
        conn.execute("BEGIN")
        names = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        required = {"strategy_discovery_runs", "strategy_discovery_candidates", "strategy_discovery_adoptions"}
        if not names.intersection(required):
            yield None
        elif not required.issubset(names):
            raise APIError("Discovery schema is incomplete", status_code=503)
        else:
            yield conn


def run_record(row):
    return RunRecord(id=row["id"], request=json.loads(row["request_json"]), engine_version=row["engine_version"],
                     policy_version=row["policy_version"], input_fingerprint=row["input_fingerprint"],
                     created_at=row["created_at"], summary=json.loads(row["summary_json"]))


def adoption_record(row):
    return AdoptionRecord(strategy_id=row["strategy_id"], version_id=row["version_id"],
                          rules_modified=bool(row["rules_modified"]),
                          evidence_applies_to_saved_rules=not bool(row["rules_modified"]),
                          saved_rules_fingerprint=row["saved_rules_fingerprint"], created_at=row["created_at"])


def candidate_record(row, adoption=None):
    return Candidate(**json.loads(row["candidate_json"]), id=row["id"], run_id=row["run_id"],
                     adoption=adoption_record(adoption) if adoption else None)


def _detail(conn, row):
    candidates = conn.execute("SELECT * FROM strategy_discovery_candidates WHERE run_id=? ORDER BY rank", (row["id"],)).fetchall()
    adoptions = {item["candidate_id"]: item for item in conn.execute("""SELECT a.* FROM strategy_discovery_adoptions a
        JOIN strategy_discovery_candidates c ON c.id=a.candidate_id WHERE c.run_id=?""", (row["id"],))}
    return RunDetail(**run_record(row).model_dump(), candidates=[candidate_record(c, adoptions.get(c["id"])) for c in candidates])


def find_run(key, request_hash, *, db_path=None):
    with read_connection(db_path) as conn:
        row = conn.execute("SELECT * FROM strategy_discovery_runs WHERE idempotency_key=?", (key,)).fetchone() if conn else None
        if row and row["request_hash"] != request_hash:
            raise conflict("This analysis request key was already used with different conditions")
        return _detail(conn, row) if row else None


def save_run(key, request, snapshot, summary, candidates, *, db_path=None):
    payload = request.model_dump(mode="json")
    request_hash = fingerprint(payload)
    with write_connection(db_path) as conn:
        existing = conn.execute("SELECT * FROM strategy_discovery_runs WHERE idempotency_key=?", (key,)).fetchone()
        if existing:
            if existing["request_hash"] != request_hash:
                raise conflict("This analysis request key was already used with different conditions")
            return _detail(conn, existing)
        cursor = conn.execute("""INSERT INTO strategy_discovery_runs
            (idempotency_key,request_hash,request_json,engine_version,policy_version,input_fingerprint,snapshot_json,summary_json,created_at)
            VALUES (?,?,?,?,?,?,?,?,?)""", (key, request_hash, encode(payload), policy.ENGINE_VERSION, policy.POLICY_VERSION,
                fingerprint(snapshot), encode(snapshot), summary.model_dump_json(), strategies.utc_now()))
        identifier = int(cursor.lastrowid)
        conn.executemany("INSERT INTO strategy_discovery_candidates(run_id,rank,candidate_json) VALUES (?,?,?)", [
            (identifier, c.rank, encode(c.model_dump(mode="json", exclude={"id", "run_id", "adoption"}))) for c in candidates
        ])
        row = conn.execute("SELECT * FROM strategy_discovery_runs WHERE id=?", (identifier,)).fetchone()
        return _detail(conn, row)


def list_runs(offset=0, limit=20, *, db_path=None):
    with read_connection(db_path) as conn:
        rows = conn.execute("SELECT * FROM strategy_discovery_runs ORDER BY id DESC LIMIT ? OFFSET ?", (limit + 1, offset)).fetchall() if conn else []
        return RunPage(items=[run_record(row) for row in rows[:limit]], offset=offset, has_more=len(rows) > limit)


def get_run(identifier, *, db_path=None):
    with read_connection(db_path) as conn:
        row = conn.execute("SELECT * FROM strategy_discovery_runs WHERE id=?", (identifier,)).fetchone() if conn else None
        if row is None:
            raise NotFoundError("Discovery run", str(identifier))
        return _detail(conn, row)


def get_candidate(identifier, *, db_path=None):
    with read_connection(db_path) as conn:
        row = conn.execute("SELECT * FROM strategy_discovery_candidates WHERE id=?", (identifier,)).fetchone() if conn else None
        if row is None:
            raise NotFoundError("Strategy candidate", str(identifier))
        adoption = conn.execute("SELECT * FROM strategy_discovery_adoptions WHERE candidate_id=?", (identifier,)).fetchone()
        return candidate_record(row, adoption)


def candidate_snapshot(identifier, *, db_path=None):
    with read_connection(db_path) as conn:
        row = conn.execute("""SELECT r.snapshot_json, c.candidate_json FROM strategy_discovery_candidates c
            JOIN strategy_discovery_runs r ON r.id=c.run_id WHERE c.id=?""", (identifier,)).fetchone() if conn else None
        if row is None:
            raise NotFoundError("Strategy candidate", str(identifier))
        return json.loads(row["snapshot_json"]), Candidate(**json.loads(row["candidate_json"]))
