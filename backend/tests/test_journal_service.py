from __future__ import annotations

import sqlite3
from itertools import count

import pandas as pd
import pytest

from backend.modules.journal import repository as journal_repository
from backend.modules.journal.service import (
    delete_journal_service,
    get_journal_service,
)


_external_ids = count(1)


def add_test_entry(payload):
    entry = dict(payload)
    entry.setdefault("source", "deepcoin_position")
    entry.setdefault("external_id", f"test:journal:{next(_external_ids)}")
    stored, created = journal_repository.add_entry_if_new_external_id(entry)
    assert created is True
    return {"success": True, "data": stored}


@pytest.fixture
def isolated_journal_store(monkeypatch, tmp_path):
    journal_dir = tmp_path / "journal-store"
    db_path = journal_dir / "trade_journal.db"
    csv_path = journal_dir / "trade_journal.csv"

    monkeypatch.setattr(journal_repository, "JOURNAL_DB_PATH", db_path)
    monkeypatch.setattr(journal_repository, "JOURNAL_CSV_PATH", csv_path)

    return db_path, csv_path


def test_journal_service_uses_sqlite_storage(isolated_journal_store):
    db_path, _ = isolated_journal_store

    created = add_test_entry(
        {
            "symbol": "BTC/USDT",
            "timeframe": "4h",
            "direction": "Long",
            "entry_reason_1_indicator": "RSI",
            "entry_reason_1": "4h support reclaim",
            "entry_reason_2_indicator": "MA",
            "entry_reason_2": "volume expansion on breakout",
            "entry_price": 100.0,
            "exit_price": 110.0,
            "pnl_pct": 10.0,
            "outcome": "Win",
        }
    )

    assert created["success"] is True
    assert created["data"]["id"] == 1
    assert created["data"]["entry_reason_1_indicator"] == "RSI"
    assert created["data"]["entry_reason_1"] == "4h support reclaim"
    assert created["data"]["entry_reason_2_indicator"] == "MA"
    assert db_path.exists()

    fetched = get_journal_service()
    assert fetched["success"] is True
    assert len(fetched["data"]) == 1
    assert fetched["data"][0]["symbol"] == "BTC/USDT"

    deleted = delete_journal_service(1)
    assert deleted == {"success": True, "message": "Entry deleted"}

    after_delete = get_journal_service()
    assert after_delete["data"] == []


def test_journal_migrates_signed_funding_pnl_once(isolated_journal_store):
    positive_funding = add_test_entry(
        {
            "source": "deepcoin_position",
            "external_id": "deepcoin:position:positive-funding",
            "realized_pnl": 10.0,
            "fee": 2.0,
            "funding_fee": 3.0,
            "outcome": "Win",
        }
    )
    negative_funding = add_test_entry(
        {
            "source": "deepcoin_position",
            "external_id": "deepcoin:position:negative-funding",
            "realized_pnl": 10.0,
            "fee": 2.0,
            "funding_fee": -3.0,
            "outcome": "Win",
        }
    )
    assert positive_funding["success"] is True
    assert negative_funding["success"] is True

    first_read = get_journal_service()["data"]
    second_read = get_journal_service()["data"]

    assert first_read[0]["realized_pnl"] == pytest.approx(16.0)
    assert first_read[1]["realized_pnl"] == pytest.approx(10.0)
    assert all(row["pnl_calculation_version"] == 2 for row in first_read)
    assert [row["realized_pnl"] for row in second_read] == pytest.approx([16.0, 10.0])


def test_journal_service_migrates_legacy_csv_and_is_cwd_independent(
    isolated_journal_store,
    monkeypatch,
    tmp_path,
):
    db_path, csv_path = isolated_journal_store
    csv_path.parent.mkdir(parents=True, exist_ok=True)

    pd.DataFrame(
        [
            {
                "id": 1,
                "datetime": "2026-03-01T00:00:00+00:00",
                "symbol": "ETH/USDT",
                "timeframe": "1h",
                "direction": "Long",
                "strategy_id": "A1",
                "size": 1.0,
                "entry_price": 2000.0,
                "exit_price": 2100.0,
                "pnl_pct": 5.0,
                "r_multiple": 1.5,
                "outcome": "Win",
                "emotion": "Calm",
                "tags": "breakout",
                "mistakes": "",
                "notes": "legacy row",
                "created_at": "2026-03-01T01:00:00+00:00",
            },
            {
                "id": 2,
                "datetime": "2026-03-02T00:00:00+00:00",
                "symbol": "SOL/USDT",
                "timeframe": "4h",
                "direction": "Short",
                "strategy_id": "B1",
                "size": 2.0,
                "entry_price": 150.0,
                "exit_price": 140.0,
                "pnl_pct": 6.67,
                "r_multiple": 2.0,
                "outcome": "Win",
                "emotion": "Confident",
                "tags": "trend",
                "mistakes": "",
                "notes": "legacy row 2",
                "created_at": "2026-03-02T01:00:00+00:00",
            },
        ]
    ).to_csv(csv_path, index=False)

    other_cwd = tmp_path / "elsewhere"
    other_cwd.mkdir()
    monkeypatch.chdir(other_cwd)

    fetched = get_journal_service()
    assert fetched["success"] is True
    assert [row["id"] for row in fetched["data"]] == [1, 2]
    assert fetched["data"][0]["entry_reason_1_indicator"] is None
    assert db_path.exists()

    created = add_test_entry({"symbol": "XRP/USDT", "outcome": "Loss"})
    assert created["success"] is True
    assert created["data"]["id"] == 3

    fetched_again = get_journal_service()
    assert len(fetched_again["data"]) == 3


