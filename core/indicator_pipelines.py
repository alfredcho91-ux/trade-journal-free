"""Higher-level indicator pipelines used by strategies and analysis pages."""

from __future__ import annotations

from typing import Any, Dict, Literal, Optional

import numpy as np
import pandas as pd

from .indicator_primitives import (
    _true_range,
    compute_adx_wilder,
    compute_atr_wilder,
    compute_rsi_wilder,
    compute_slow_stochastic,
    compute_stoch_rsi,
    compute_supertrend,
    set_bollinger_columns,
)


def _apply_strategy_trend_columns(
    df: pd.DataFrame,
    *,
    sma_main_len: int,
    sma1_len: int,
    sma2_len: int,
    adx_threshold: int,
) -> None:
    df["SMA_main"] = df["close"].rolling(sma_main_len).mean()
    df["SMA_1"] = df["close"].rolling(sma1_len).mean()
    df["SMA_2"] = df["close"].rolling(sma2_len).mean()
    df["SMA_200"] = df["close"].rolling(200).mean()
    df["ADX"] = compute_adx_wilder(df, length=14)
    df["Regime"] = np.select(
        [
            df["ADX"] < adx_threshold,
            (df["ADX"] >= adx_threshold) & (df["close"] > df["SMA_main"]),
            (df["ADX"] >= adx_threshold) & (df["close"] <= df["SMA_main"]),
        ],
        ["Sideways", "Bull", "Bear"],
        default="Sideways",
    )


def _apply_strategy_momentum_columns(
    df: pd.DataFrame,
    *,
    macd_fast: int,
    macd_slow: int,
    macd_signal: int,
) -> None:
    df["RSI"] = compute_rsi_wilder(df["close"], length=14)
    ema_fast = df["close"].ewm(span=macd_fast, adjust=False).mean()
    ema_slow = df["close"].ewm(span=macd_slow, adjust=False).mean()
    df["MACD"] = ema_fast - ema_slow
    df["MACD_signal"] = df["MACD"].ewm(span=macd_signal, adjust=False).mean()
    df["MACD_hist"] = df["MACD"] - df["MACD_signal"]


def _apply_strategy_volatility_columns(
    df: pd.DataFrame,
    *,
    bb_length: int,
    bb_std_mult: float,
    atr_length: int,
    kc_mult: float,
) -> None:
    bb_mid = df["close"].rolling(bb_length).mean()
    bb_std = df["close"].rolling(bb_length).std()
    bb_up = bb_mid + bb_std_mult * bb_std
    bb_low = bb_mid - bb_std_mult * bb_std
    set_bollinger_columns(df, bb_mid, bb_up, bb_low)
    df["BB_Std"] = bb_std

    df["TR"] = _true_range(df)
    df["ATR"] = compute_atr_wilder(df, length=atr_length)
    df["KC_Up"] = bb_mid + kc_mult * df["ATR"]
    df["KC_Low"] = bb_mid - kc_mult * df["ATR"]
    df["Squeeze_On"] = (df["BB_Up"] < df["KC_Up"]) & (df["BB_Low"] > df["KC_Low"])


def _apply_strategy_breakout_columns(df: pd.DataFrame, *, donch_lookback: int) -> None:
    df["Donch_High"] = df["high"].rolling(donch_lookback).max().shift(1)
    df["Donch_Low"] = df["low"].rolling(donch_lookback).min().shift(1)


def _apply_strategy_volume_columns(
    df: pd.DataFrame,
    *,
    vol_ma_length: int,
    vol_spike_k: float,
) -> None:
    df["Vol_MA"] = df["volume"].rolling(vol_ma_length).mean()
    df["Vol_Spike"] = df["volume"] > (vol_spike_k * df["Vol_MA"])


