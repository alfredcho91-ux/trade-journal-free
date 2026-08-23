from backend.modules.exchanges import credentials, service


def _trade(
    identifier: str,
    timestamp_ms: int,
    side: str,
    amount: float,
    price: float,
    *,
    fee: float = 0.0,
    position_side=None,
):
    return service._Trade(
        external_id=f"bybit:fill:{identifier}",
        timestamp_ms=timestamp_ms,
        symbol="BTC/USDT",
        coin="BTC",
        side=side,
        amount=amount,
        price=price,
        fee=fee,
        fee_currency="USDT",
        order_id=identifier,
        position_side=position_side,
        contract_size=1.0,
    )


def test_reconstructs_partial_exits_as_one_closed_position():
    trades = [
        _trade("entry", 1_000, "buy", 2, 100, fee=0.2),
        _trade("tp1", 2_000, "sell", 1, 110, fee=0.1),
        _trade("tp2", 3_000, "sell", 1, 120, fee=0.1),
    ]

    positions, ignored = service._reconstruct_positions("bybit", trades, "SWAP")

    assert ignored == 0
    assert len(positions) == 1
    assert positions[0]["direction"] == "Long"
    assert positions[0]["size"] == 2
    assert positions[0]["entry_price"] == 100
    assert positions[0]["exit_price"] == 115
    assert positions[0]["realized_pnl"] == 29.6


def test_reconstruction_keeps_lifecycle_weighted_prices_after_reduce_then_add():
    trades = [
        _trade("entry-1", 1_000, "buy", 2, 100),
        _trade("reduce", 2_000, "sell", 1, 110),
        _trade("entry-2", 3_000, "buy", 1, 120),
        _trade("close", 4_000, "sell", 2, 130),
    ]

    positions, ignored = service._reconstruct_positions("bybit", trades, "SWAP")

    assert ignored == 0
    assert len(positions) == 1
    assert positions[0]["size"] == 3
    assert round(positions[0]["entry_price"], 6) == round(320 / 3, 6)
    assert round(positions[0]["exit_price"], 6) == round(370 / 3, 6)
    assert positions[0]["realized_pnl"] == 50


def test_reconstructs_hedge_mode_short_direction():
    trades = [
        _trade("entry", 1_000, "sell", 1, 100, position_side="SHORT"),
        _trade("exit", 2_000, "buy", 1, 90, position_side="SHORT"),
    ]

    positions, ignored = service._reconstruct_positions("bybit", trades, "SWAP")

    assert ignored == 0
    assert positions[0]["direction"] == "Short"
    assert positions[0]["realized_pnl"] == 10


def test_swap_reconstruction_excludes_uncertain_first_ledger_lifecycle():
    trades = [
        _trade("old-close", 1_000, "sell", 1, 100),
        _trade("old-offset", 2_000, "buy", 1, 90),
        _trade("known-entry", 3_000, "buy", 1, 100),
        _trade("known-exit", 4_000, "sell", 1, 110),
    ]

    ignored_external_ids = set()
    positions, ignored = service._reconstruct_positions(
        "binance",
        trades,
        "SWAP",
        skip_uncertain_initial_lifecycle=True,
        ignored_external_ids=ignored_external_ids,
    )

    assert ignored == 1
    assert len(positions) == 1
    assert positions[0]["direction"] == "Long"
    assert positions[0]["entry_price"] == 100
    assert positions[0]["exit_price"] == 110
    assert len(ignored_external_ids) == 1
    assert next(iter(ignored_external_ids)).startswith("binance:position:")


def test_swap_reconstruction_keeps_subsequent_split_short_lifecycle():
    trades = [
        _trade("boundary-buy", 1_000, "buy", 1, 100),
        _trade("boundary-sell", 2_000, "sell", 1, 100),
        _trade("short-1", 3_000, "sell", 1, 100),
        _trade("short-2", 4_000, "sell", 1, 110),
        _trade("cover-1", 5_000, "buy", 1, 90),
        _trade("cover-2", 6_000, "buy", 1, 80),
    ]

    positions, ignored = service._reconstruct_positions(
        "binance", trades, "SWAP", skip_uncertain_initial_lifecycle=True
    )

    assert ignored == 1
    assert len(positions) == 1
    assert positions[0]["direction"] == "Short"
    assert positions[0]["size"] == 2
    assert positions[0]["entry_price"] == 105
    assert positions[0]["exit_price"] == 85
    assert positions[0]["realized_pnl"] == 40


