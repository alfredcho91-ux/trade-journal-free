"""Derived results must be rebuilt from current inputs; raw cache may persist."""

import importlib
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from backend.modules.journal import exit_hold_analysis as hold, quality_analysis as quality
from backend.utils.cache import DataCache
from backend.tests.test_historical_contracts import history_db, START, END
from backend.tests.test_rule_engine_service import _journal
from backend.modules.journal import repository as journal


@pytest.fixture
def market(monkeypatch, tmp_path):
    start = 1767261600000  # 2026-01-01T10:00Z
    opens = start + np.arange(25) * 3600000
    frame = pd.DataFrame({"open_time": opens, "close_time": opens + 3599999,
                          "open": 100., "high": 102., "low": 98., "close": 100., "volume": 100.})
    state = {"frame": frame, "calls": 0}

    def load(*args, **kwargs):
        state["calls"] += 1
        return state["frame"].copy()

    monkeypatch.setattr(hold, "load_journal_ohlcv", load)
    return state


def test_market_input_refresh_is_not_masked_by_derived_cache(history_db, market):
    _journal(history_db)
    first = hold.run_journal_exit_hold_analysis_service(START, END, "1h")
    market["frame"].loc[3:, ["open", "high", "low", "close"]] += 20
    second = hold.run_journal_exit_hold_analysis_service(START, END, "1h")
    assert market["calls"] == 2
    assert first["data"]["direction_breakdown"] != second["data"]["direction_breakdown"]


@pytest.mark.parametrize("mutation", ["behavior", "resync", "delete"])
def test_journal_mutations_read_current_inputs(history_db, market, mutation):
    row = _journal(history_db)
    first = hold.run_journal_exit_hold_analysis_service(START, END, "1h")
    if mutation == "behavior":
        journal.update_entry_behavior(row["id"], {"planned_stop_pct": 3, "notes": "edited"}, db_path=history_db)
    elif mutation == "resync":
        journal.update_imported_entry_by_external_id({**row, "exit_price": 120., "realized_pnl": 20.}, db_path=history_db)
    else:
        journal.delete_entry(row["id"], db_path=history_db)
    second = hold.run_journal_exit_hold_analysis_service(START, END, "1h")
    if mutation == "delete":
        assert second["data"]["items"] == []
    elif mutation == "resync":
        assert first["data"]["direction_breakdown"] != second["data"]["direction_breakdown"]
    else:
        # Notes/legacy Plan are not hold inputs; unchanged output is correct.
        assert first == second


def test_raw_cache_survives_new_instance(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_CACHE_BACKEND", "disk")
    path = str(tmp_path / "raw")
    first = DataCache(cache_dir=path)
    first.set("ohlcv", {"close": [100, 101]})
    assert first.stats()["persistent"]
    first._cache.close()
    second = DataCache(cache_dir=path)
    assert second.get("ohlcv") == {"close": [100, 101]}
    second.clear()
    assert second.get("ohlcv") is None
    second._cache.close()


def test_rebuilding_derived_results_reuses_actual_ohlcv_cache(history_db, monkeypatch, tmp_path):
    from backend.utils import data_service
    from backend.modules.journal import market_data
    monkeypatch.setenv("DATA_CACHE_BACKEND", "disk")
    monkeypatch.setattr(data_service, "_CACHE_BASE_DIR", tmp_path / "raw")
    calls = []

    def request(_url, *, params, timeout):
        calls.append(params)
        end = params["endTime"]
        rows = [[end - (params["limit"] - i) * 3600000, "100", "101", "99", "100", "10",
                 end - (params["limit"] - i - 1) * 3600000 - 1, "1000", 2, "5", "500", "0"]
                for i in range(params["limit"])]
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: rows)

    monkeypatch.setattr(data_service.requests, "get", request)
    raw_fetch = data_service.cached(30)(data_service.fetch_binance_klines.__wrapped__)
    monkeypatch.setattr(market_data, "fetch_binance_klines", raw_fetch)
    monkeypatch.setattr(hold, "load_journal_ohlcv", market_data.load_journal_ohlcv)
    _journal(history_db)
    first = hold.run_journal_exit_hold_analysis_service(START, END, "1h")
    second = hold.run_journal_exit_hold_analysis_service(START, END, "1h")
    assert first == second
    assert first is not second
    assert len(calls) == 1


@pytest.mark.parametrize("mutation", ["market", "resync", "behavior", "delete"])
def test_quality_rebuilds_after_authoritative_input_changes(history_db, monkeypatch, mutation):
    row = _journal(history_db)
    source = {"move": 1.}
    monkeypatch.setattr(quality, "load_market_frames", lambda *args: {})
    monkeypatch.setattr(quality, "run_journal_excursions_service", lambda *args: {"data": {"items": []}})

    def item(entry, *args):
        return {"journal_id": entry["id"], "direction": entry["direction"], "exit_datetime": entry["datetime"],
                "realized_pnl": entry.get("realized_pnl"), "r_multiple": entry.get("r_multiple"),
                "market_regime": {"id": "unavailable", "alignment": "unknown", "trade_bias": "neutral"},
                "excursion": {"mfe_pct": source["move"]}, "exit_quality": None}

    monkeypatch.setattr(quality, "_build_item", item)
    first = quality.run_journal_quality_analysis_service(START, END)
    if mutation == "market":
        source["move"] = 3.
    elif mutation == "resync":
        journal.update_imported_entries_by_external_id([{**row, "realized_pnl": -40.}], db_path=history_db)
    elif mutation == "behavior":
        journal.update_entry_behavior(row["id"], {"planned_stop_pct": 4}, db_path=history_db)
    else:
        journal.delete_entry(row["id"], db_path=history_db)
    second = quality.run_journal_quality_analysis_service(START, END)
    assert first is not second
    if mutation == "behavior":  # Legacy notes are not quality-analysis inputs.
        assert first == second
    else:
        assert first != second


def test_current_context_is_memory_only_even_when_disk_is_enabled(tmp_path, monkeypatch):
    from backend.modules.journal import current_market
    monkeypatch.setenv("DATA_CACHE_BACKEND", "disk")
    cache = DataCache(cache_dir=str(tmp_path / "forbidden"), persistent=False)
    cache.set("context", {"derived": True})
    assert cache.get("context") == {"derived": True}
    assert not cache.stats()["persistent"]
    assert not (tmp_path / "forbidden").exists()
    assert DataCache(cache_dir=str(tmp_path / "forbidden"), persistent=False).get("context") is None
    assert not current_market.CURRENT_MARKET_CACHE._persistent


@pytest.mark.parametrize("module_name", ["quality_analysis", "exit_hold_analysis", "stop_loss_analysis", "stop_optimization", "sl_tp_analysis"])
def test_restart_never_opens_legacy_derived_cache(module_name, monkeypatch, tmp_path):
    from backend.config import settings
    from backend.utils import cache
    monkeypatch.setattr(settings, "PROJECT_ROOT", tmp_path)
    monkeypatch.setenv("DATA_CACHE_BACKEND", "disk")
    # Real legacy disk artifacts may remain, but cannot be reused as results.
    legacy = DataCache(cache_dir=str(tmp_path / ".cache" / ("journal_" + module_name)))
    legacy.set("old-derived-result", {"stale": True})
    legacy._cache.close()
    monkeypatch.setattr(cache, "DataCache", lambda *args, **kwargs: pytest.fail("derived module opened a cache"))
    module = importlib.reload(importlib.import_module("backend.modules.journal." + module_name))
    assert not any(isinstance(value, DataCache) for value in vars(module).values())
