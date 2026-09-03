from __future__ import annotations

import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.modules.journal import daily_repository
from backend.modules.journal import repository as journal_repository


@pytest.fixture
def isolated_daily_store(monkeypatch, tmp_path):
    journal_dir = tmp_path / "daily-journal-store"
    db_path = journal_dir / "trade_journal.db"
    csv_path = journal_dir / "trade_journal.csv"
    monkeypatch.setattr(journal_repository, "JOURNAL_DB_PATH", db_path)
    monkeypatch.setattr(journal_repository, "JOURNAL_CSV_PATH", csv_path)
    journal_repository.INITIALIZED_DATABASES.clear()
    yield db_path
    journal_repository.INITIALIZED_DATABASES.clear()


def test_create_get_list_and_delete_daily_journal(isolated_daily_store):
    payload = {
        "market_bias": "Bullish above weekly VWAP",
        "session_plan": "Wait for the opening range to resolve.",
        "max_daily_loss": 150.0,
        "max_trade_count": 3,
        "pre_session_notes": "Calm and prepared",
        "post_session_notes": "Stopped after the limit",
        "what_went_well": "Followed position sizing",
        "what_went_wrong": "Second entry was early",
        "next_focus": "Wait for candle close",
    }
    with TestClient(app) as client:
        created = client.put("/api/journal/daily/2026-09-03", json=payload)
        fetched = client.get("/api/journal/daily/2026-09-03")
        listed = client.get("/api/journal/daily")
        deleted = client.delete("/api/journal/daily/2026-09-03")
        missing = client.get("/api/journal/daily/2026-09-03")

    assert created.status_code == 200
    assert created.json()["data"]["trade_date"] == "2026-09-03"
    assert {key: created.json()["data"][key] for key in payload} == payload
    assert fetched.status_code == 200
    assert fetched.json()["data"] == created.json()["data"]
    assert listed.status_code == 200
    assert listed.json()["data"] == [created.json()["data"]]
    assert deleted.status_code == 200
    assert missing.status_code == 404


def test_one_record_per_date_and_upsert_is_idempotent(isolated_daily_store):
    first = daily_repository.upsert_daily_journal("2026-09-03", {"market_bias": "Bullish"})
    second = daily_repository.upsert_daily_journal("2026-09-03", {"market_bias": "Bullish"})

    assert second == first
    with sqlite3.connect(isolated_daily_store) as conn:
        assert conn.execute("SELECT COUNT(*) FROM daily_journal_entries").fetchone()[0] == 1
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO daily_journal_entries (trade_date, created_at, updated_at) VALUES (?, ?, ?)",
                ("2026-09-03", "now", "now"),
            )


def test_partial_put_preserves_omitted_fields_and_null_clears(isolated_daily_store):
    with TestClient(app) as client:
        client.put("/api/journal/daily/2026-09-03", json={
            "market_bias": "Neutral",
            "session_plan": "Only A setups",
            "max_daily_loss": 100,
            "max_trade_count": 2,
        })
        changed = client.put("/api/journal/daily/2026-09-03", json={"market_bias": "Bearish"})
        cleared = client.put("/api/journal/daily/2026-09-03", json={"session_plan": None})

    assert changed.status_code == 200
    assert changed.json()["data"]["market_bias"] == "Bearish"
    assert changed.json()["data"]["session_plan"] == "Only A setups"
    assert changed.json()["data"]["max_daily_loss"] == 100
    assert changed.json()["data"]["max_trade_count"] == 2
    assert cleared.status_code == 200
    assert cleared.json()["data"]["session_plan"] is None
    assert cleared.json()["data"]["market_bias"] == "Bearish"


def test_created_at_is_stable_and_updated_at_changes_only_with_content(monkeypatch, isolated_daily_store):
    timestamps = iter([
        "2026-09-03T01:00:00+00:00",
        "2026-09-03T02:00:00+00:00",
    ])
    monkeypatch.setattr(daily_repository, "_utc_now", lambda: next(timestamps))

    created = daily_repository.upsert_daily_journal("2026-09-03", {"market_bias": "Neutral"})
    unchanged = daily_repository.upsert_daily_journal("2026-09-03", {"market_bias": "Neutral"})
    updated = daily_repository.upsert_daily_journal("2026-09-03", {"market_bias": "Bullish"})

    assert created["created_at"] == "2026-09-03T01:00:00+00:00"
    assert created["updated_at"] == "2026-09-03T01:00:00+00:00"
    assert unchanged["updated_at"] == created["updated_at"]
    assert updated["created_at"] == created["created_at"]
    assert updated["updated_at"] == "2026-09-03T02:00:00+00:00"


def test_date_range_filter_is_inclusive_and_ordered(isolated_daily_store):
    for trade_date in ("2026-09-01", "2026-09-03", "2026-09-05"):
        daily_repository.upsert_daily_journal(trade_date, {"market_bias": trade_date})

    with TestClient(app) as client:
        response = client.get(
            "/api/journal/daily",
            params={"start_date": "2026-09-02", "end_date": "2026-09-05"},
        )

    assert response.status_code == 200
    assert [item["trade_date"] for item in response.json()["data"]] == ["2026-09-03", "2026-09-05"]


@pytest.mark.parametrize("path", [
    "/api/journal/daily/not-a-date",
    "/api/journal/daily/2026-02-30",
])
def test_invalid_path_dates_are_rejected(isolated_daily_store, path):
    with TestClient(app) as client:
        response = client.get(path)
    assert response.status_code == 422


def test_invalid_range_is_rejected(isolated_daily_store):
    with TestClient(app) as client:
        response = client.get(
            "/api/journal/daily",
            params={"start_date": "2026-09-04", "end_date": "2026-09-03"},
        )
    assert response.status_code == 422


@pytest.mark.parametrize("payload", [
    {"max_daily_loss": 0},
    {"max_daily_loss": -1},
    {"max_trade_count": 0},
    {"max_trade_count": 1.5},
    {"market_bias": "x" * 161},
    {"session_plan": "x" * 5001},
    {"next_focus": "x" * 2001},
])
def test_daily_input_validation_rejects_invalid_values(isolated_daily_store, payload):
    with TestClient(app) as client:
        response = client.put("/api/journal/daily/2026-09-03", json=payload)
    assert response.status_code == 422


def test_daily_input_validation_accepts_text_boundaries(isolated_daily_store):
    with TestClient(app) as client:
        response = client.put("/api/journal/daily/2026-09-03", json={
            "market_bias": "x" * 160,
            "session_plan": "x" * 5000,
            "next_focus": "x" * 2000,
        })
    assert response.status_code == 200


def test_missing_delete_returns_not_found(isolated_daily_store):
    with TestClient(app) as client:
        response = client.delete("/api/journal/daily/2026-09-03")
    assert response.status_code == 404


def test_daily_static_route_does_not_hit_integer_entry_route(isolated_daily_store):
    with TestClient(app) as client:
        response = client.get("/api/journal/daily")
    assert response.status_code == 200
    assert response.json()["data"] == []
