"""Core indicator regression tests."""

import os
import numpy as np
import pandas as pd
import pytest

from core.indicators import (
    add_bb_indicators,
    build_indicator_adapter,
    compute_live_indicators,
    compute_rsi,
    compute_rsi_wilder,
    compute_slow_stochastic,
    compute_stoch_rsi,
    compute_trend_indicators,
    compute_trend_judgment_indicators,
    compute_vwap_standard_deviation,
    get_latest_indicator_values,
    prepare_strategy_data,
)

try:
    import talib
except Exception:  # pragma: no cover - optional dependency
    talib = None


def test_talib_is_available_when_ci_requires_it():
    if os.getenv("CI_REQUIRE_TALIB") == "1":
        assert talib is not None, "CI requires TA-Lib, but TA-Lib is not installed."


def _build_ohlcv(rows: int = 260) -> pd.DataFrame:
    idx = pd.date_range("2024-01-01 00:00:00", periods=rows, freq="h")
    base = np.linspace(100.0, 130.0, rows)
    seasonal = np.sin(np.linspace(0, 12, rows))
    close = base + seasonal
    open_ = close - 0.4
    high = close + 1.0
    low = close - 1.0
    volume = np.linspace(1000.0, 2000.0, rows)
    return pd.DataFrame(
        {
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "volume": volume,
        },
        index=idx,
    )


def test_prepare_strategy_data_short_input_keeps_original_shape():
    df = _build_ohlcv(rows=80)
    out = prepare_strategy_data(df)

    assert len(out) == len(df)
    assert "SMA_main" not in out.columns
    assert "Regime" not in out.columns


def test_prepare_strategy_data_exposes_bollinger_alias_columns():
    df = _build_ohlcv(rows=260)
    out = prepare_strategy_data(df)

    for col in ["BB_Mid", "BB_Up", "BB_Low", "BB_mid", "BB_upper", "BB_lower"]:
        assert col in out.columns

    mask_mid = out["BB_Mid"].notna() & out["BB_mid"].notna()
    mask_up = out["BB_Up"].notna() & out["BB_upper"].notna()
    mask_low = out["BB_Low"].notna() & out["BB_lower"].notna()
    assert mask_mid.any()
    assert mask_up.any()
    assert mask_low.any()
    assert np.allclose(out.loc[mask_mid, "BB_Mid"], out.loc[mask_mid, "BB_mid"])
    assert np.allclose(out.loc[mask_up, "BB_Up"], out.loc[mask_up, "BB_upper"])
    assert np.allclose(out.loc[mask_low, "BB_Low"], out.loc[mask_low, "BB_lower"])


def test_add_bb_indicators_exposes_bollinger_alias_columns():
    df = _build_ohlcv(rows=260)
    out = add_bb_indicators(df)

    for col in ["BB_Mid", "BB_Up", "BB_Low", "BB_mid", "BB_upper", "BB_lower"]:
        assert col in out.columns

    valid = out["BB_Mid"].notna() & out["BB_mid"].notna()
    assert valid.any()
    assert np.allclose(out.loc[valid, "BB_Mid"], out.loc[valid, "BB_mid"])


def test_compute_trend_indicators_contains_expected_columns():
    df = _build_ohlcv()
    out = compute_trend_indicators(df)

    expected_cols = [
        "sma20",
        "sma50",
        "sma100",
        "sma200",
        "rsi",
        "macd",
        "macd_signal",
        "macd_hist",
        "adx",
        "stoch_rsi_5k",
        "stoch_rsi_10k",
        "stoch_rsi_20k",
        "supertrend",
        "supertrend_dir",
    ]
    for col in expected_cols:
        assert col in out.columns

    assert out["supertrend_dir"].dropna().isin([1, -1]).all()


def test_get_latest_indicator_values_uses_previous_candle_by_default():
    df = compute_trend_indicators(_build_ohlcv())

    prev = get_latest_indicator_values(df, use_previous_candle=True)
    latest = get_latest_indicator_values(df, use_previous_candle=False)

    assert prev["timestamp"] == df.index[-2]
    assert latest["timestamp"] == df.index[-1]


def test_compute_rsi_matches_reference_rolling_formula():
    # compute_rsi now uses Wilder's smoothing internally, so we just verify
    # it matches the explicit compute_rsi_wilder function.
    df = _build_ohlcv(rows=300)
    close = df["close"]

    rsi = compute_rsi(close, length=14)
    rsi_wilder = compute_rsi_wilder(close, length=14)

    mask = rsi.notna() & rsi_wilder.notna()
    assert mask.any()
    assert np.allclose(rsi[mask], rsi_wilder[mask], rtol=1e-10, atol=1e-10)

