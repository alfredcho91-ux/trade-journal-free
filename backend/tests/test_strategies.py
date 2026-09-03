from __future__ import annotations

import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.modules.journal import daily_repository, repository as journal_repository
from backend.modules.plan_lab import repository as plan_repository
from backend.modules.strategies import repository


@pytest.fixture
def strategy_db(monkeypatch, tmp_path):
    db_path = tmp_path / "strategy-playbook" / "trade_journal.db"
    csv_path = tmp_path / "strategy-playbook" / "trade_journal.csv"
    monkeypatch.setattr(journal_repository, "JOURNAL_DB_PATH", db_path)
    monkeypatch.setattr(journal_repository, "JOURNAL_CSV_PATH", csv_path)
    journal_repository.INITIALIZED_DATABASES.clear()
    yield db_path
    journal_repository.INITIALIZED_DATABASES.clear()


def _rules(suffix: str = "base"):
    return {
        "schema_version": 1,
        "entry_rules": [{"id": f"entry-{suffix}", "text": "Wait for close"}],
        "risk_rules": [{"id": f"risk-{suffix}", "text": "Risk one percent"}],
        "exit_rules": [{"id": f"exit-{suffix}", "text": "Exit on invalidation"}],
    }


def _version(label: str = "v1.0", suffix: str = "base"):
    return {
        "version_label": label,
        "description": f"Version {label}",
        "rules": _rules(suffix),
    }


def _strategy(name: str = "Breakout Momentum", label: str = "v1.0"):
    return {
        "name": name,
        "description": "Close-confirmed momentum entries",
        "initial_version": _version(label),
    }


def _post_strategy(client: TestClient, name: str = "Breakout Momentum", label: str = "v1.0"):
    response = client.post("/api/strategies", json=_strategy(name, label))
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_create_strategy_atomically_creates_active_initial_version(strategy_db):
    with TestClient(app) as client:
        strategy = _post_strategy(client)
        versions = client.get(f"/api/strategies/{strategy['id']}/versions").json()["data"]

    assert strategy["active_version_id"] == versions[0]["id"]
    assert [(item["sequence"], item["version_label"], item["is_active"]) for item in versions] == [
        (1, "v1.0", True)
    ]

    with sqlite3.connect(strategy_db) as conn:
        conn.execute(
            f"""CREATE TRIGGER fail_strategy_version_insert
            BEFORE INSERT ON {repository.VERSION_TABLE}
            BEGIN SELECT RAISE(ABORT, 'forced version failure'); END"""
        )
        conn.commit()
    with pytest.raises(sqlite3.IntegrityError, match="forced version failure"):
        repository.create_strategy(
            name="Atomic Failure",
            name_key="atomic failure",
            description=None,
            version_label="v1.0",
            version_label_key="v1.0",
            version_description=None,
            rules=_rules("failure"),
            db_path=strategy_db,
        )
    with sqlite3.connect(strategy_db) as conn:
        count = conn.execute(
            f"SELECT COUNT(*) FROM {repository.STRATEGY_TABLE} WHERE name_key='atomic failure'"
        ).fetchone()[0]
    assert count == 0


def test_normalized_name_uniqueness_including_archived_strategies(strategy_db):
    with TestClient(app) as client:
        created = _post_strategy(client, "Ｍomentum")
        archived = client.post(f"/api/strategies/{created['id']}/archive")
        duplicate = client.post("/api/strategies", json=_strategy("  momentum  "))

    assert archived.status_code == 200
    assert archived.json()["data"]["archived_at"] is not None
    assert duplicate.status_code == 409
    assert duplicate.json()["error_code"] == "STRATEGY_NAME_CONFLICT"


def test_strategy_metadata_archive_restore_and_default_listing(strategy_db):
    with TestClient(app) as client:
        created = _post_strategy(client)
        updated = client.patch(
            f"/api/strategies/{created['id']}",
            json={"name": "Breakout Retest", "description": None},
        )
        archived = client.post(f"/api/strategies/{created['id']}/archive")
        default_list = client.get("/api/strategies")
        full_list = client.get("/api/strategies?include_archived=true")
        restored = client.post(f"/api/strategies/{created['id']}/restore")

    assert updated.status_code == 200
    assert updated.json()["data"]["name"] == "Breakout Retest"
    assert updated.json()["data"]["description"] is None
    assert archived.json()["data"]["archived_at"] is not None
    assert default_list.json()["data"] == []
    assert [item["id"] for item in full_list.json()["data"]] == [created["id"]]
    assert restored.json()["data"]["archived_at"] is None


