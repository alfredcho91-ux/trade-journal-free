from __future__ import annotations

import pandas as pd
import pytest

from backend.modules.journal import repository
from backend.modules.journal.analysis import _position_batches, run_journal_excursions_service


@pytest.fixture
def isolated_store(monkeypatch, tmp_path):
    monkeypatch.setattr(repository, "JOURNAL_DB_PATH", tmp_path / "journal.db")
    monkeypatch.setattr(repository, "JOURNAL_CSV_PATH", tmp_path / "journal.csv")


def _add_position(**overrides):
    payload = {
        "datetime": "2026-08-01T00:58:00Z",
        "entry_datetime": "2026-08-01T00:02:00Z",
        "symbol": "BTC/USDT",
        "direction": "Long",
        "entry_price": 100.0,
        "exit_price": 103.0,
        "source": "deepcoin_position",
        "external_id": "position:1",
    }
    payload.update(overrides)
    stored, created = repository.add_entry_if_new_external_id(payload)
    assert created is True
    return stored


def _candles():
    opens = pd.to_datetime(
        [
            "2026-08-01T00:00:00Z",
            "2026-08-01T00:15:00Z",
            "2026-08-01T00:30:00Z",
            "2026-08-01T00:45:00Z",
        ],
        utc=True,
    )
    return pd.DataFrame(
        {
            "open_time": (opens.astype("int64") // 1_000_000).astype("int64"),
            "close_time": ((opens + pd.Timedelta(minutes=15) - pd.Timedelta(milliseconds=1)).astype("int64") // 1_000_000).astype("int64"),
            "high": [150.0, 110.0, 108.0, 150.0],
            "low": [50.0, 98.0, 99.0, 50.0],
        }
    )


def test_excursions_use_only_candles_fully_inside_trade(monkeypatch, isolated_store):
    position = _add_position()
    monkeypatch.setattr("backend.modules.journal.analysis.load_journal_ohlcv", lambda *args, **kwargs: _candles())

    result = run_journal_excursions_service(1, 2_000_000_000_000)
    item = result["data"]["items"][0]

    assert item["journal_id"] == position["id"]
    assert item["mfe_pct"] == pytest.approx(10.0)
    assert item["mae_pct"] == pytest.approx(2.0)
    assert item["realized_move_pct"] == pytest.approx(3.0)
    assert item["capture_pct"] == pytest.approx(30.0)
    assert item["interval"] == "15m"
    assert item["candle_count"] == 2


def test_short_adverse_excursion_uses_directional_extremes(monkeypatch, isolated_store):
    _add_position(
        direction="Short",
        exit_price=104.0,
        external_id="position:short",
    )
    frame = _candles()
    frame.loc[:, "high"] = [150.0, 106.0, 105.0, 150.0]
    frame.loc[:, "low"] = [50.0, 99.0, 100.0, 50.0]
    monkeypatch.setattr("backend.modules.journal.analysis.load_journal_ohlcv", lambda *args, **kwargs: frame)

    item = run_journal_excursions_service(1, 2_000_000_000_000)["data"]["items"][0]

    assert item["mfe_pct"] == pytest.approx(1.0)
    assert item["mae_pct"] == pytest.approx(6.0)
    assert item["realized_move_pct"] == pytest.approx(-4.0)
    assert item["interval"] == "15m"


def test_trade_shorter_than_15_minutes_uses_completed_one_minute_candles(monkeypatch, isolated_store):
    position = _add_position(
        datetime="2026-08-01T00:12:00Z",
        entry_datetime="2026-08-01T00:02:00Z",
        external_id="position:short-duration",
    )
    opens = pd.date_range("2026-08-01T00:02:00Z", periods=10, freq="1min")
    frame = pd.DataFrame({
        "open_time": (opens.astype("int64") // 1_000_000).astype("int64"),
        "close_time": ((opens + pd.Timedelta(minutes=1) - pd.Timedelta(milliseconds=1)).astype("int64") // 1_000_000).astype("int64"),
        "high": [101.0, 102.0, 107.0, 104.0, 103.0, 102.0, 101.0, 100.0, 99.0, 98.0],
        "low": [99.0, 98.0, 97.0, 96.0, 97.0, 98.0, 99.0, 100.0, 99.0, 98.0],
    })

    def load(*args, **kwargs):
        assert args[1] == "1m"
        return frame

    monkeypatch.setattr("backend.modules.journal.analysis.load_journal_ohlcv", load)

    item = run_journal_excursions_service(1, 2_000_000_000_000)["data"]["items"][0]

    assert item["journal_id"] == position["id"]
    assert item["interval"] == "1m"
    assert item["mfe_pct"] == pytest.approx(7.0)
    assert item["mae_pct"] == pytest.approx(4.0)
    assert item["candle_count"] == 10


def test_sub_minute_trade_is_excluded_without_a_completed_candle(monkeypatch, isolated_store):
    position = _add_position(
        datetime="2026-08-01T00:02:50Z",
        entry_datetime="2026-08-01T00:02:10Z",
        external_id="position:sub-minute",
    )
    opened = pd.Timestamp("2026-08-01T00:02:00Z")
    frame = pd.DataFrame({
        "open_time": [int(opened.timestamp() * 1000)],
        "close_time": [int((opened + pd.Timedelta(minutes=1) - pd.Timedelta(milliseconds=1)).timestamp() * 1000)],
        "high": [110.0],
        "low": [90.0],
    })
    monkeypatch.setattr("backend.modules.journal.analysis.load_journal_ohlcv", lambda *args, **kwargs: frame)

    result = run_journal_excursions_service(1, 2_000_000_000_000)["data"]

    assert all(item["journal_id"] != position["id"] for item in result["items"])
    assert any("no completed 1m candle" in warning for warning in result["warnings"])


def test_unaligned_short_trade_falls_back_when_no_15_minute_candle_is_contained(monkeypatch, isolated_store):
    position = _add_position(
        datetime="2026-08-01T00:20:00Z",
        entry_datetime="2026-08-01T00:02:00Z",
        external_id="position:unaligned",
    )
    minute_opens = pd.date_range("2026-08-01T00:02:00Z", periods=18, freq="1min")
    minute_frame = pd.DataFrame({
        "open_time": (minute_opens.astype("int64") // 1_000_000).astype("int64"),
        "close_time": ((minute_opens + pd.Timedelta(minutes=1) - pd.Timedelta(milliseconds=1)).astype("int64") // 1_000_000).astype("int64"),
        "high": [104.0] * 18,
        "low": [97.0] * 18,
    })
    requested_intervals = []

    def load(*args, **kwargs):
        requested_intervals.append(args[1])
        return minute_frame if args[1] == "1m" else _candles()

    monkeypatch.setattr("backend.modules.journal.analysis.load_journal_ohlcv", load)

    item = run_journal_excursions_service(1, 2_000_000_000_000)["data"]["items"][0]

    assert item["journal_id"] == position["id"]
    assert item["interval"] == "1m"
    assert requested_intervals == ["15m", "1m"]


def test_excursions_filter_by_close_time(monkeypatch, isolated_store):
    _add_position()
    monkeypatch.setattr("backend.modules.journal.analysis.load_journal_ohlcv", lambda *args, **kwargs: _candles())

    result = run_journal_excursions_service(1, 2)

    assert result["data"]["items"] == []


def test_position_batches_preserve_history_beyond_single_request_limit():
    positions = [
        {
            "id": 1,
            "entry_datetime": "2026-01-01T00:00:00Z",
            "datetime": "2026-01-02T00:00:00Z",
        },
        {
            "id": 2,
            "entry_datetime": "2026-02-01T00:00:00Z",
            "datetime": "2026-02-02T00:00:00Z",
        },
        {
            "id": 3,
            "entry_datetime": "2026-06-01T00:00:00Z",
            "datetime": "2026-06-02T00:00:00Z",
        },
    ]

    batches = _position_batches(positions)

    assert [[item["id"] for item in batch] for batch in batches] == [[1, 2], [3]]


def test_excursions_exclude_position_when_history_does_not_reach_entry(monkeypatch, isolated_store):
    position = _add_position(
        entry_datetime="2026-07-01T00:02:00Z",
        external_id="position:truncated",
    )
    monkeypatch.setattr("backend.modules.journal.analysis.load_journal_ohlcv", lambda *args, **kwargs: _candles())

    result = run_journal_excursions_service(1, 2_000_000_000_000)["data"]

    assert all(item["journal_id"] != position["id"] for item in result["items"])
    assert any(f"journal {position['id']}: complete 15m path is unavailable" in warning for warning in result["warnings"])


def test_excursions_exclude_position_when_history_has_an_internal_gap(monkeypatch, isolated_store):
    position = _add_position(external_id="position:gap")
    frame = _candles().drop(index=1).reset_index(drop=True)
    monkeypatch.setattr("backend.modules.journal.analysis.load_journal_ohlcv", lambda *args, **kwargs: frame)

    result = run_journal_excursions_service(1, 2_000_000_000_000)["data"]

    assert all(item["journal_id"] != position["id"] for item in result["items"])
    assert any(f"journal {position['id']}: complete 15m path is unavailable" in warning for warning in result["warnings"])
