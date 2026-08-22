from backend.modules.journal import performance


def test_performance_summary_uses_net_pnl_and_invested_margin(monkeypatch):
    monkeypatch.setattr(performance.repository, "list_entries", lambda: [
        {
            "id": 1, "source": "deepcoin_position", "datetime": "2026-08-10T00:00:00Z",
            "symbol": "BTC/USDT", "direction": "Long", "realized_pnl": 20,
            "invested_amount": 100, "fee": 2, "funding_fee": -1,
        },
        {
            "id": 2, "source": "deepcoin_position", "datetime": "2026-08-11T00:00:00Z",
            "symbol": "BTC/USDT", "direction": "Short", "realized_pnl": -10,
            "invested_amount": 100, "fee": 1, "funding_fee": 0.5,
        },
        {"id": 3, "source": "deepcoin_fill", "datetime": "2026-08-11T00:00:00Z", "realized_pnl": 999},
    ])

    result = performance.run_journal_performance_service(1_786_000_000_000, 1_788_000_000_000)["data"]

    assert result["closed_trade_count"] == 2
    assert result["wins"] == 1
    assert result["losses"] == 1
    assert result["win_rate_pct"] == 50
    assert result["net_pnl"] == 10
    assert result["net_return_pct"] == 5
    assert result["profit_factor"] == 2
    assert result["fee_impact"] == -3
    assert result["funding_impact"] == -0.5
    assert [item["id"] for item in result["directions"]] == ["Long", "Short"]