def test_version_sequence_label_normalization_and_cross_strategy_scope(strategy_db):
    with TestClient(app) as client:
        first = _post_strategy(client, "First")
        second = _post_strategy(client, "Second")
        first_v2 = client.post(
            f"/api/strategies/{first['id']}/versions", json=_version("v1.1", "first-v2")
        )
        second_v2 = client.post(
            f"/api/strategies/{second['id']}/versions", json=_version("v1.1", "second-v2")
        )
        duplicate = client.post(
            f"/api/strategies/{first['id']}/versions", json=_version("  V1.1  ", "duplicate")
        )

    assert first_v2.status_code == 200
    assert second_v2.status_code == 200
    assert first_v2.json()["data"]["sequence"] == 2
    assert second_v2.json()["data"]["sequence"] == 2
    assert duplicate.status_code == 409
    assert duplicate.json()["error_code"] == "STRATEGY_VERSION_LABEL_CONFLICT"


def test_concurrent_version_sequence_allocation_is_serialized(strategy_db):
    created = repository.create_strategy(
        name="Concurrent",
        name_key="concurrent",
        description=None,
        version_label="v1.0",
        version_label_key="v1.0",
        version_description=None,
        rules=_rules("initial"),
        db_path=strategy_db,
    )

    def create(index: int):
        label = f"v1.{index}"
        return repository.create_version(
            created["id"],
            version_label=label,
            version_label_key=label,
            description=None,
            rules=_rules(f"concurrent-{index}"),
            db_path=strategy_db,
        )

    with ThreadPoolExecutor(max_workers=4) as executor:
        versions = list(executor.map(create, range(1, 5)))

    assert sorted(item["sequence"] for item in versions) == [2, 3, 4, 5]
    stored = repository.list_versions(created["id"], db_path=strategy_db)
    assert stored is not None
    assert [item["sequence"] for item in stored] == [1, 2, 3, 4, 5]


def test_activate_retire_and_archive_lifecycle_preserves_history(strategy_db):
    with TestClient(app) as client:
        first = _post_strategy(client, "First")
        second = _post_strategy(client, "Second")
        first_versions = client.get(f"/api/strategies/{first['id']}/versions").json()["data"]
        second_versions = client.get(f"/api/strategies/{second['id']}/versions").json()["data"]
        v2_response = client.post(
            f"/api/strategies/{first['id']}/versions", json=_version("v2.0", "first-v2")
        )
        v2 = v2_response.json()["data"]

        wrong_parent = client.post(
            f"/api/strategies/{first['id']}/versions/{second_versions[0]['id']}/activate"
        )
        activated = client.post(
            f"/api/strategies/{first['id']}/versions/{v2['id']}/activate"
        )
        after_activation = client.get(
            f"/api/strategies/{first['id']}/versions"
        ).json()["data"]
        retired = client.post(
            f"/api/strategies/{first['id']}/versions/{v2['id']}/retire"
        )
        strategy_without_active = client.get(f"/api/strategies/{first['id']}")
        reactivate_retired = client.post(
            f"/api/strategies/{first['id']}/versions/{v2['id']}/activate"
        )

        client.post(f"/api/strategies/{first['id']}/archive")
        create_while_archived = client.post(
            f"/api/strategies/{first['id']}/versions", json=_version("v3.0", "first-v3")
        )
        activate_while_archived = client.post(
            f"/api/strategies/{first['id']}/versions/{first_versions[0]['id']}/activate"
        )
        archived_history = client.get(
            f"/api/strategies/{first['id']}/versions"
        ).json()["data"]
        restored = client.post(f"/api/strategies/{first['id']}/restore")

    assert wrong_parent.status_code == 409
    assert activated.status_code == 200
    assert sum(item["is_active"] for item in after_activation) == 1
    assert next(item for item in after_activation if item["is_active"])["id"] == v2["id"]
    assert retired.status_code == 200
    assert retired.json()["data"]["rules"] == v2["rules"]
    assert retired.json()["data"]["retired_at"] is not None
    assert strategy_without_active.json()["data"]["active_version_id"] is None
    assert reactivate_retired.status_code == 409
    assert create_while_archived.status_code == 409
    assert activate_while_archived.status_code == 409
    assert [item["id"] for item in archived_history] == [first_versions[0]["id"], v2["id"]]
    assert restored.json()["data"]["active_version_id"] is None


