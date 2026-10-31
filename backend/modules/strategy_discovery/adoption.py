"""Explicit atomic adoption. Original candidate evidence never changes."""

import sqlite3
import unicodedata

from backend.modules.strategies import repository as strategies
from backend.modules.strategies.service import prepare_strategy_create
from backend.modules.strategy_discovery import repository


def rules_fingerprint(rules):
    """Ignore labels/order/IDs for evaluated rules; preserve descriptive rule meaning."""
    semantic = {}
    for category in ("entry_rules", "risk_rules", "exit_rules"):
        semantic[category] = sorted([
            {"evaluation": rule["evaluation"]} if rule.get("evaluation") else
            {"text": unicodedata.normalize("NFKC", rule["text"]).strip()}
            for rule in rules[category]
        ], key=repository.encode)
    return repository.fingerprint(semantic)


def adopt(identifier, request, key, *, db_path=None):
    candidate = repository.get_candidate(identifier, db_path=db_path)
    payload = request.strategy.model_dump(mode="json")
    normalized = prepare_strategy_create(payload)
    request_hash = repository.fingerprint(payload)
    saved_fingerprint = rules_fingerprint(normalized["rules"])
    modified = saved_fingerprint != rules_fingerprint(candidate.rules.model_dump(mode="json"))
    try:
        with repository.write_connection(db_path) as conn:
            existing = conn.execute("SELECT * FROM strategy_discovery_adoptions WHERE candidate_id=? OR idempotency_key=?",
                                    (identifier, key)).fetchall()
            if existing:
                if len(existing) != 1 or existing[0]["candidate_id"] != identifier or existing[0]["request_hash"] != request_hash:
                    raise repository.conflict("This candidate or request key was already registered with different content")
                return repository.adoption_record(existing[0])
            strategy_id, version_id = strategies.insert_strategy(conn, **normalized)
            conn.execute("""INSERT INTO strategy_discovery_adoptions
                (candidate_id,idempotency_key,request_hash,strategy_id,version_id,rules_modified,saved_rules_fingerprint,created_at)
                VALUES (?,?,?,?,?,?,?,?)""", (identifier, key, request_hash, strategy_id, version_id, int(modified),
                                            saved_fingerprint, strategies.utc_now()))
            row = conn.execute("SELECT * FROM strategy_discovery_adoptions WHERE candidate_id=?", (identifier,)).fetchone()
            return repository.adoption_record(row)
    except sqlite3.IntegrityError as exc:
        if "strategies.name_key" in str(exc):
            raise repository.conflict("A strategy with this name already exists; choose a different name") from exc
        raise
