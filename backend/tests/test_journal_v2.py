from __future__ import annotations

import sqlite3
from typing import Any

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.modules.journal import repository as journal_repository


STRUCTURED_FIELDS = (
    "emotion_before",
    "emotion_during",
    "emotion_after",
    "confidence_score",
    "focus_score",
    "fomo",
    "revenge_trade",
)


@pytest.fixture
def isolated_journal_store(monkeypatch, tmp_path):
    journal_dir = tmp_path / "journal-v2-store"
    db_path = journal_dir / "trade_journal.db"
    csv_path = journal_dir / "trade_journal.csv"
    monkeypatch.setattr(journal_repository, "JOURNAL_DB_PATH", db_path)
    monkeypatch.setattr(journal_repository, "JOURNAL_CSV_PATH", csv_path)
    journal_repository.INITIALIZED_DATABASES.clear()
    yield db_path, csv_path
    journal_repository.INITIALIZED_DATABASES.clear()


def _create_legacy_database(db_path) -> dict[str, Any]:
    """Create the complete journal_entries schema used immediately before Journal 2.0."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    legacy_values = {
        "id": 41,
        "datetime": "2026-08-20T12:34:56+00:00",
        "entry_datetime": "2026-08-20T10:00:00+00:00",
        "symbol": "BTC/USDT",
        "timeframe": "4h",
        "direction": "Long",
        "entry_reason_1_indicator": "RSI",
        "entry_reason_1": "support reclaim",
        "entry_reason_2_indicator": "MA",
        "entry_reason_2": "trend continuation",
        "entry_reason_3_indicator": "Volume",
        "entry_reason_3": "volume expansion",
        "indicators": '["RSI","MA","Volume"]',
        "size": 0.25,
        "entry_price": 108000.5,
        "exit_price": 110500.75,
        "pnl_pct": 2.315,
        "r_multiple": 1.72,
        "outcome": "Win",
        "emotion": "Cautiously confident",
        "tags": "binance,swap,closed-position",
        "mistakes": "Entered one candle early",
        "planned_stop_pct": 1.4,
        "planned_target_pct": 3.2,
        "planned_entry_reason": "Retest the breakout level",
        "setup_tags": '["breakout","trend"]',
        "mistake_tags": '["early-entry"]',
        "plan_recorded_at": "2026-08-20T09:55:00+00:00",
        "notes": "Keep this historical note exactly",
        "source": "binance_position",
        "external_id": "binance:position:legacy-journal-v2",
        "lifecycle_id": "binance:lifecycle:legacy-journal-v2",
        "exchange": "Binance",
        "order_id": "order-legacy-41",
        "fee": 3.75,
        "fee_currency": "USDT",
        "funding_fee": -0.85,
        "realized_pnl": 123.456,
        "leverage": 5.0,
        "invested_amount": 5400.0,
        "pnl_calculation_version": 2,
        "indicator_snapshot": '{"version":2,"reference":"entry"}',
        "created_at": "2026-08-20T12:35:00+00:00",
    }
    columns = list(legacy_values)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE journal_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                datetime TEXT,
                entry_datetime TEXT,
                symbol TEXT,
                timeframe TEXT,
                direction TEXT,
                entry_reason_1_indicator TEXT,
                entry_reason_1 TEXT,
                entry_reason_2_indicator TEXT,
                entry_reason_2 TEXT,
                entry_reason_3_indicator TEXT,
                entry_reason_3 TEXT,
                indicators TEXT,
                size REAL,
                entry_price REAL,
                exit_price REAL,
                pnl_pct REAL,
                r_multiple REAL,
                outcome TEXT,
                emotion TEXT,
                tags TEXT,
                mistakes TEXT,
                planned_stop_pct REAL,
                planned_target_pct REAL,
                planned_entry_reason TEXT,
                setup_tags TEXT,
                mistake_tags TEXT,
                plan_recorded_at TEXT,
                notes TEXT,
                source TEXT,
                external_id TEXT,
                lifecycle_id TEXT,
                exchange TEXT,
                order_id TEXT,
                fee REAL,
                fee_currency TEXT,
                funding_fee REAL,
                realized_pnl REAL,
                leverage REAL,
                invested_amount REAL,
                pnl_calculation_version INTEGER,
                indicator_snapshot TEXT,
                created_at TEXT
            )
            """
        )
        conn.execute(
            f"INSERT INTO journal_entries ({', '.join(columns)}) "
            f"VALUES ({', '.join('?' for _ in columns)})",
            tuple(legacy_values[column] for column in columns),
        )
        conn.execute(
            """
            CREATE TABLE journal_behavior_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                rule_type TEXT NOT NULL,
                parameters TEXT NOT NULL,
                is_enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.commit()
    return legacy_values


def _raw_entry(db_path, entry_id: int) -> dict[str, Any]:
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM journal_entries WHERE id = ?",
            (entry_id,),
        ).fetchone()
        assert row is not None
        return dict(row)


def _daily_table_columns(db_path) -> set[str]:
    with sqlite3.connect(db_path) as conn:
        return {
            row[1]
            for row in conn.execute("PRAGMA table_info(daily_journal_entries)").fetchall()
        }


def _add_imported_entry(**overrides: Any) -> dict[str, Any]:
    payload = {
        "source": "binance_position",
        "external_id": "binance:position:journal-v2-api",
        "symbol": "BTC/USDT",
        "direction": "Long",
        "entry_price": 100.0,
        "exit_price": 103.0,
        "realized_pnl": 30.0,
        "emotion": "Legacy emotion",
        "notes": "original",
        **overrides,
    }
    entry, created = journal_repository.add_entry_if_new_external_id(payload)
    assert created is True
    return entry


def test_legacy_schema_migrates_twice_without_changing_existing_values(
    isolated_journal_store,
):
    db_path, csv_path = isolated_journal_store
    legacy_values = _create_legacy_database(db_path)

    journal_repository.INITIALIZED_DATABASES.clear()
    first = journal_repository.list_entries(db_path=db_path, csv_path=csv_path)
    first_raw = _raw_entry(db_path, legacy_values["id"])

    assert len(first) == 1
    assert {field: first_raw[field] for field in legacy_values} == legacy_values
    assert all(first_raw[field] is None for field in STRUCTURED_FIELDS)

    with sqlite3.connect(db_path) as conn:
        column_names = {
            row[1] for row in conn.execute("PRAGMA table_info(journal_entries)").fetchall()
        }
    assert set(STRUCTURED_FIELDS) <= column_names
    assert {
        "id",
        "trade_date",
        "market_bias",
        "session_plan",
        "max_daily_loss",
        "max_trade_count",
        "pre_session_notes",
        "post_session_notes",
        "what_went_well",
        "what_went_wrong",
        "next_focus",
        "created_at",
        "updated_at",
    } == _daily_table_columns(db_path)

    # Force the production SQL initialization path again instead of accepting
    # the process-level initialized-database cache as proof of idempotency.
    journal_repository.INITIALIZED_DATABASES.clear()
    second = journal_repository.list_entries(db_path=db_path, csv_path=csv_path)
    second_raw = _raw_entry(db_path, legacy_values["id"])

    assert len(second) == 1
    assert {field: second_raw[field] for field in legacy_values} == legacy_values
    assert second_raw == first_raw
    assert all(second_raw[field] is None for field in STRUCTURED_FIELDS)
    assert "trade_date" in _daily_table_columns(db_path)


def test_structured_journal_fields_persist(isolated_journal_store):
    entry = _add_imported_entry()
    updated = journal_repository.update_entry_behavior(entry["id"], {
        "emotion_before": "Calm",
        "emotion_during": "Alert",
        "emotion_after": "Relieved",
        "confidence_score": 4,
        "focus_score": 5,
        "fomo": False,
        "revenge_trade": True,
    })

    assert updated is not None
    assert updated["emotion_before"] == "Calm"
    assert updated["emotion_during"] == "Alert"
    assert updated["emotion_after"] == "Relieved"
    assert updated["confidence_score"] == 4
    assert updated["focus_score"] == 5
    assert updated["fomo"] is False
    assert updated["revenge_trade"] is True


def test_new_entries_default_structured_fields_to_null(isolated_journal_store):
    entry = _add_imported_entry()

    assert all(entry[field] is None for field in STRUCTURED_FIELDS)


@pytest.mark.parametrize(
    "field",
    ["emotion_before", "emotion_during", "emotion_after"],
)
def test_structured_emotion_accepts_80_characters_and_rejects_81(
    isolated_journal_store,
    field,
):
    entry = _add_imported_entry()
    with TestClient(app) as client:
        accepted = client.patch(
            f"/api/journal/{entry['id']}/behavior",
            json={field: "x" * 80},
        )
        rejected = client.patch(
            f"/api/journal/{entry['id']}/behavior",
            json={field: "x" * 81},
        )

    assert accepted.status_code == 200
    assert accepted.json()["data"][field] == "x" * 80
    assert rejected.status_code == 422
    assert journal_repository.list_entries()[0][field] == "x" * 80


@pytest.mark.parametrize("field", ["confidence_score", "focus_score"])
@pytest.mark.parametrize("value", [1, 2, 3, 4, 5])
def test_score_bounds_accept_one_through_five(
    isolated_journal_store,
    field,
    value,
):
    entry = _add_imported_entry()
    with TestClient(app) as client:
        response = client.patch(
            f"/api/journal/{entry['id']}/behavior",
            json={field: value},
        )

    assert response.status_code == 200
    assert response.json()["data"][field] == value


@pytest.mark.parametrize("field", ["confidence_score", "focus_score"])
@pytest.mark.parametrize("value", [0, 6])
def test_score_bounds_reject_zero_and_six(
    isolated_journal_store,
    field,
    value,
):
    entry = _add_imported_entry()
    with TestClient(app) as client:
        response = client.patch(
            f"/api/journal/{entry['id']}/behavior",
            json={field: value},
        )

    assert response.status_code == 422
    assert response.json()["error_code"] == "VALIDATION_ERROR"
    stored = journal_repository.list_entries()[0]
    assert stored[field] is None


@pytest.mark.parametrize("field", ["fomo", "revenge_trade"])
@pytest.mark.parametrize(
    ("value", "stored_value"),
    [(None, None), (False, 0), (True, 1)],
)
def test_behavior_flags_preserve_null_false_and_true(
    isolated_journal_store,
    field,
    value,
    stored_value,
):
    entry = _add_imported_entry()
    with TestClient(app) as client:
        response = client.patch(
            f"/api/journal/{entry['id']}/behavior",
            json={field: value},
        )

    assert response.status_code == 200
    assert response.json()["data"][field] is value
    assert journal_repository.list_entries()[0][field] is value
    db_path, _ = isolated_journal_store
    assert _raw_entry(db_path, entry["id"])[field] == stored_value


@pytest.mark.parametrize("field", ["fomo", "revenge_trade"])
def test_behavior_flags_reject_non_boolean_values(isolated_journal_store, field):
    entry = _add_imported_entry()
    with TestClient(app) as client:
        response = client.patch(
            f"/api/journal/{entry['id']}/behavior",
            json={field: 0},
        )

    assert response.status_code == 422
    assert journal_repository.list_entries()[0][field] is None


def test_behavior_patch_preserves_omitted_fields_and_explicit_null_clears(
    isolated_journal_store,
):
    entry = _add_imported_entry(
        emotion="Original legacy emotion",
        notes="original",
        plan_recorded_at="2026-08-20T09:55:00+00:00",
    )
    journal_repository.update_entry_behavior(entry["id"], {
        "emotion_before": "Calm",
        "confidence_score": 4,
        "fomo": False,
    })

    with TestClient(app) as client:
        score_response = client.patch(
            f"/api/journal/{entry['id']}/behavior",
            json={"confidence_score": 5},
        )
        clear_response = client.patch(
            f"/api/journal/{entry['id']}/behavior",
            json={"emotion_before": None},
        )
        notes_response = client.patch(
            f"/api/journal/{entry['id']}/behavior",
            json={"notes": "edited through behavior endpoint"},
        )

    assert score_response.status_code == 200
    scored = score_response.json()["data"]
    assert scored["emotion_before"] == "Calm"
    assert scored["confidence_score"] == 5
    assert scored["fomo"] is False
    assert scored["notes"] == "original"

    assert clear_response.status_code == 200
    cleared = clear_response.json()["data"]
    assert cleared["emotion_before"] is None
    assert cleared["confidence_score"] == 5
    assert cleared["fomo"] is False

    assert notes_response.status_code == 200
    final = notes_response.json()["data"]
    assert final["notes"] == "edited through behavior endpoint"
    assert final["emotion"] == "Original legacy emotion"
    assert final["plan_recorded_at"] == "2026-08-20T09:55:00+00:00"


def test_plan_recorded_at_changes_only_when_a_plan_is_first_recorded(
    isolated_journal_store,
):
    entry = _add_imported_entry(plan_recorded_at=None)
    with TestClient(app) as client:
        psychology_response = client.patch(
            f"/api/journal/{entry['id']}/behavior",
            json={"emotion_before": "Focused", "notes": "psychology only"},
        )
        plan_response = client.patch(
            f"/api/journal/{entry['id']}/behavior",
            json={"planned_stop_pct": 1.5},
        )
        recorded_at = plan_response.json()["data"]["plan_recorded_at"]
        after_response = client.patch(
            f"/api/journal/{entry['id']}/behavior",
            json={"emotion_after": "Satisfied"},
        )

    assert psychology_response.status_code == 200
    assert psychology_response.json()["data"]["plan_recorded_at"] is None
    assert plan_response.status_code == 200
    assert recorded_at is not None
    assert after_response.status_code == 200
    assert after_response.json()["data"]["plan_recorded_at"] == recorded_at


def test_exchange_refresh_preserves_user_journal_and_updates_exchange_facts(
    isolated_journal_store,
):
    entry = _add_imported_entry(
        external_id="binance:position:ownership-boundary",
        lifecycle_id="binance:lifecycle:old",
        emotion="Legacy calm",
        tags="binance,swap,closed-position",
        mistakes="Legacy early entry",
        notes="generated import note",
        planned_stop_pct=1.0,
        planned_target_pct=2.0,
        planned_entry_reason="Original plan",
        setup_tags=["trend"],
        mistake_tags=["early-entry"],
        plan_recorded_at="2026-08-20T09:00:00+00:00",
        fee=1.0,
        exit_price=103.0,
        realized_pnl=30.0,
    )
    journal_repository.update_entry_behavior(entry["id"], {
        "notes": "user-edited note",
        "planned_stop_pct": 1.5,
        "planned_target_pct": 3.5,
        "planned_entry_reason": "User plan",
        "setup_tags": ["breakout"],
        "mistake_tags": ["late-entry"],
        "emotion_before": "Calm",
        "emotion_during": "Focused",
        "emotion_after": "Satisfied",
        "confidence_score": 4,
        "focus_score": 5,
        "fomo": False,
        "revenge_trade": True,
    })

    updated_count = journal_repository.update_imported_entries_by_external_id([{
        "external_id": entry["external_id"],
        "source": "binance_position",
        "lifecycle_id": "binance:lifecycle:refreshed",
        "symbol": "BTC/USDT",
        "exit_price": 104.5,
        "realized_pnl": 45.0,
        "fee": 1.25,
        "tags": "binance,swap,refreshed-position",
        "notes": "regenerated sync note must not win",
        "emotion": "sync must not overwrite",
        "mistakes": "sync must not overwrite",
        "planned_stop_pct": 99.0,
        "emotion_before": "sync must not overwrite",
        "fomo": True,
    }])

    assert updated_count == 1
    refreshed = journal_repository.list_entries()[0]
    assert refreshed["lifecycle_id"] == "binance:lifecycle:refreshed"
    assert refreshed["exit_price"] == 104.5
    assert refreshed["realized_pnl"] == 45.0
    assert refreshed["fee"] == 1.25
    # Legacy tags are generated by exchange importers and remain sync-owned.
    assert refreshed["tags"] == "binance,swap,refreshed-position"

    assert refreshed["emotion"] == "Legacy calm"
    assert refreshed["mistakes"] == "Legacy early entry"
    assert refreshed["notes"] == "user-edited note"
    assert refreshed["planned_stop_pct"] == 1.5
    assert refreshed["planned_target_pct"] == 3.5
    assert refreshed["planned_entry_reason"] == "User plan"
    assert refreshed["setup_tags"] == ["breakout"]
    assert refreshed["mistake_tags"] == ["late-entry"]
    assert refreshed["plan_recorded_at"] == "2026-08-20T09:00:00+00:00"
    assert refreshed["emotion_before"] == "Calm"
    assert refreshed["emotion_during"] == "Focused"
    assert refreshed["emotion_after"] == "Satisfied"
    assert refreshed["confidence_score"] == 4
    assert refreshed["focus_score"] == 5
    assert refreshed["fomo"] is False
    assert refreshed["revenge_trade"] is True
