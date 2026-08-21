import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.modules.indicators.service import run_vpvr_service, run_vpvr_source_service


def _vpvr_frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "open_time": [1_700_000_000_000, 1_700_014_400_000],
            "open_dt": pd.to_datetime([1_700_000_000_000, 1_700_014_400_000], unit="ms"),
            "open": [35_000.0, 35_100.0],
            "high": [35_200.0, 35_300.0],
            "low": [34_900.0, 35_000.0],
            "close": [35_100.0, 35_250.0],
            "volume": [123.4, 98.7],
            "close_time": [1_700_014_399_999, 1_700_028_799_999],
            "quote_volume": [4_330_000.0, 3_480_000.0],
            "trade_count": [1_234, 987],
            "taker_buy_base_volume": [60.0, 45.0],
            "taker_buy_quote_volume": [2_100_000.0, 1_590_000.0],
        }
    )


def test_vpvr_source_service_normalizes_binance_ohlcv(monkeypatch):
    monkeypatch.setattr(
        "backend.modules.indicators.service.fetch_binance_klines",
        lambda symbol, interval, total_candles: _vpvr_frame(),
    )

    response = run_vpvr_source_service("btc", "4h", 500)

    assert response["success"] is True
    assert response["data"]["source"] == "binance"
    assert response["data"]["symbol"] == "BTC/USDT"
    assert response["data"]["requested_candles"] == 500
    assert response["data"]["count"] == 1
    assert response["data"]["candles"][0] == {
        "open_time": 1_700_000_000_000,
        "open_time_iso": "2023-11-14T22:13:20Z",
        "open": 35_000.0,
        "high": 35_200.0,
        "low": 34_900.0,
        "close": 35_100.0,
        "volume": 123.4,
        "close_time": 1_700_014_399_999,
        "quote_volume": 4_330_000.0,
        "trade_count": 1_234,
        "taker_buy_base_volume": 60.0,
        "taker_buy_quote_volume": 2_100_000.0,
    }


@pytest.mark.parametrize(
    ("interval", "expected_candles"),
    [
        ("1h", 240),
        ("2h", 240),
        ("4h", 240),
        ("1d", 180),
        ("30m", 300),
    ],
)
def test_vpvr_source_service_uses_timeframe_default_window(monkeypatch, interval, expected_candles):
    requested = {}

    def load_candles(symbol, requested_interval, total_candles):
        requested.update(
            symbol=symbol,
            interval=requested_interval,
            total_candles=total_candles,
        )
        return _vpvr_frame()

    monkeypatch.setattr("backend.modules.indicators.service.fetch_binance_klines", load_candles)

    response = run_vpvr_source_service("BTC", interval)

    assert requested == {
        "symbol": "BTCUSDT",
        "interval": interval,
        "total_candles": expected_candles + 1,
    }
    assert response["data"]["requested_candles"] == expected_candles


def test_vpvr_source_route_uses_typed_contract(monkeypatch):
    monkeypatch.setattr(
        "backend.modules.indicators.router.run_vpvr_source_service",
        lambda coin, interval, candles: {
            "success": True,
            "data": {
                "source": "binance",
                "symbol": f"{coin}/USDT",
                "interval": interval,
                "requested_candles": candles,
                "count": 0,
                "candles": [],
            },
        },
    )

    with TestClient(main.app) as client:
        response = client.get("/api/indicators/vpvr-source/BTC/4h?candles=500")

    assert response.status_code == 200
    assert response.json()["data"] == {
        "source": "binance",
        "symbol": "BTC/USDT",
        "interval": "4h",
        "requested_candles": 500,
        "count": 0,
        "candles": [],
    }


def test_vpvr_source_route_validates_candle_limit():
    with TestClient(main.app) as client:
        response = client.get("/api/indicators/vpvr-source/BTC/4h?candles=10")

    assert response.status_code == 422


def test_vpvr_service_returns_price_bins(monkeypatch):
    monkeypatch.setattr(
        "backend.modules.indicators.service.fetch_binance_klines",
        lambda symbol, interval, total_candles: _vpvr_frame(),
    )

    response = run_vpvr_service("BTC", "4h", bin_count=8)

    assert response["success"] is True
    assert response["data"]["requested_candles"] == 240
    assert response["data"]["bin_count"] == 8
    assert response["data"]["candle_count"] == 1
    assert response["data"]["allocation_method"] == "candle_range_proportional"
    assert response["data"]["price_range"] == pytest.approx(312.0)
    assert response["data"]["vwap"] == pytest.approx(4_330_000 / 123.4)
    assert len(response["data"]["bins"]) == 8
    assert sum(row["volume"] for row in response["data"]["bins"]) == pytest.approx(4_330_000.0)


def test_vpvr_route_uses_typed_contract(monkeypatch):
    monkeypatch.setattr(
        "backend.modules.indicators.router.run_vpvr_service",
        lambda coin, interval, candles, bin_count, price_range: {
            "success": True,
            "data": {
                "source": "binance",
                "symbol": f"{coin}/USDT",
                "interval": interval,
                "requested_candles": candles or 240,
                "candle_count": 1,
                "bin_count": bin_count,
                "price_low": 100.0,
                "price_high": 110.0,
                "current_price": 105.0,
                "vwap": 105.0,
                "total_quote_volume": 1_000.0,
                "poc_price_low": 100.0,
                "poc_price_high": 110.0,
                "value_area_low": 100.0,
                "value_area_high": 110.0,
                "value_area_pct": 0.7,
                "price_range": price_range,
                "allocation_method": "candle_range_proportional",
                "bins": [
                    {
                        "price_low": 100.0,
                        "price_high": 110.0,
                        "volume": 1_000.0,
                        "buy_volume": 600.0,
                        "sell_volume": 400.0,
                        "delta": 200.0,
                        "volume_pct": 100.0,
                        "is_poc": True,
                        "is_value_area": True,
                        "is_current": True,
                    }
                ],
            },
        },
    )

    with TestClient(main.app) as client:
        response = client.get("/api/indicators/vpvr/BTC/4h?bin_count=8")

    assert response.status_code == 200
    assert response.json()["data"]["bin_count"] == 8
