import pytest

from backend.modules.exchanges.execution_repository import add_executions_if_new, list_executions


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
