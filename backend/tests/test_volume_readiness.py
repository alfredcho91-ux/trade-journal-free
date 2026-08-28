from __future__ import annotations

import pandas as pd
import pytest

from backend.modules.deepcoin import snapshot as deepcoin_snapshot
from backend.modules.journal import market_data
from backend.utils import data_service


def _kline(timestamp: int, volume: object) -> list[object]:
    return [
        timestamp,
        "100.0",
        "105.0",
        "95.0",
        "102.0",
        volume,
        timestamp + 59_999,
        "1020.0",
        10,
        "6.0",
        "612.0",
        "0",
    ]


def test_binance_normalization_preserves_a_real_zero_volume():
    frame = data_service.normalize_binance_usdt_m_klines(
        [_kline(1_000, "0"), _kline(61_000, "12.5")],
        requested_candles=2,
    )

    assert frame is not None
    assert frame["volume"].tolist() == [0.0, 12.5]
    assert frame["quote_volume"].tolist() == [1020.0, 1020.0]


def test_binance_normalization_does_not_convert_missing_volume_to_zero():
    frame = data_service.normalize_binance_usdt_m_klines(
        [_kline(1_000, None), _kline(61_000, "0")],
        requested_candles=2,
    )

    assert frame is not None
    assert frame["open_time"].tolist() == [61_000]
    assert frame["volume"].tolist() == [0.0]
    assert frame.attrs["missing_volume_close_times"] == [60_999]


def test_cached_normalized_candles_keep_volume_and_missing_volume_metadata(monkeypatch):
    monkeypatch.setenv("DATA_CACHE_BACKEND", "memory")
    calls = 0

    @data_service.cached(ttl_seconds=60)
    def load_fixture() -> pd.DataFrame:
        nonlocal calls
        calls += 1
        frame = data_service.normalize_binance_usdt_m_klines(
            [_kline(1_000, None), _kline(61_000, "42.25")],
            2,
        )
        assert frame is not None
        return frame

    first = load_fixture()
    restored = load_fixture()

    assert calls == 1
    assert restored["volume"].tolist() == first["volume"].tolist() == [42.25]
    assert restored.attrs["missing_volume_close_times"] == first.attrs["missing_volume_close_times"] == [60_999]


def test_journal_market_data_exposes_volume_semantics(monkeypatch):
    raw = data_service.normalize_binance_usdt_m_klines([_kline(1_000, "10")], 1)
    assert raw is not None
    monkeypatch.setattr(market_data, "fetch_binance_klines", lambda *_args: raw)

    frame = market_data.load_journal_ohlcv("BTC/USDT", "1h", total_candles=1)

    assert frame is not None
    assert market_data.volume_metadata(frame) == {
        "canonical_field": "volume",
        "canonical_unit": "base_asset_quantity",
        "quote_volume_field": "quote_volume",
        "quote_volume_unit": "quote_asset_quantity",
        "taker_buy_base_volume_field": "taker_buy_base_volume",
        "taker_buy_quote_volume_field": "taker_buy_quote_volume",
        "missing_volume": "unavailable",
    }