def _apply_strategy_signal_columns(
    df: pd.DataFrame,
    *,
    rsi_ob_level: int,
    rsi_os_level: int,
) -> None:
    df["Open_Prev"] = df["open"].shift(1)
    df["Close_Prev"] = df["close"].shift(1)

    df["Sig_Connors_Long"] = (df["close"] > df["SMA_main"]) & (df["RSI"] < rsi_os_level)
    df["Sig_Connors_Short"] = (df["close"] < df["SMA_main"]) & (df["RSI"] > rsi_ob_level)

    df["Sig_Sqz_Long"] = (
        (df["Squeeze_On"].shift(1) == True)
        & (df["Squeeze_On"] == False)
        & (df["close"] > df["BB_Mid"])
    )
    df["Sig_Sqz_Short"] = (
        (df["Squeeze_On"].shift(1) == True)
        & (df["Squeeze_On"] == False)
        & (df["close"] < df["BB_Mid"])
    )

    df["Sig_Turtle_Long"] = (df["close"] > df["Donch_High"]) & (df["close"] > df["SMA_main"])
    df["Sig_Turtle_Short"] = (df["close"] < df["Donch_Low"]) & (df["close"] < df["SMA_main"])

    df["Sig_MR_Long"] = (
        (df["close"] > df["SMA_main"])
        & (df["close"] < df["BB_Low"])
        & (df["RSI"] < rsi_os_level)
    )
    df["Sig_MR_Short"] = (
        (df["close"] < df["SMA_main"])
        & (df["close"] > df["BB_Up"])
        & (df["RSI"] > rsi_ob_level)
    )

    df["Sig_RSI_Long"] = df["RSI"] < rsi_os_level
    df["Sig_RSI_Short"] = df["RSI"] > rsi_ob_level

    df["Sig_MA_Long"] = (df["SMA_1"] > df["SMA_2"]) & (df["SMA_1"].shift(1) <= df["SMA_2"].shift(1))
    df["Sig_MA_Short"] = (df["SMA_1"] < df["SMA_2"]) & (df["SMA_1"].shift(1) >= df["SMA_2"].shift(1))

    df["Sig_BB_Long"] = (df["close"] > df["BB_Up"]) & (df["close"].shift(1) <= df["BB_Up"].shift(1))
    df["Sig_BB_Short"] = (df["close"] < df["BB_Low"]) & (df["close"].shift(1) >= df["BB_Low"].shift(1))

    engulf_bull = (df["open"] <= df["Close_Prev"]) & (df["close"] >= df["Open_Prev"])
    engulf_bear = (df["open"] >= df["Close_Prev"]) & (df["close"] <= df["Open_Prev"])
    df["Sig_Engulf_Long"] = (
        (df["Close_Prev"] < df["Open_Prev"])
        & (df["close"] > df["open"])
        & engulf_bull
    )
    df["Sig_Engulf_Short"] = (
        (df["Close_Prev"] > df["Open_Prev"])
        & (df["close"] < df["open"])
        & engulf_bear
    )


def _set_strategy_attrs(
    df: pd.DataFrame,
    *,
    rsi_ob_level: int,
    sma_main_len: int,
    sma1_len: int,
    sma2_len: int,
    bb_length: int,
    bb_std_mult: float,
    atr_length: int,
    kc_mult: float,
    vol_ma_length: int,
    vol_spike_k: float,
    macd_fast: int,
    macd_slow: int,
    macd_signal: int,
) -> None:
    df.attrs["RSI_OB"] = rsi_ob_level
    df.attrs["RSI_OS"] = 100 - rsi_ob_level
    df.attrs["SMA_MAIN_LEN"] = sma_main_len
    df.attrs["SMA1_LEN"] = sma1_len
    df.attrs["SMA2_LEN"] = sma2_len
    df.attrs["BB_LEN"] = bb_length
    df.attrs["BB_STD"] = bb_std_mult
    df.attrs["ATR_LEN"] = atr_length
    df.attrs["KC_MULT"] = kc_mult
    df.attrs["VOL_MA_LEN"] = vol_ma_length
    df.attrs["VOL_SPIKE_K"] = vol_spike_k
    df.attrs["MACD_FAST"] = macd_fast
    df.attrs["MACD_SLOW"] = macd_slow
    df.attrs["MACD_SIGNAL"] = macd_signal


