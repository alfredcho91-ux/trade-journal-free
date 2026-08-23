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


def test_fetch_binance_trades_walks_all_time_windows_to_the_latest_fill(monkeypatch):
    class Client:
        id = "binanceusdm"
        name = "Binance USD-M"
        options = {"defaultType": "swap"}
        markets = {
            "BTC/USDT:USDT": {
                "symbol": "BTC/USDT:USDT",
                "base": "BTC",
                "quote": "USDT",
                "swap": True,
                "linear": True,
            },
        }

        def __init__(self):
            self.calls = []

        def fetch_my_trades(self, symbol, since, limit, params):
            self.calls.append((symbol, since, limit, params["until"]))
            return [{
                "id": str(params["until"]),
                "timestamp": params["until"],
                "order": str(params["until"]),
                "side": "buy",
            }]

    monkeypatch.setattr(ccxt_adapter, "BINANCE_TRADE_WINDOW_MS", 1_000)
    monkeypatch.setattr(ccxt_adapter.time, "time", lambda: 3.5)
    client = Client()

    result = ccxt_adapter.fetch_trades(client, ["BTC/USDT"], 0)

    assert [item["timestamp"] for item in result.trades] == [999, 1_999, 2_999, 3_500]
    assert [call[3] for call in client.calls] == [999, 1_999, 2_999, 3_500]
    assert result.truncated_symbols == []


def test_fetch_binance_funding_income_normalizes_symbol_and_value():
    class Client:
        def fapiPrivateGetIncome(self, _params):
            return [{
                "tranId": "funding-1",
                "time": 2_000,
                "symbol": "BTCUSDT",
                "income": "-0.25",
                "asset": "USDT",
            }]

    events, coverage_start, truncated = ccxt_adapter.fetch_binance_funding_income(
        Client(),
        1_000,
        until=3_000,
    )

    assert coverage_start == 1_000
    assert truncated is False
    assert events == [{
        "timestamp_ms": 2_000,
        "symbol": "BTC/USDT",
        "income": -0.25,
        "asset": "USDT",
    }]


def test_normalize_trades_marks_missing_or_third_currency_fee_incomplete():
    class Client:
        markets = {"BTC/USDT:USDT": {"base": "BTC", "quote": "USDT", "contractSize": 1}}

    base = {
        "timestamp": 1_000,
        "symbol": "BTC/USDT:USDT",
        "side": "buy",
        "amount": 1,
        "price": 100,
    }
    trades, ignored = ccxt_adapter.normalize_trades("binance", Client(), [
        {**base, "id": "missing"},
        {**base, "id": "bnb", "fee": {"cost": 0.01, "currency": "BNB"}},
    ])

    assert ignored == 0
    assert [trade.fee_complete for trade in trades] == [False, False]
    assert [trade.fee_currency for trade in trades] == [None, None]