def test_rule_ids_roundtrip_and_version_definition_has_no_mutation_route(strategy_db):
    with TestClient(app) as client:
        created = _post_strategy(client)
        version = client.get(
            f"/api/strategies/{created['id']}/versions/{created['active_version_id']}"
        )
        mutation = client.patch(
            f"/api/strategies/{created['id']}/versions/{created['active_version_id']}",
            json={"description": "rewrite"},
        )

    assert version.status_code == 200
    assert version.json()["data"]["rules"] == _rules()
    assert mutation.status_code == 405
    assert not any(
        route.path == "/api/strategies/{strategy_id}/versions/{version_id}"
        and "PATCH" in (route.methods or set())
        for route in app.routes
    )


def test_new_version_preserves_explicit_rule_lineage_without_rewriting_old_version(strategy_db):
    with TestClient(app) as client:
        created = _post_strategy(client)
        next_rules = _rules()
        next_rules["entry_rules"][0]["text"] = "Wait for two confirmed closes"
        next_rules["risk_rules"].append({"id": "risk-new", "text": "Stop after two losses"})
        next_rules["exit_rules"] = []
        next_version = client.post(
            f"/api/strategies/{created['id']}/versions",
            json={**_version("v1.1"), "rules": next_rules},
        )
        original = client.get(
            f"/api/strategies/{created['id']}/versions/{created['active_version_id']}"
        )

    assert next_version.status_code == 200
    assert next_version.json()["data"]["rules"] == next_rules
    assert original.json()["data"]["rules"] == _rules()


def test_strategy_repository_enforces_foreign_keys_without_global_fk_change(strategy_db):
    repository.initialize_schema(db_path=strategy_db)
    with journal_repository._connect(strategy_db) as journal_conn:
        assert journal_conn.execute("PRAGMA foreign_keys").fetchone()[0] == 0
    with repository._connect(strategy_db) as strategy_conn:
        assert strategy_conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        with pytest.raises(sqlite3.IntegrityError):
            strategy_conn.execute(
                f"""INSERT INTO {repository.VERSION_TABLE}
                (strategy_id, sequence, version_label, version_label_key,
                 description, rules_json, is_active, retired_at, created_at)
                VALUES (999, 1, 'v1.0', 'v1.0', NULL, '{{}}', 1, NULL, 'now')"""
            )


def test_rule_document_rejects_duplicate_ids_and_executable_fields(strategy_db):
    duplicate_rules = _rules()
    duplicate_rules["risk_rules"][0]["id"] = duplicate_rules["entry_rules"][0]["id"]
    executable_rules = _rules()
    executable_rules["entry_rules"][0]["operator"] = ">"

    with TestClient(app) as client:
        duplicate = client.post(
            "/api/strategies", json={**_strategy("Duplicate Rule"), "initial_version": {
                **_version(), "rules": duplicate_rules,
            }}
        )
        executable = client.post(
            "/api/strategies", json={**_strategy("Executable Rule"), "initial_version": {
                **_version(), "rules": executable_rules,
            }}
        )

    assert duplicate.status_code == 422
    assert executable.status_code == 422


def test_strategy_api_uses_404_409_and_422_semantics(strategy_db):
    with TestClient(app) as client:
        missing = client.get("/api/strategies/999")
        missing_version_create = client.post(
            "/api/strategies/999/versions", json=_version("v2.0", "missing")
        )
        invalid = client.post(
            "/api/strategies", json=_strategy(" " * 5)
        )
        created = _post_strategy(client)
        conflict = client.post(
            "/api/strategies", json=_strategy(created["name"].swapcase())
        )

    assert missing.status_code == 404
    assert missing_version_create.status_code == 404
    assert invalid.status_code == 422
    assert conflict.status_code == 409


def _snapshot_tables(db_path, table_names):
    with sqlite3.connect(db_path) as conn:
        return {
            table: conn.execute(f"SELECT * FROM {table} ORDER BY rowid ASC").fetchall()
            for table in table_names
        }