def test_spot_does_not_invent_short_for_sell_without_loaded_entry():
    trades = [
        _trade("old-exit", 1_000, "sell", 1, 100),
        _trade("entry", 2_000, "buy", 1, 100),
        _trade("exit", 3_000, "sell", 1, 105),
    ]

    positions, ignored = service._reconstruct_positions("binance", trades, "SPOT")

    assert ignored == 1
    assert len(positions) == 1
    assert positions[0]["direction"] == "Long"
    assert positions[0]["invested_amount"] == 100


def test_exchange_status_never_returns_credentials(monkeypatch):
    def resolve(exchange_id):
        if exchange_id == "binance":
            return credentials.CredentialResolution(
                credentials.StoredCredentials("key", "secret"), "environment"
            )
        return credentials.CredentialResolution(None, "none")

    monkeypatch.setattr(service, "resolve_exchange_credentials", resolve)

    result = service.exchange_status_service()

    binance = next(item for item in result["data"]["exchanges"] if item["id"] == "binance")
    assert binance["configured"] is True
    assert "api_key" not in binance
    assert "secret_key" not in binance


def test_exchange_status_distinguishes_storage_error(monkeypatch):
    monkeypatch.setattr(
        service,
        "resolve_exchange_credentials",
        lambda _exchange_id: credentials.CredentialResolution(
            None, "none", "Protected credential storage is unavailable"
        ),
    )

    result = service.exchange_status_service()

    assert result["data"]["exchanges"][0]["credential_error"] == "Protected credential storage is unavailable"


def test_open_positions_uses_live_exchange_apis_not_raw_fill_history(monkeypatch):
    configured = service._Credentials("key", "secret", "passphrase")
    monkeypatch.setattr(service, "_credentials", lambda exchange_id: configured if exchange_id in {"deepcoin", "bybit"} else None)
    monkeypatch.setattr(service, "_deepcoin_open_positions", lambda _credentials: [{
        "position_id": "deepcoin-btc", "exchange": "deepcoin", "symbol": "BTC/USDT",
        "direction": "Long", "size": 0.1,
    }])
    monkeypatch.setattr(service, "_ccxt_open_positions", lambda exchange_id, _credentials: [{
        "position_id": f"{exchange_id}-eth", "exchange": exchange_id, "symbol": "ETH/USDT",
        "direction": "Short", "size": 1.0,
    }])

    result = service.exchange_open_positions_service()

    assert result["success"] is True
    assert [(item["exchange"], item["symbol"]) for item in result["data"]["positions"]] == [
        ("bybit", "ETH/USDT"),
        ("deepcoin", "BTC/USDT"),
    ]
    assert result["data"]["unavailable_exchanges"] == []


def test_open_positions_isolates_credential_storage_failure(monkeypatch):
    configured = service._Credentials("key", "secret", "passphrase")

    def load(exchange_id):
        if exchange_id == "deepcoin":
            raise credentials.CredentialStorageError("protected storage unavailable")
        return configured if exchange_id == "bybit" else None

    monkeypatch.setattr(service, "_credentials", load)
    monkeypatch.setattr(service, "_ccxt_open_positions", lambda exchange_id, _credentials: [{
        "position_id": f"{exchange_id}-btc", "exchange": exchange_id, "symbol": "BTC/USDT",
        "direction": "Long", "size": 1.0,
    }])

    result = service.exchange_open_positions_service()

    assert result["data"]["unavailable_exchanges"] == ["deepcoin"]
    assert result["data"]["positions"][0]["exchange"] == "bybit"


def test_ccxt_without_position_endpoint_is_unavailable(monkeypatch):
    class Client:
        name = "Test Exchange"
        has = {"fetchPositions": False}

        def load_markets(self):
            return None

        def close(self):
            return None

    monkeypatch.setattr(service, "_exchange_client", lambda *_args: Client())

    try:
        service._ccxt_open_positions("bybit", service._Credentials("key", "secret"))
    except service.DataLoadError:
        pass
    else:
        raise AssertionError("unsupported position lookup must not be reported as an empty account")
