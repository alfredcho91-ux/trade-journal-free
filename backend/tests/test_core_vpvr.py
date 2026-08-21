import pytest
import pandas as pd

from core.vpvr import calculate_vpvr


def test_calculate_vpvr_allocates_quote_volume_and_marks_key_price_levels():
    candles = pd.DataFrame(
        {
            "low": [100.0, 110.0],
            "high": [110.0, 120.0],
            "close": [108.0, 118.0],
            "volume": [10.0, 20.0],
            "quote_volume": [1_000.0, 2_000.0],
            "taker_buy_quote_volume": [600.0, 1_300.0],
        }
    )

    profile = calculate_vpvr(candles, bin_count=4, value_area_pct=0.70)

    assert profile["bin_count"] == 4
    assert profile["total_quote_volume"] == pytest.approx(3_000.0)
    assert profile["vwap"] == pytest.approx(100.0)
    assert sum(row["volume"] for row in profile["bins"]) == pytest.approx(3_000.0)
    assert sum(row["buy_volume"] for row in profile["bins"]) == pytest.approx(1_900.0)
    assert sum(row["sell_volume"] for row in profile["bins"]) == pytest.approx(1_100.0)
    assert sum(row["volume_pct"] for row in profile["bins"]) == pytest.approx(100.0)
    assert sum(row["is_poc"] for row in profile["bins"]) == 1
    assert sum(row["is_current"] for row in profile["bins"]) == 1
    assert profile["value_area_low"] <= profile["poc_price_low"]
    assert profile["value_area_high"] >= profile["poc_price_high"]


def test_calculate_vpvr_handles_a_flat_price_range():
    candles = pd.DataFrame(
        {
            "low": [100.0],
            "high": [100.0],
            "close": [100.0],
            "volume": [5.0],
            "quote_volume": [500.0],
            "taker_buy_quote_volume": [300.0],
        }
    )

    profile = calculate_vpvr(candles)

    assert profile["bin_count"] == 1
    assert profile["bins"][0]["is_poc"] is True
    assert profile["bins"][0]["is_current"] is True
    assert profile["bins"][0]["delta"] == pytest.approx(100.0)


def test_calculate_vpvr_limits_the_profile_to_the_requested_price_range():
    candles = pd.DataFrame(
        {
            "low": [90.0],
            "high": [110.0],
            "close": [105.0],
            "volume": [2.0],
            "quote_volume": [200.0],
            "taker_buy_quote_volume": [100.0],
        }
    )

    profile = calculate_vpvr(candles, bin_count=4, price_range=10.0)

    assert profile["price_range"] == 10.0
    assert profile["price_low"] == 100.0
    assert profile["price_high"] == 110.0
    assert profile["total_quote_volume"] == pytest.approx(100.0)
    assert sum(row["buy_volume"] for row in profile["bins"]) == pytest.approx(50.0)


def test_calculate_vpvr_tightens_a_narrow_data_range_to_preserve_bin_resolution():
    candles = pd.DataFrame(
        {
            "low": [102.0],
            "high": [108.0],
            "close": [105.0],
            "volume": [0.6],
            "quote_volume": [60.0],
            "taker_buy_quote_volume": [30.0],
        }
    )

    profile = calculate_vpvr(candles, bin_count=4, price_range=10.0)

    assert profile["price_low"] == pytest.approx(101.88)
    assert profile["price_high"] == pytest.approx(108.12)
    assert profile["price_range"] == pytest.approx(6.24)
    assert profile["current_price"] == pytest.approx(105.0)
    assert profile["total_quote_volume"] == pytest.approx(60.0)


def test_calculate_vpvr_avoids_empty_bins_for_low_priced_assets():
    candles = pd.DataFrame(
        {
            "low": [1_200.0, 1_500.0],
            "high": [1_600.0, 2_000.0],
            "close": [1_550.0, 1_850.0],
            "volume": [10.0, 15.0],
            "quote_volume": [14_000.0, 26_000.0],
            "taker_buy_quote_volume": [7_000.0, 13_000.0],
        }
    )

    profile = calculate_vpvr(candles, bin_count=24, price_range=10_000.0)

    assert profile["price_low"] == pytest.approx(1_184.0)
    assert profile["price_high"] == pytest.approx(2_016.0)
    assert profile["price_range"] == pytest.approx(832.0)
    assert sum(row["volume"] > 0 for row in profile["bins"]) > 10