def test_journal_service_migrates_existing_sqlite_schema_with_new_columns(
    isolated_journal_store,
):
    db_path, _ = isolated_journal_store
    db_path.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE journal_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                datetime TEXT,
                symbol TEXT,
                timeframe TEXT,
                direction TEXT,
                strategy_id TEXT,
                size REAL,
                entry_price REAL,
                exit_price REAL,
                pnl_pct REAL,
                r_multiple REAL,
                outcome TEXT,
                emotion TEXT,
                tags TEXT,
                mistakes TEXT,
                notes TEXT,
                created_at TEXT
            )
            """
        )
        conn.execute(
            """
            INSERT INTO journal_entries (
                datetime, symbol, timeframe, direction, strategy_id, outcome, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "2026-03-10T00:00:00+00:00",
                "BTC/USDT",
                "1h",
                "Long",
                "legacy",
                "Win",
                "2026-03-10T01:00:00+00:00",
            ),
        )
        conn.commit()

    created = add_test_entry(
        {
            "symbol": "ETH/USDT",
            "timeframe": "4h",
            "direction": "Short",
            "entry_reason_1_indicator": "MACD",
            "entry_reason_1": "lower high rejection",
            "entry_reason_2_indicator": "RSI",
            "entry_reason_2": "bearish divergence",
            "entry_reason_3_indicator": "MA",
            "entry_reason_3": "failed range retest",
            "outcome": "Loss",
        }
    )

    assert created["success"] is True
    assert created["data"]["id"] == 2
    assert created["data"]["entry_reason_2_indicator"] == "RSI"
    assert created["data"]["entry_reason_3"] == "failed range retest"
    assert created["data"]["entry_reason_3_indicator"] == "MA"

    fetched = get_journal_service()
    assert [row["id"] for row in fetched["data"]] == [1, 2]
    assert fetched["data"][0]["entry_reason_1"] is None
    assert fetched["data"][0]["entry_reason_1_indicator"] is None

    with sqlite3.connect(db_path) as conn:
        column_names = {
            row[1] for row in conn.execute("PRAGMA table_info(journal_entries)").fetchall()
        }

    assert {
        "entry_reason_1_indicator",
        "entry_reason_1",
        "entry_reason_2_indicator",
        "entry_reason_2",
        "entry_reason_3_indicator",
        "entry_reason_3",
        "indicators",
        "source",
        "external_id",
        "exchange",
        "order_id",
        "fee",
        "fee_currency",
        "funding_fee",
        "realized_pnl",
        "leverage",
        "invested_amount",
        "pnl_calculation_version",
        "indicator_snapshot",
    } <= column_names


def test_journal_repository_batches_external_id_reads_and_writes(isolated_journal_store):
    first, second = "deepcoin:position:batch-1", "deepcoin:position:batch-2"
    created = journal_repository.add_entries_if_new_external_ids([
        {"external_id": first, "source": "deepcoin_position", "symbol": "BTC/USDT", "realized_pnl": 1},
        {"external_id": second, "source": "deepcoin_position", "symbol": "ETH/USDT", "realized_pnl": 2},
    ])

    assert created == {first, second}
    assert journal_repository.existing_external_ids([first, "missing"]) == {first}
    assert journal_repository.update_imported_entries_by_external_id([
        {"external_id": first, "symbol": "BTC/USDT", "realized_pnl": 3},
        {"external_id": "missing", "symbol": "SOL/USDT", "realized_pnl": 4},
    ]) == 1

    rows = {row["external_id"]: row for row in get_journal_service()["data"]}
    assert rows[first]["realized_pnl"] == 3
    assert rows[second]["realized_pnl"] == 2


