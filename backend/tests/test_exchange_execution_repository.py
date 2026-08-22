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