def prepare_strategy_data(
    df: pd.DataFrame,
    rsi_ob_level: int = 70,
    sma_main_len: int = 200,
    sma1_len: int = 20,
    sma2_len: int = 60,
    adx_threshold: int = 25,
    donch_lookback: int = 20,
    bb_length: int = 20,
    bb_std_mult: float = 2.0,
    atr_length: int = 20,
    kc_mult: float = 1.5,
    vol_ma_length: int = 20,
    vol_spike_k: float = 2.0,
    macd_fast: int = 12,
    macd_slow: int = 26,
    macd_signal: int = 9,
) -> pd.DataFrame:
    """
    전략용 데이터 준비 함수.
    app.py에 있던 prepare_strategy_data를 그대로 옮겨온 것입니다.
    """
    if len(df) < 100:
        return df

    df = df.copy()
    rsi_os_level = 100 - rsi_ob_level

    _apply_strategy_trend_columns(
        df,
        sma_main_len=sma_main_len,
        sma1_len=sma1_len,
        sma2_len=sma2_len,
        adx_threshold=adx_threshold,
    )
    _apply_strategy_momentum_columns(
        df,
        macd_fast=macd_fast,
        macd_slow=macd_slow,
        macd_signal=macd_signal,
    )
    _apply_strategy_volatility_columns(
        df,
        bb_length=bb_length,
        bb_std_mult=bb_std_mult,
        atr_length=atr_length,
        kc_mult=kc_mult,
    )
    _apply_strategy_breakout_columns(df, donch_lookback=donch_lookback)
    _apply_strategy_volume_columns(
        df,
        vol_ma_length=vol_ma_length,
        vol_spike_k=vol_spike_k,
    )
    _apply_strategy_signal_columns(
        df,
        rsi_ob_level=rsi_ob_level,
        rsi_os_level=rsi_os_level,
    )
    _set_strategy_attrs(
        df,
        rsi_ob_level=rsi_ob_level,
        sma_main_len=sma_main_len,
        sma1_len=sma1_len,
        sma2_len=sma2_len,
        bb_length=bb_length,
        bb_std_mult=bb_std_mult,
        atr_length=atr_length,
        kc_mult=kc_mult,
        vol_ma_length=vol_ma_length,
        vol_spike_k=vol_spike_k,
        macd_fast=macd_fast,
        macd_slow=macd_slow,
        macd_signal=macd_signal,
    )
    return df


def add_bb_indicators(
    df: pd.DataFrame,
    bb_length: int = 20,
    bb_std_mult: float = 2.0,
    rsi_length: int = 14,
    sma200_length: int = 200,
) -> pd.DataFrame:
    """
    BB, RSI, SMA200 인디케이터를 계산하여 DataFrame에 추가
    """
    df = df.copy()
    close = df["close"]
    mid = close.rolling(window=bb_length, min_periods=bb_length).mean()
    std = close.rolling(window=bb_length, min_periods=bb_length).std()
    upper = mid + bb_std_mult * std
    lower = mid - bb_std_mult * std
    set_bollinger_columns(df, mid, upper, lower)
    df["RSI"] = compute_rsi_wilder(close, length=rsi_length)
    df["SMA200"] = close.rolling(window=sma200_length, min_periods=sma200_length).mean()

    low, high = df["low"], df["high"]
    df["touch_lower"] = low <= df["BB_lower"]
    df["touch_mid"] = (low <= df["BB_mid"]) & (high >= df["BB_mid"])
    df["touch_upper"] = high >= df["BB_upper"]
    return df


def compute_live_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """
    실시간 지표 계산 (고정밀 지표 계산)
    """
    d = df.copy()
    d["sma20"] = d["close"].rolling(20).mean()
    d["sma50"] = d["close"].rolling(50).mean()
    d["sma100"] = d["close"].rolling(100).mean()
    d["sma200"] = d["close"].rolling(200).mean()

    ema12 = d["close"].ewm(span=12, adjust=False).mean()
    ema26 = d["close"].ewm(span=26, adjust=False).mean()
    macd_line = ema12 - ema26
    macd_signal = macd_line.ewm(span=9, adjust=False).mean()
    d["macd"] = macd_line
    d["macd_signal"] = macd_signal
    d["macd_hist"] = macd_line - macd_signal

    d["rsi"] = compute_rsi_wilder(d["close"], length=14)
    d["adx"] = compute_adx_wilder(d, length=14)
    d["atr"] = compute_atr_wilder(d, length=14)
    d["atr_pct"] = (d["atr"] / d["close"].replace(0, np.nan)) * 100.0
    return d