def test_compute_live_indicators_macd_rsi_match_reference_implementation():
    df = _build_ohlcv()
    out = compute_live_indicators(df)

    close = df["close"]
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd_line = ema12 - ema26
    ref_macd_hist = macd_line - macd_line.ewm(span=9, adjust=False).mean()

    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    avg_loss = loss.ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    ref_rsi = 100 - (100 / (1 + (avg_gain / avg_loss.replace(0, np.nan))))
    ref_rsi = ref_rsi.where(avg_loss != 0, 100.0)
    ref_rsi = ref_rsi.where(avg_gain != 0, 0.0)

    macd_mask = out["macd_hist"].notna() & ref_macd_hist.notna()
    rsi_mask = out["rsi"].notna() & ref_rsi.notna()
    assert macd_mask.any()
    assert rsi_mask.any()

    assert np.allclose(out.loc[macd_mask, "macd_hist"], ref_macd_hist[macd_mask], rtol=1e-10, atol=1e-10)
    assert np.allclose(out.loc[rsi_mask, "rsi"], ref_rsi[rsi_mask], rtol=1e-10, atol=1e-10)


def test_compute_stoch_rsi_matches_reference_formula():
    steps = np.array([1.2, -0.8, 0.9, -0.6, 1.1, -0.7, 0.5, -0.4] * 50)
    close = pd.Series(100.0 + np.cumsum(steps))

    k_out, d_out = compute_stoch_rsi(close, rsi_period=14, stoch_k=3, stoch_d=3)

    rsi = compute_rsi(close, length=14)
    rsi_min = rsi.rolling(window=14, min_periods=14).min()
    rsi_max = rsi.rolling(window=14, min_periods=14).max()
    stoch = 100 * (rsi - rsi_min) / (rsi_max - rsi_min + 1e-10)
    k_ref = stoch.rolling(window=3, min_periods=3).mean()
    d_ref = k_ref.rolling(window=3, min_periods=3).mean()

    k_mask = k_out.notna() & k_ref.notna()
    d_mask = d_out.notna() & d_ref.notna()
    assert k_mask.any()
    assert d_mask.any()
    assert np.allclose(k_out[k_mask], k_ref[k_mask], rtol=1e-10, atol=1e-10)
    assert np.allclose(d_out[d_mask], d_ref[d_mask], rtol=1e-10, atol=1e-10)


def test_compute_stoch_rsi_supports_independent_stochastic_lookback():
    steps = np.array([1.2, -0.8, 0.9, -0.6, 1.1, -0.7, 0.5, -0.4] * 50)
    close = pd.Series(100.0 + np.cumsum(steps))

    k_out, d_out = compute_stoch_rsi(
        close,
        rsi_period=14,
        stoch_period=10,
        stoch_k=3,
        stoch_d=3,
    )

    rsi = compute_rsi(close, length=14)
    rsi_min = rsi.rolling(window=10, min_periods=10).min()
    rsi_max = rsi.rolling(window=10, min_periods=10).max()
    stoch = 100 * (rsi - rsi_min) / (rsi_max - rsi_min + 1e-10)
    k_ref = stoch.rolling(window=3, min_periods=3).mean()
    d_ref = k_ref.rolling(window=3, min_periods=3).mean()

    k_mask = k_out.notna() & k_ref.notna()
    d_mask = d_out.notna() & d_ref.notna()
    assert k_mask.any()
    assert d_mask.any()
    assert np.allclose(k_out[k_mask], k_ref[k_mask], rtol=1e-10, atol=1e-10)
    assert np.allclose(d_out[d_mask], d_ref[d_mask], rtol=1e-10, atol=1e-10)


def test_compute_slow_stochastic_matches_pine_formula():
    df = _build_ohlcv(rows=220)
    k_out, d_out = compute_slow_stochastic(df, length=20, smooth_k=12, smooth_d=12)

    highest_high = df["high"].rolling(window=20, min_periods=20).max()
    lowest_low = df["low"].rolling(window=20, min_periods=20).min()
    fast_k = 100.0 * (df["close"] - lowest_low) / (highest_high - lowest_low).replace(0, np.nan)
    k_ref = fast_k.rolling(window=12, min_periods=12).mean()
    d_ref = k_ref.rolling(window=12, min_periods=12).mean()

    k_mask = k_out.notna() & k_ref.notna()
    d_mask = d_out.notna() & d_ref.notna()
    assert k_mask.any()
    assert d_mask.any()
    assert np.allclose(k_out[k_mask], k_ref[k_mask], rtol=1e-10, atol=1e-10)
    assert np.allclose(d_out[d_mask], d_ref[d_mask], rtol=1e-10, atol=1e-10)


def test_compute_trend_judgment_indicators_exposes_slow_stochastic_fields():
    df = _build_ohlcv(rows=260)
    out = compute_trend_judgment_indicators(df)

    expected_cols = [
        "slow_stoch_20k",
        "slow_stoch_20d",
        "slow_stoch_10k",
        "slow_stoch_10d",
        "slow_stoch_5k",
        "slow_stoch_5d",
        "stoch_rsi_k",
        "stoch_rsi_d",
    ]
    for col in expected_cols:
        assert col in out.columns

    # Pine B2S2 파라미터 기준(20-12-12)과 일치해야 한다.
    k_ref, d_ref = compute_slow_stochastic(df, length=20, smooth_k=12, smooth_d=12)
    k_mask = out["slow_stoch_20k"].notna() & k_ref.notna()
    d_mask = out["slow_stoch_20d"].notna() & d_ref.notna()
    assert k_mask.any()
    assert d_mask.any()
    assert np.allclose(out.loc[k_mask, "slow_stoch_20k"], k_ref[k_mask], rtol=1e-10, atol=1e-10)
    assert np.allclose(out.loc[d_mask, "slow_stoch_20d"], d_ref[d_mask], rtol=1e-10, atol=1e-10)

    for legacy_col in ["stoch_rsi_20k", "stoch_rsi_10k", "stoch_rsi_5k"]:
        assert legacy_col not in out.columns