def test_snapshot_refresh_preserves_existing_execution_fields(isolated_journal_store):
    external_id = "deepcoin:position:snapshot-only"
    journal_repository.add_entries_if_new_external_ids([{
        "external_id": external_id,
        "source": "deepcoin_position",
        "symbol": "BTC/USDT",
        "entry_price": 64000,
        "exit_price": 65000,
        "realized_pnl": 42,
        "indicator_snapshot": {"version": 2},
    }])

    assert journal_repository.update_indicator_snapshots_by_external_id({
        external_id: {"version": 3, "timeframes": {"1h": {"status": "complete"}}},
    }) == 1

    stored = next(row for row in get_journal_service()["data"] if row["external_id"] == external_id)
    assert stored["entry_price"] == 64000
    assert stored["exit_price"] == 65000
    assert stored["realized_pnl"] == 42
    assert stored["indicator_snapshot"]["version"] == 3


def test_quarantine_preserves_user_annotations_and_can_be_restored(isolated_journal_store):
    external_id = "binance:position:boundary"
    stored = add_test_entry({
        "external_id": external_id,
        "source": "binance_position",
        "symbol": "BTC/USDT",
        "realized_pnl": 12,
        "outcome": "Win",
        "planned_stop_pct": 1.5,
        "planned_target_pct": 3.0,
        "planned_entry_reason": "breakout retest",
        "setup_tags": ["trend"],
        "mistake_tags": ["late-entry"],
        "entry_reason_1_indicator": "RSI",
        "entry_reason_1": "momentum confirmation",
        "mistakes": "chased the candle",
    })["data"]

    assert journal_repository.quarantine_imported_entries_by_external_id(
        [external_id],
        "binance_position_boundary_unverified",
    ) == 1
    quarantined = next(row for row in get_journal_service()["data"] if row["id"] == stored["id"])
    assert quarantined["source"] == "binance_position_boundary_unverified"
    assert quarantined["realized_pnl"] is None
    assert quarantined["planned_stop_pct"] == 1.5
    assert quarantined["planned_target_pct"] == 3.0
    assert quarantined["planned_entry_reason"] == "breakout retest"
    assert quarantined["setup_tags"] == ["trend"]
    assert quarantined["mistake_tags"] == ["late-entry"]
    assert quarantined["entry_reason_1"] == "momentum confirmation"
    assert quarantined["mistakes"] == "chased the candle"

    assert journal_repository.update_imported_entries_by_external_id([{
        "external_id": external_id,
        "source": "binance_position",
        "symbol": "BTC/USDT",
        "realized_pnl": 15,
        "outcome": "Win",
    }]) == 1
    restored = next(row for row in get_journal_service()["data"] if row["id"] == stored["id"])
    assert restored["id"] == stored["id"]
    assert restored["external_id"] == external_id
    assert restored["source"] == "binance_position"
    assert restored["realized_pnl"] == 15
    assert restored["planned_stop_pct"] == 1.5
    assert restored["planned_target_pct"] == 3.0
    assert restored["planned_entry_reason"] == "breakout retest"
    assert restored["setup_tags"] == ["trend"]
    assert restored["mistake_tags"] == ["late-entry"]
    assert restored["entry_reason_1_indicator"] == "RSI"
    assert restored["entry_reason_1"] == "momentum confirmation"
    assert restored["mistakes"] == "chased the candle"


def test_journal_service_maps_legacy_indicator_list_into_reason_indicators(
    isolated_journal_store,
):
    db_path, _ = isolated_journal_store
    db_path.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE journal_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                datetime TEXT,
                symbol TEXT,
                timeframe TEXT,
                direction TEXT,
                entry_reason_1 TEXT,
                entry_reason_2 TEXT,
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
                notes TEXT,
                created_at TEXT
            )
            """
        )
        conn.execute(
            """
            INSERT INTO journal_entries (
                datetime, symbol, timeframe, direction, entry_reason_1, indicators, outcome, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "2026-03-12T00:00:00+00:00",
                "SOL/USDT",
                "4h",
                "Long",
                "bullish divergence confirmed",
                '["RSI", "EMA 200", "Volume"]',
                "Win",
                "2026-03-12T01:00:00+00:00",
            ),
        )
        conn.commit()

    fetched = get_journal_service()

    assert fetched["success"] is True
    assert fetched["data"][0]["entry_reason_1_indicator"] == "RSI"
    assert fetched["data"][0]["entry_reason_2_indicator"] == "MA"
    assert fetched["data"][0]["entry_reason_3_indicator"] == "Volume"