def _build_pre_pr2a_database(db_path):
    entry, created = journal_repository.add_entry_if_new_external_id(
        {
            "source": "binance_position",
            "external_id": "binance:position:pre-pr2a",
            "lifecycle_id": "binance:lifecycle:pre-pr2a",
            "datetime": "2026-08-20T12:34:56+00:00",
            "entry_datetime": "2026-08-20T10:00:00+00:00",
            "symbol": "BTC/USDT",
            "timeframe": "4h",
            "direction": "Long",
            "entry_price": 108000.5,
            "exit_price": 110500.75,
            "pnl_pct": 2.315,
            "outcome": "Win",
            "emotion": "Calm",
            "emotion_before": "Focused",
            "emotion_during": "Patient",
            "emotion_after": "Satisfied",
            "confidence_score": 4,
            "focus_score": 5,
            "fomo": False,
            "revenge_trade": False,
            "planned_stop_pct": 1.4,
            "planned_target_pct": 3.2,
            "planned_entry_reason": "Retest the breakout level",
            "setup_tags": ["breakout", "trend"],
            "mistake_tags": ["early-entry"],
            "plan_recorded_at": "2026-08-20T09:55:00+00:00",
            "notes": "Preserve this note exactly",
            "exchange": "binance",
            "order_id": "order-pre-pr2a",
            "fee": 3.75,
            "fee_currency": "USDT",
            "funding_fee": -0.85,
            "realized_pnl": 123.456,
            "leverage": 5.0,
            "invested_amount": 5400.0,
            "pnl_calculation_version": 2,
            "indicator_snapshot": {"version": 2, "reference": "entry"},
            "created_at": "2026-08-20T12:35:00+00:00",
        },
        db_path=db_path,
    )
    assert created
    daily_repository.upsert_daily_journal(
        "2026-08-20",
        {
            "market_bias": "Bullish",
            "session_plan": "Wait for confirmation",
            "max_daily_loss": 250.0,
            "max_trade_count": 3,
            "pre_session_notes": "Patient",
            "post_session_notes": "Executed",
            "what_went_well": "Waited",
            "what_went_wrong": "None",
            "next_focus": "Repeat",
        },
        db_path=db_path,
    )
    journal_repository.create_behavior_rule(
        {
            "name": "Maximum stop",
            "rule_type": "max_stop_pct",
            "parameters": {"max_stop_pct": 2.0},
            "is_enabled": True,
        },
        db_path=db_path,
    )
    plan = plan_repository.create_retrospective_plan(
        {
            "exchange": "binance",
            "symbol": "BTC/USDT",
            "side": "Long",
            "revision": {
                "entry_price": None,
                "entry_min": None,
                "entry_max": None,
                "stop_loss": 106000.0,
                "take_profit": 112000.0,
                "take_profit_2": None,
                "setup": "breakout",
                "entry_note": "Historical plan",
                "exit_note": None,
                "memo": "Preserve",
                "max_hold_hours": 12.0,
                "client_created_at": None,
            },
        },
        entry["id"],
        db_path=db_path,
    )
    plan_repository.add_revision(
        plan["id"],
        {
            "entry_price": None,
            "entry_min": None,
            "entry_max": None,
            "stop_loss": 105500.0,
            "take_profit": 112500.0,
            "take_profit_2": None,
            "setup": "breakout",
            "entry_note": "Historical plan revision",
            "exit_note": None,
            "memo": "Preserve revision",
            "max_hold_hours": 10.0,
            "client_created_at": None,
        },
        db_path=db_path,
    )


def test_pre_pr2a_migration_is_lossless_idempotent_and_fk_clean(strategy_db):
    _build_pre_pr2a_database(strategy_db)
    existing_tables = (
        journal_repository.TABLE_NAME,
        journal_repository.RULE_TABLE_NAME,
        journal_repository.DAILY_TABLE_NAME,
        plan_repository.PLAN_TABLE,
        plan_repository.REVISION_TABLE,
        plan_repository.LINK_TABLE,
    )
    before = _snapshot_tables(strategy_db, existing_tables)

    repository.initialize_schema(db_path=strategy_db)
    after_first = _snapshot_tables(strategy_db, existing_tables)

    with sqlite3.connect(strategy_db) as conn:
        tables = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        indexes = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")
        }
        strategy_counts = (
            conn.execute(f"SELECT COUNT(*) FROM {repository.STRATEGY_TABLE}").fetchone()[0],
            conn.execute(f"SELECT COUNT(*) FROM {repository.VERSION_TABLE}").fetchone()[0],
        )
        first_fk_check = conn.execute("PRAGMA foreign_key_check").fetchall()

    assert after_first == before
    assert {repository.STRATEGY_TABLE, repository.VERSION_TABLE} <= tables
    assert {
        f"{repository.STRATEGY_TABLE}_archive_name",
        f"{repository.VERSION_TABLE}_strategy_sequence",
        f"{repository.VERSION_TABLE}_one_active",
    } <= indexes
    assert strategy_counts == (0, 0)
    assert first_fk_check == []

    journal_repository.INITIALIZED_DATABASES.clear()
    repository.initialize_schema(db_path=strategy_db)
    after_second = _snapshot_tables(strategy_db, existing_tables)
    with sqlite3.connect(strategy_db) as conn:
        second_fk_check = conn.execute("PRAGMA foreign_key_check").fetchall()

    assert after_second == before
    assert second_fk_check == []
