"""Version 1 synthetic source records. Analytical answers are never persisted.

Dates and received-at timestamps describe an invented January trading month.
Seed directly into the production schema so provenance is explicit and stable,
without changing clocks, production engines, or normal repository semantics.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json

from backend.config import settings
from backend.config.sample_policy import IS_SAMPLE, validate_sample_root
from backend.modules.journal import repository as journal
from backend.modules.plan_lab import repository as plans
from backend.modules.strategy_assignments import repository as assignments
from backend.modules.experiments import repository as experiments

VERSION = 1
STAMP = "2026-01-01T00:00:00+00:00"


def _insert(conn, table, values):
    conn.execute(f"INSERT INTO {table} ({','.join(values)}) VALUES ({','.join('?' for _ in values)})", tuple(values.values()))


def _rule(identifier, text, metric, operator, expected):
    return {"id": identifier, "text": text, "evaluation": {"metric_id": metric, "operator": operator, "expected": expected}}


def build_fixture() -> None:
    if not IS_SAMPLE:
        raise RuntimeError("Sample fixtures require the sample process")
    root = validate_sample_root()
    db = settings.JOURNAL_DB_PATH
    if db.resolve() != root / "journal" / "trade_journal.db" or db.exists():
        raise RuntimeError("Sample fixtures require a new isolated database")
    assignments.initialize_schema(db_path=db)
    experiments.initialize_schema(db_path=db)
    with plans._connect(db) as conn:
        for identifier, name in ((1, "Trend pullback"), (2, "Range rejection")):
            _insert(conn, "strategies", {"id": identifier, "name": name, "name_key": name.lower(),
                "description": "Synthetic example · compare execution habits, not a trading recommendation.",
                "created_at": STAMP, "updated_at": STAMP})
        for identifier, strategy, sequence in ((1, 1, 1), (2, 1, 2), (3, 2, 1)):
            rules = {"schema_version": 2, "entry_rules": [
                _rule("patient-entry", "Enter close to the planned price", "execution.entry_deviation_r", "lte", .1),
                _rule("no-chasing", "Record whether the entry was driven by FOMO", "journal.fomo", "eq", False),
            ], "risk_rules": [], "exit_rules": []}
            _insert(conn, "strategy_versions", {"id": identifier, "strategy_id": strategy, "sequence": sequence,
                "version_label": f"v{sequence}", "version_label_key": f"v{sequence}", "description": "Wait for the planned area; review unrecorded evidence separately.",
                "rules_json": json.dumps(rules, sort_keys=True), "is_active": int(identifier != 1), "created_at": STAMP})

        for index in range(36):
            identifier = index + 1
            day = datetime(2026, 1, 2, 9, tzinfo=timezone.utc) + timedelta(days=index // 2, hours=(index % 2) * 5)
            entered, closed = day.isoformat(), (day + timedelta(hours=2)).isoformat()
            before, after = (day - timedelta(hours=1)).isoformat(), (day + timedelta(hours=3)).isoformat()
            kind = index % 6
            side = "Long" if index % 2 == 0 else "Short"
            sign = 1 if side == "Long" else -1
            symbol, price = (("BTC/USDT", 90000.), ("ETH/USDT", 3000.), ("SOL/USDT", 180.))[index % 3]
            fomo = None if kind == 5 else kind >= 3
            result_r = (1.5, 2., -.4, -1., -.8, 0.)[kind]
            actual = price * (1 + sign * .004) if kind == 3 else price
            exit_price = actual + sign * price * .02 * result_r
            setup = "pullback" if index < 24 else "range_rejection"
            values = {"id": identifier, "datetime": closed, "entry_datetime": entered,
                "symbol": symbol, "timeframe": "1h", "direction": side,
                "entry_price": actual, "exit_price": exit_price, "size": 1000 / actual,
                "realized_pnl": round(result_r * 20, 2), "pnl_pct": result_r * 2,
                "invested_amount": 1000., "leverage": 1., "fee": .4, "fee_currency": "USDT", "funding_fee": 0.,
                "pnl_calculation_version": 2, "r_multiple": None if kind == 5 else result_r,
                "outcome": "win" if result_r > 0 else "loss" if result_r < 0 else "breakeven",
                "source": "deepcoin_position", "exchange": "deepcoin", "external_id": f"sample:v1:position:{identifier}",
                "fomo": fomo, "revenge_trade": None if kind == 5 else False,
                "confidence_score": None if kind == 5 else 4 if kind < 3 else 2,
                "focus_score": None if kind == 5 else 4 if kind < 3 else 2,
                "emotion_before": None if kind == 5 else "calm" if kind < 3 else "anxious",
                "emotion_after": None if kind == 5 else "reflective",
                "setup_tags": [setup], "mistake_tags": ["chasing"] if kind == 3 else [],
                "planned_stop_pct": 2. if kind == 0 else None, "planned_target_pct": 4. if kind == 0 else None,
                "planned_entry_reason": "Journal note: wait for a pullback" if kind == 0 else None,
                "plan_recorded_at": after if kind == 0 else None,
                "notes": "Synthetic trade. Waited for my area, then reviewed the entry against the plan." if kind < 3 else
                    "Synthetic trade. Chased a moving price; next time check the plan before entering." if kind < 5 else
                    "Synthetic trade. I did not record psychology. Missing does not mean a rule violation.",
                "created_at": closed}
            normalized = {key: journal._normalize_column_value(key, value) for key, value in values.items()}
            _insert(conn, journal.TABLE_NAME, normalized)
            _insert(conn, assignments.ASSIGNMENT_TABLE, {"journal_entry_id": identifier,
                "strategy_version_id": 1 + index // 12, "assigned_at": closed, "updated_at": closed})
            if kind == 5:
                continue
            retrospective = kind == 4
            revision = {"entry_price": None if retrospective else price,
                "stop_loss": price * (1 - sign * .02), "take_profit": price * (1 + sign * .04),
                "setup": setup, "entry_note": "Example plan: wait for the area, avoid chasing.",
                "memo": "Synthetic retrospective plan" if retrospective else "Synthetic pre-trade plan", "max_hold_hours": 6}
            plan_id = plans._insert_plan_with_revision(conn, {"exchange": "deepcoin", "symbol": symbol, "side": side, "revision": revision},
                after if retrospective else before, status="linked", source="RETROSPECTIVE" if retrospective else "VERIFIED_PRETRADE")
            _insert(conn, plans.LINK_TABLE, {"plan_id": plan_id, "journal_entry_id": identifier,
                "journal_external_id": values["external_id"], "link_status": "LINKED", "linked_at": after, "updated_at": after})
            if kind == 0:
                later = {**revision, "take_profit": price * (1 + sign * .05), "memo": "Later reflection: this revision was recorded after the trade."}
                conn.execute(f"INSERT INTO {plans.REVISION_TABLE} (plan_id,version,entry_price,entry_min,entry_max,stop_loss,take_profit,take_profit_2,setup,entry_note,exit_note,memo,max_hold_hours,client_created_at,received_at,created_at) VALUES (?,2,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (plan_id, *plans._revision_payload(later, after)))
        for day in ("2026-01-02", "2026-01-08", "2026-01-14"):
            _insert(conn, journal.DAILY_TABLE_NAME, {"trade_date": day,
                "session_plan": "Synthetic session: wait for the planned entry and record the reason.",
                "post_session_notes": "Compare patient and rushed entries. The sample is small; this is an observation.",
                "next_focus": "Write down the entry condition before acting.", "created_at": STAMP, "updated_at": STAMP})
        conn.commit()