def test_entry_snapshot_excludes_the_in_progress_candle_volume(monkeypatch):
    periods = 242
    open_times = pd.date_range("2026-01-01", periods=periods, freq="h", tz="UTC")
    close_times = open_times + pd.Timedelta(hours=1) - pd.Timedelta(milliseconds=1)
    close = pd.Series([50_000.0 + index for index in range(periods)])
    volumes = pd.Series([100.0] * (periods - 1) + [999_999.0])
    candles = pd.DataFrame(
        {
            "open_time": (open_times.astype("int64") // 1_000_000).astype("int64"),
            "open_dt": open_times,
            "open": close - 2,
            "high": close + 5,
            "low": close - 5,
            "close": close,
            "volume": volumes,
            "close_time": (close_times.astype("int64") // 1_000_000).astype("int64"),
            "quote_volume": close * volumes,
            "trade_count": 10,
            "taker_buy_base_volume": volumes / 2,
            "taker_buy_quote_volume": close * volumes / 2,
        }
    )
    captured: dict[str, float] = {}
    original = deepcoin_snapshot.compute_trend_judgment_indicators

    def capture_completed(frame: pd.DataFrame) -> pd.DataFrame:
        captured["max_volume"] = float(frame["volume"].max())
        return original(frame)

    monkeypatch.setattr(deepcoin_snapshot, "compute_trend_judgment_indicators", capture_completed)
    event = type(
        "Event",
        (),
        {
            "external_id": "volume-entry",
            "timestamp_ms": int((open_times[-1] + pd.Timedelta(minutes=3)).timestamp() * 1000),
            "coin": "BTC",
            "event_type": "position_entry",
        },
    )()

    result = deepcoin_snapshot.indicator_snapshot_for_event(candles, event, "1h")

    assert result["status"] == "complete"
    assert captured["max_volume"] == 100.0
    assert result["candle_close_time"] == close_times[-2].isoformat().replace("+00:00", "Z")


def test_entry_rvol20_uses_reference_volume_and_previous_twenty_completed_candles():
    assert deepcoin_snapshot._entry_rvol20(pd.DataFrame({"volume": [100.0] * 20 + [200.0]})) == 2.0
    assert deepcoin_snapshot._entry_rvol20(pd.DataFrame({"volume": [100.0] * 20 + [180.0]})) == 1.8
    assert deepcoin_snapshot._entry_rvol20(pd.DataFrame({"volume": [100.0] * 20 + [50.0]})) == 0.5


def test_entry_rvol20_requires_twenty_complete_baseline_volumes():
    assert deepcoin_snapshot._entry_rvol20(pd.DataFrame({"volume": [100.0] * 19 + [180.0]})) is None
    assert deepcoin_snapshot._entry_rvol20(pd.DataFrame({"volume": [100.0] * 10 + [None] + [100.0] * 9 + [180.0]})) is None
    assert deepcoin_snapshot._entry_rvol20(pd.DataFrame({"volume": [100.0] * 20 + [None]})) is None
    assert deepcoin_snapshot._entry_rvol20(pd.DataFrame({"volume": [0.0] * 20 + [180.0]})) is None


def test_entry_rvol20_keeps_real_zero_reference_distinct_from_missing_volume():
    assert deepcoin_snapshot._entry_rvol20(pd.DataFrame({"volume": [100.0] * 20 + [0.0]})) == 0.0
    assert deepcoin_snapshot._entry_rvol20(pd.DataFrame({"volume": [100.0] * 19 + [0.0, 200.0]})) == pytest.approx(200.0 / 95.0)


def test_entry_rvol20_uses_the_last_completed_candle_at_entry_boundary():
    periods = 242
    open_times = pd.date_range("2026-01-01", periods=periods, freq="h", tz="UTC")
    close_times = open_times + pd.Timedelta(hours=1) - pd.Timedelta(milliseconds=1)
    close = pd.Series([50_000.0 + index for index in range(periods)])
    volumes = pd.Series([100.0] * periods)
    volumes.iloc[-2] = 180.0
    volumes.iloc[-1] = 1_000.0
    candles = pd.DataFrame({
        "open_time": (open_times.astype("int64") // 1_000_000).astype("int64"),
        "open_dt": open_times,
        "open": close - 2,
        "high": close + 5,
        "low": close - 5,
        "close": close,
        "volume": volumes,
        "close_time": (close_times.astype("int64") // 1_000_000).astype("int64"),
        "quote_volume": close * volumes,
        "trade_count": 10,
        "taker_buy_base_volume": volumes / 2,
        "taker_buy_quote_volume": close * volumes / 2,
    })
    event = type("Event", (), {
        "external_id": "rvol-boundary",
        "timestamp_ms": int(open_times[-1].timestamp() * 1_000),
        "coin": "BTC",
        "event_type": "position_entry",
    })()

    result = deepcoin_snapshot.indicator_snapshot_for_event(candles, event, "1h")

    assert result["status"] == "complete"
    assert result["rvol20"] == 1.8
    assert result["candle_close_time"] == close_times[-2].isoformat().replace("+00:00", "Z")


def test_cached_and_fresh_completed_frames_produce_the_same_entry_rvol20():
    fresh = pd.DataFrame({"volume": [100.0] * 20 + [182.0]})
    restored = fresh.copy(deep=True)

    assert deepcoin_snapshot._entry_rvol20(fresh) == deepcoin_snapshot._entry_rvol20(restored) == 1.82


@pytest.mark.parametrize("missing_index", [220, 240])
def test_normalized_missing_volume_in_entry_window_never_shifts_rvol_backwards(missing_index):
    rows = [
        _kline(index * 3_600_000, None if index == missing_index else "100")
        for index in range(242)
    ]
    rows[239][5] = "200"
    candles = data_service.normalize_binance_usdt_m_klines(rows, requested_candles=242)
    assert candles is not None
    event = type("Event", (), {
        "external_id": f"missing-volume-{missing_index}",
        "timestamp_ms": 241 * 3_600_000,
        "coin": "BTC",
        "event_type": "position_entry",
    })()

    result = deepcoin_snapshot.indicator_snapshot_for_event(candles, event, "1h")

    assert result["status"] == "complete"
    assert result["rvol20"] is None
