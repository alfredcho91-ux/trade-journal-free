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
        ["2026-08-01T00:00:00Z", "2026-08-01T00:15:00Z", "2026-08-01T00:30:00Z"],
        utc=True,
    )
    return pd.DataFrame(
        {
            "open_time": (opens.astype("int64") // 1_000_000).astype("int64"),
            "close_time": ((opens + pd.Timedelta(minutes=15) - pd.Timedelta(milliseconds=1)).astype("int64") // 1_000_000).astype("int64"),
            "high": [150.0, 110.0, 108.0],
            "low": [50.0, 98.0, 99.0],
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
    assert item["classification"] == "good_entry_poor_exit"
    assert item["candle_count"] == 2


def test_short_adverse_excursion_is_classified_as_poor_entry(monkeypatch, isolated_store):
    _add_position(
        direction="Short",
        exit_price=104.0,
        external_id="position:short",
    )
    frame = _candles()
    frame.loc[:, "high"] = [150.0, 106.0, 105.0]
    frame.loc[:, "low"] = [50.0, 99.0, 100.0]
    monkeypatch.setattr("backend.modules.journal.analysis.load_journal_ohlcv", lambda *args, **kwargs: frame)

    item = run_journal_excursions_service(1, 2_000_000_000_000)["data"]["items"][0]

    assert item["mfe_pct"] == pytest.approx(1.0)
    assert item["mae_pct"] == pytest.approx(6.0)
    assert item["realized_move_pct"] == pytest.approx(-4.0)
    assert item["classification"] == "poor_entry"


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