def compute_trend_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """
    Quant Lab 등 공용 분석용 지표 계산 (레거시 함수명 유지)
    - 3 Stoch RSI (5-3-3, 10-6-6, 20-12-12)
    - RSI(14), MACD, ADX (compute_live_indicators)
    - Supertrend(10, 3)
    """
    d = compute_live_indicators(df.copy())
    close = d["close"]
    sk1, sd1 = compute_stoch_rsi(close, 5, 3, 3)
    sk2, sd2 = compute_stoch_rsi(close, 10, 6, 6)
    sk3, sd3 = compute_stoch_rsi(close, 20, 12, 12)
    d["stoch_rsi_5k"], d["stoch_rsi_5d"] = sk1, sd1
    d["stoch_rsi_10k"], d["stoch_rsi_10d"] = sk2, sd2
    d["stoch_rsi_20k"], d["stoch_rsi_20d"] = sk3, sd3
    st, dr = compute_supertrend(d, 10, 3.0)
    d["supertrend"] = st
    d["supertrend_dir"] = dr
    return d


def compute_quant_lab_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """
    Quant Lab 호출부 명확화를 위한 명시적 별칭 함수.
    내부 계산은 compute_trend_indicators(Stoch RSI 기반)와 동일하다.
    """
    return compute_trend_indicators(df)


def compute_trend_judgment_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """
    추세판단 페이지 전용 지표 계산
    - 3 Slow Stochastic (20-12-12, 10-6-6, 5-3-3)
    - RSI(14), MACD, ADX (compute_live_indicators)
    - Supertrend(10, 3)
    """
    d = compute_live_indicators(df.copy())

    k20, d20 = compute_slow_stochastic(d, length=20, smooth_k=12, smooth_d=12)
    k10, d10 = compute_slow_stochastic(d, length=10, smooth_k=6, smooth_d=6)
    k5, d5 = compute_slow_stochastic(d, length=5, smooth_k=3, smooth_d=3)

    d["slow_stoch_20k"], d["slow_stoch_20d"] = k20, d20
    d["slow_stoch_10k"], d["slow_stoch_10d"] = k10, d10
    d["slow_stoch_5k"], d["slow_stoch_5d"] = k5, d5

    stoch_rsi_k, stoch_rsi_d = compute_stoch_rsi(
        d["close"],
        rsi_period=14,
        stoch_period=14,
        stoch_k=3,
        stoch_d=3,
    )
    d["stoch_rsi_k"], d["stoch_rsi_d"] = stoch_rsi_k, stoch_rsi_d

    st, dr = compute_supertrend(d, 10, 3.0)
    d["supertrend"] = st
    d["supertrend_dir"] = dr
    return d


def build_indicator_adapter(
    df: pd.DataFrame,
    mode: Literal["backtest", "trend_judgment", "quant_lab"] = "backtest",
    prepare_kwargs: Optional[Dict[str, Any]] = None,
) -> pd.DataFrame:
    """
    백테스트/추세판단/AI 분석에서 공통으로 사용하는 지표 어댑터.
    """
    base = prepare_strategy_data(df.copy(), **(prepare_kwargs or {}))

    if mode == "backtest":
        return base
    if mode == "trend_judgment":
        return compute_trend_judgment_indicators(base)
    if mode == "quant_lab":
        return compute_trend_indicators(base)
    raise ValueError(f"Unsupported indicator adapter mode: {mode}")


__all__ = [
    "add_bb_indicators",
    "build_indicator_adapter",
    "compute_live_indicators",
    "compute_quant_lab_indicators",
    "compute_trend_indicators",
    "compute_trend_judgment_indicators",
    "prepare_strategy_data",
]