def test_prepare_strategy_data_matches_live_rsi_adx_atr_formula():
    df = _build_ohlcv(rows=300)
    prepared = prepare_strategy_data(df.copy(), atr_length=14)
    live = compute_live_indicators(df.copy())

    rsi_mask = prepared["RSI"].notna() & live["rsi"].notna()
    adx_mask = prepared["ADX"].notna() & live["adx"].notna()
    atr_mask = prepared["ATR"].notna() & live["atr"].notna()
    assert rsi_mask.any()
    assert adx_mask.any()
    assert atr_mask.any()

    assert np.allclose(prepared.loc[rsi_mask, "RSI"], live.loc[rsi_mask, "rsi"], rtol=1e-10, atol=1e-10)
    assert np.allclose(prepared.loc[adx_mask, "ADX"], live.loc[adx_mask, "adx"], rtol=1e-10, atol=1e-10)
    assert np.allclose(prepared.loc[atr_mask, "ATR"], live.loc[atr_mask, "atr"], rtol=1e-10, atol=1e-10)


def test_build_indicator_adapter_applies_mode_specific_schema():
    df = _build_ohlcv(rows=300)

    out_backtest = build_indicator_adapter(df, mode="backtest")
    out_trend = build_indicator_adapter(df, mode="trend_judgment")
    out_quant = build_indicator_adapter(df, mode="quant_lab")

    assert "Sig_RSI_Long" in out_backtest.columns
    assert "slow_stoch_5k" in out_trend.columns
    assert "stoch_rsi_5k" not in out_trend.columns
    assert "stoch_rsi_5k" in out_quant.columns


def test_build_indicator_adapter_raises_for_unknown_mode():
    df = _build_ohlcv(rows=200)
    with pytest.raises(ValueError):
        build_indicator_adapter(df, mode="unknown")  # type: ignore[arg-type]


def test_compute_vwap_standard_deviation_returns_monthly_bands_and_sigma():
    df = _build_ohlcv(rows=40)
    result = compute_vwap_standard_deviation(df, length=14)

    assert result is not None
    assert result["anchor"] == "month"
    assert result["length"] == 14
    assert result["source"] == "HLC3"
    assert result["bands"]["1"] > result["vwap"]
    assert result["bands"]["-1"] < result["vwap"]
    assert np.isfinite(result["sigma"])


def test_vwap_standard_deviation_excludes_prior_month_from_its_window():
    index = pd.to_datetime(["2024-01-31 20:00:00", "2024-01-31 21:00:00", "2024-02-01 00:00:00", "2024-02-01 04:00:00"])
    frame = pd.DataFrame({
        "high": [10_001, 20_001, 101, 103],
        "low": [9_999, 19_999, 99, 101],
        "close": [10_000, 20_000, 100, 102],
        "volume": [100, 100, 1, 1],
    }, index=index)

    result = compute_vwap_standard_deviation(frame, length=14)

    assert result is not None
    assert result["vwap"] == pytest.approx(101.0)
    assert result["standard_deviation"] == pytest.approx(1.0)
    assert result["bands"]["1"] == pytest.approx(102.0)


@pytest.mark.skipif(talib is None, reason="TA-Lib not installed in environment")
def test_compute_live_indicators_rsi_macd_are_close_to_talib():
    df = _build_ohlcv(rows=500)
    out = compute_live_indicators(df)
    close_np = df["close"].to_numpy(dtype=float)

    talib_rsi = talib.RSI(close_np, timeperiod=14)
    talib_macd, talib_signal, _ = talib.MACD(close_np, fastperiod=12, slowperiod=26, signalperiod=9)
    talib_hist = talib_macd - talib_signal

    out_rsi = out["rsi"].to_numpy(dtype=float)
    out_hist = out["macd_hist"].to_numpy(dtype=float)

    rsi_mask = np.isfinite(out_rsi) & np.isfinite(talib_rsi)
    hist_mask = np.isfinite(out_hist) & np.isfinite(talib_hist)
    assert rsi_mask.any()
    assert hist_mask.any()

    # 초기 구간 차이를 피하기 위해 후반부 200개 봉 기준 비교
    rsi_idx = np.flatnonzero(rsi_mask)[-200:]
    hist_idx = np.flatnonzero(hist_mask)[-200:]

    assert np.max(np.abs(out_rsi[rsi_idx] - talib_rsi[rsi_idx])) < 2.0
    assert np.max(np.abs(out_hist[hist_idx] - talib_hist[hist_idx])) < 1e-6
