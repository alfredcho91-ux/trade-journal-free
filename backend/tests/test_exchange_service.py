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


def test_reconstructs_hedge_mode_short_direction():
    trades = [
        _trade("entry", 1_000, "sell", 1, 100, position_side="SHORT"),
        _trade("exit", 2_000, "buy", 1, 90, position_side="SHORT"),
    ]

    positions, ignored = service._reconstruct_positions("bybit", trades, "SWAP")

    assert ignored == 0
    assert positions[0]["direction"] == "Short"
    assert positions[0]["realized_pnl"] == 10


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
