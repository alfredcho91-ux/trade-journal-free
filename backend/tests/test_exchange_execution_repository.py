import pytest

from backend.modules.exchanges.execution_repository import (
    add_executions_if_new,
    adopt_legacy_account_scope,
    list_executions,
)


def test_execution_repository_is_idempotent_and_preserves_snapshot(tmp_path):
    db_path = tmp_path / "journal.db"
    row = {
        "external_id": "bybit:fill:1",
        "datetime": "2026-08-01T00:00:00Z",
        "symbol": "BTC/USDT",
        "direction": "Long",
        "size": 1,
        "entry_price": 100,
        "source": "bybit_fill",
        "exchange": "Bybit",
        "notes": "Bybit SWAP fill: buy",
        "indicator_snapshot": {"reference": "entry"},
    }

    assert add_executions_if_new([row], db_path=db_path) == {"bybit:fill:1"}
    assert add_executions_if_new([row], db_path=db_path) == set()

    records = list_executions(exchange="Bybit", symbol="BTC/USDT", db_path=db_path)
    assert len(records) == 1
    assert records[0]["notes"] == "Bybit SWAP fill: buy"
    assert records[0]["indicator_snapshot"] == {"reference": "entry"}


@pytest.mark.parametrize("ledger_size", [4_999, 5_000, 5_001])
def test_execution_repository_returns_the_complete_ledger(tmp_path, ledger_size):
    db_path = tmp_path / "journal.db"
    rows = [
        {
            "external_id": f"binance:fill:{index}",
            "datetime": f"2026-01-01T{index // 3600:02d}:{(index // 60) % 60:02d}:{index % 60:02d}Z",
            "symbol": "BTC/USDT",
            "direction": "Long",
            "size": 1,
            "entry_price": 100,
            "source": "binance_fill",
            "exchange": "Binance",
            "notes": "Binance SWAP fill: buy",
        }
        for index in range(ledger_size)
    ]

    assert len(add_executions_if_new(rows, db_path=db_path)) == ledger_size

    records = list_executions(exchange="Binance", symbol="BTC/USDT", db_path=db_path)
    assert len(records) == ledger_size
    assert records[0]["external_id"] == "binance:fill:0"
    assert records[-1]["external_id"] == f"binance:fill:{ledger_size - 1}"


def test_legacy_execution_scope_backfill_is_additive_and_idempotent(tmp_path):
    db_path = tmp_path / "journal.db"
    add_executions_if_new([{
        "external_id": "binance:fill:legacy",
        "datetime": "2026-01-01T00:00:00Z",
        "symbol": "BTC/USDT",
        "direction": "Long",
        "size": 1,
        "entry_price": 100,
        "source": "binance_fill",
        "exchange": "Binance",
    }], db_path=db_path)

    assert adopt_legacy_account_scope("Binance", "account-a", db_path=db_path) == 1
    assert adopt_legacy_account_scope("Binance", "account-a", db_path=db_path) == 0
    assert len(list_executions(exchange="Binance", account_scope="account-a", db_path=db_path)) == 1


def test_legacy_scope_is_not_adopted_when_another_account_exists(tmp_path):
    db_path = tmp_path / "journal.db"
    add_executions_if_new([
        {
            "external_id": "binance:fill:scoped",
            "datetime": "2026-01-01T00:00:00Z",
            "symbol": "BTC/USDT",
            "direction": "Long",
            "size": 1,
            "entry_price": 100,
            "source": "binance_fill",
            "exchange": "Binance",
            "account_scope": "account-a",
        },
        {
            "external_id": "binance:fill:legacy",
            "datetime": "2026-01-01T00:01:00Z",
            "symbol": "BTC/USDT",
            "direction": "Long",
            "size": 1,
            "entry_price": 101,
            "source": "binance_fill",
            "exchange": "Binance",
        },
    ], db_path=db_path)

    assert adopt_legacy_account_scope("Binance", "account-b", db_path=db_path) == 0
    assert len(list_executions(exchange="Binance", account_scope="account-b", db_path=db_path)) == 0


def test_execution_query_can_limit_the_local_ledger_to_open_symbols(tmp_path):
    db_path = tmp_path / "journal.db"
    rows = []
    for index, symbol in enumerate(("BTC/USDT", "ETH/USDT", "SOL/USDT")):
        rows.append({
            "external_id": f"binance:fill:{index}",
            "datetime": f"2026-01-01T00:0{index}:00Z",
            "symbol": symbol,
            "direction": "Long",
            "size": 1,
            "entry_price": 100,
            "source": "binance_fill",
            "exchange": "Binance",
            "account_scope": "account-a",
        })
    add_executions_if_new(rows, db_path=db_path)

    selected = list_executions(
        exchange="Binance",
        symbols=["BTC/USDT", "SOL/USDT"],
        account_scope="account-a",
        db_path=db_path,
    )

    assert [row["symbol"] for row in selected] == ["BTC/USDT", "SOL/USDT"]
