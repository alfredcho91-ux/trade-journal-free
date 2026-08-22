from backend.modules.exchanges import ccxt_adapter


class _Client:
    name = "Test Exchange"
    options = {"defaultType": "spot"}
    markets = {"BTC/USDT": {"base": "BTC", "quote": "USDT", "spot": True}}

    def __init__(self):
        self.calls = []

    def fetch_my_trades(self, symbol, since, limit):
        self.calls.append((symbol, since, limit))
        pages = [
            [{"id": "a", "timestamp": 1_000, "order": "1", "side": "buy"}, {"id": "b", "timestamp": 1_000, "order": "2", "side": "buy"}],
            [{"id": "c", "timestamp": 1_000, "order": "3", "side": "buy"}, {"id": "d", "timestamp": 1_001, "order": "4", "side": "buy"}],
            [],
        ]
        return pages[len(self.calls) - 1]


def test_fetch_trades_rechecks_an_inclusive_timestamp_boundary(monkeypatch):
    monkeypatch.setattr(ccxt_adapter, "TRADE_PAGE_SIZE", 2)
    client = _Client()

    result = ccxt_adapter.fetch_trades(client, ["BTC/USDT"], 0)

    assert [item["id"] for item in result.trades] == ["a", "b", "c", "d"]
    assert [call[1] for call in client.calls] == [0, 1_000, 1_001]
    assert result.truncated_symbols == []
