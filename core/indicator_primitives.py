"""Low-level indicator primitives shared across core pipelines."""

from __future__ import annotations

from typing import List, Literal, Optional

import numpy as np
import pandas as pd


def set_bollinger_columns(
    df: pd.DataFrame,
    mid: pd.Series,
    upper: pd.Series,
    lower: pd.Series,
) -> pd.DataFrame:
    """
    볼린저 밴드 컬럼 명을 대문자/소문자 스키마로 동시 유지한다.
    - legacy: BB_Mid / BB_Up / BB_Low
    - newer:  BB_mid / BB_upper / BB_lower
    """
    df["BB_Mid"] = mid
    df["BB_Up"] = upper
    df["BB_Low"] = lower

    df["BB_mid"] = mid
    df["BB_upper"] = upper
    df["BB_lower"] = lower
    return df


def _true_range(df: pd.DataFrame) -> pd.Series:
    """표준 True Range 계산."""
    prev_close = df["close"].shift(1)
    return pd.concat(
        [
            df["high"] - df["low"],
            (df["high"] - prev_close).abs(),
            (df["low"] - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)


def compute_rsi_wilder(series: pd.Series, length: int = 14) -> pd.Series:
    """Wilder(RMA) 방식 RSI."""
    delta = series.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)

    avg_gain = gain.ewm(alpha=1 / length, adjust=False, min_periods=length).mean()
    avg_loss = loss.ewm(alpha=1 / length, adjust=False, min_periods=length).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    rsi = rsi.where(avg_loss != 0, 100.0)
    rsi = rsi.where(avg_gain != 0, 0.0)
    return rsi


def compute_rsi(series: pd.Series, length: int = 14) -> pd.Series:
    """
    RSI (Relative Strength Index) 계산 함수.
    내부적으로 Wilder's Smoothing(compute_rsi_wilder)을 사용하여
    전략/백테스트 엔진과 일관성을 유지합니다.
    """
    return compute_rsi_wilder(series, length)


def compute_atr_wilder(df: pd.DataFrame, length: int = 14) -> pd.Series:
    """Wilder(RMA) 방식 ATR."""
    tr = _true_range(df)
    return tr.ewm(alpha=1 / length, adjust=False, min_periods=length).mean()


def compute_adx_wilder(df: pd.DataFrame, length: int = 14) -> pd.Series:
    """Wilder(RMA) 방식 ADX."""
    up_move = df["high"].diff()
    down_move = -df["low"].diff()

    plus_dm = up_move.where((up_move > down_move) & (up_move > 0), 0.0)
    minus_dm = down_move.where((down_move > up_move) & (down_move > 0), 0.0)

    atr = compute_atr_wilder(df, length=length)
    plus_di = 100 * (
        plus_dm.ewm(alpha=1 / length, adjust=False, min_periods=length).mean()
        / atr.replace(0, np.nan)
    )
    minus_di = 100 * (
        minus_dm.ewm(alpha=1 / length, adjust=False, min_periods=length).mean()
        / atr.replace(0, np.nan)
    )
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    return dx.ewm(alpha=1 / length, adjust=False, min_periods=length).mean()


def calculate_adx(df: pd.DataFrame, length: int = 14) -> pd.Series:
    """
    ADX 계산 함수 (하위 호환용).

    내부 구현은 compute_adx_wilder()와 동일하게 유지해,
    전략/라이브 지표 간 계산식 불일치를 방지한다.
    """
    return compute_adx_wilder(df, length=length)


def calculate_smas(df: pd.DataFrame, pairs: List[List[int]]) -> pd.DataFrame:
    """
    필요한 SMA들을 계산하여 DataFrame에 추가

    Args:
        df: OHLCV DataFrame
        pairs: SMA 길이 쌍 리스트 (예: [[5, 20], [20, 60]])

    Returns:
        SMA 컬럼이 추가된 DataFrame
    """
    df = df.copy()
    all_lengths = sorted({x for pair in pairs for x in pair})
    for length in all_lengths:
        col = f"SMA{length}"
        if col not in df.columns:
            df[col] = df["close"].rolling(length, min_periods=length).mean()
    return df


def compute_stoch_rsi(
    series: pd.Series,
    rsi_period: int = 14,
    stoch_k: int = 3,
    stoch_d: int = 3,
    stoch_period: int | None = None,
) -> tuple[pd.Series, pd.Series]:
    """
    Stochastic RSI 계산 (RSI에 Stochastic 적용)
    Returns: (stoch_k, stoch_d)
    """
    lookback = stoch_period or rsi_period
    rsi = compute_rsi(series, length=rsi_period)
    rsi_min = rsi.rolling(window=lookback, min_periods=lookback).min()
    rsi_max = rsi.rolling(window=lookback, min_periods=lookback).max()
    stoch = 100 * (rsi - rsi_min) / (rsi_max - rsi_min + 1e-10)
    stoch_k_series = stoch.rolling(window=stoch_k, min_periods=stoch_k).mean()
    stoch_d_series = stoch_k_series.rolling(window=stoch_d, min_periods=stoch_d).mean()
    return stoch_k_series, stoch_d_series


def compute_slow_stochastic(
    df: pd.DataFrame,
    length: int = 14,
    smooth_k: int = 3,
    smooth_d: int = 3,
) -> tuple[pd.Series, pd.Series]:
    """
    가격 기반 Slow Stochastic 계산 (TradingView ta.highest/lowest + sma 스무딩과 동일 계열)
    Returns: (slow_k, slow_d)
    """
    highest_high = df["high"].rolling(window=length, min_periods=length).max()
    lowest_low = df["low"].rolling(window=length, min_periods=length).min()
    denominator = (highest_high - lowest_low).replace(0, np.nan)

    fast_k = 100.0 * (df["close"] - lowest_low) / denominator
    slow_k = fast_k.rolling(window=smooth_k, min_periods=smooth_k).mean()
    slow_d = slow_k.rolling(window=smooth_d, min_periods=smooth_d).mean()
    return slow_k, slow_d


def compute_vwap_rolling(df: pd.DataFrame, window: int = 20) -> pd.Series:
    """롤링 윈도우 VWAP: (H+L+C)/3 * volume의 이동 평균"""
    typical = (df["high"] + df["low"] + df["close"]) / 3
    if "volume" not in df.columns:
        return typical.rolling(window).mean()
    tp_vol = typical * df["volume"]
    return tp_vol.rolling(window).sum() / (df["volume"].rolling(window).sum() + 1e-10)


def compute_vwap_anchored(
    df: pd.DataFrame,
    anchor: Literal["day", "week", "month"],
    timestamp_column: str = "open_dt",
) -> Optional[float]:
    """Calculate HLC3 VWAP from the selected UTC calendar anchor to the latest bar."""
    if df.empty or not {"high", "low", "close", "volume"}.issubset(df.columns):
        return None

    timestamps = pd.to_datetime(
        df[timestamp_column] if timestamp_column in df.columns else df.index,
        errors="coerce",
        utc=True,
    )
    if len(timestamps) == 0 or pd.isna(timestamps.iloc[-1] if isinstance(timestamps, pd.Series) else timestamps[-1]):
        return None

    reference = timestamps.iloc[-1] if isinstance(timestamps, pd.Series) else timestamps[-1]
    if anchor == "day":
        start = reference.normalize()
    elif anchor == "week":
        start = reference.normalize() - pd.Timedelta(days=reference.weekday())
    elif anchor == "month":
        start = reference.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        raise ValueError(f"Unsupported VWAP anchor: {anchor}")
    period = df.loc[timestamps >= start]
    if period.empty:
        return None

    typical_price = (period["high"] + period["low"] + period["close"]) / 3
    volume = period["volume"].clip(lower=0.0)
    total_volume = float(volume.sum())
    if total_volume <= 0:
        return None
    return float((typical_price * volume).sum() / total_volume)


def compute_vwap_standard_deviation(
    df: pd.DataFrame,
    anchor: Literal["day", "week", "month"] = "month",
    length: int = 14,
    timestamp_column: str = "open_dt",
) -> Optional[dict[str, object]]:
    """Return anchored HLC3 VWAP, bands, and current sigma position."""
    if anchor not in {"day", "week", "month"} or length <= 0:
        raise ValueError("VWAP anchor must be day, week, or month and length must be positive")
    if df.empty or not {"high", "low", "close", "volume"}.issubset(df.columns):
        return None
    vwap = compute_vwap_anchored(df, anchor=anchor, timestamp_column=timestamp_column)
    if vwap is None:
        return None
    timestamps = pd.to_datetime(
        df[timestamp_column] if timestamp_column in df.columns else df.index,
        errors="coerce",
        utc=True,
    )
    reference = timestamps.iloc[-1] if isinstance(timestamps, pd.Series) else timestamps[-1]
    if anchor == "day":
        start = reference.normalize()
    elif anchor == "week":
        start = reference.normalize() - pd.Timedelta(days=reference.weekday())
    else:
        start = reference.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    period = df.loc[timestamps >= start]
    typical = (period["high"] + period["low"] + period["close"]) / 3.0
    sample = pd.DataFrame({"typical": typical, "volume": period["volume"]}).tail(length)
    sample = sample.replace([np.inf, -np.inf], np.nan).dropna()
    if sample.empty:
        return None
    weights = sample["volume"].clip(lower=0.0)
    weight_total = float(weights.sum())
    if weight_total <= 0:
        weights = pd.Series(1.0, index=sample.index)
        weight_total = float(len(sample))
    variance = float(((sample["typical"] - vwap) ** 2 * weights).sum() / weight_total)
    standard_deviation = float(np.sqrt(max(variance, 0.0)))
    current_price = float(df["close"].iloc[-1])
    sigma = None if standard_deviation <= 0 else (current_price - vwap) / standard_deviation
    if sigma is None:
        zone = "center"
    elif sigma >= 3:
        zone = "extreme_upper"
    elif sigma >= 2:
        zone = "strong_upper"
    elif sigma >= 1:
        zone = "upper_expansion"
    elif sigma <= -3:
        zone = "extreme_lower"
    elif sigma <= -2:
        zone = "strong_lower"
    elif sigma <= -1:
        zone = "lower_expansion"
    else:
        zone = "center"
    bands = {str(multiplier): vwap + standard_deviation * multiplier for multiplier in (-3, -2, -1, 1, 2, 3)}
    return {
        "anchor": anchor,
        "length": length,
        "sample_count": int(len(sample)),
        "source": "HLC3",
        "vwap": float(vwap),
        "standard_deviation": standard_deviation,
        "current_price": current_price,
        "sigma": None if sigma is None else float(sigma),
        "zone": zone,
        "bands": bands,
    }


def compute_supertrend(
    df: pd.DataFrame,
    period: int = 10,
    multiplier: float = 3.0,
) -> tuple[pd.Series, pd.Series]:
    """
    Supertrend (Wilder ATR 기반) - 표준 알고리즘
    Returns: (supertrend_line, direction: 1=uptrend, -1=downtrend)
    """
    h, l, c = df["high"].values, df["low"].values, df["close"].values
    n = len(df)
    tr = np.maximum(h - l, np.maximum(np.abs(h - np.roll(c, 1)), np.abs(l - np.roll(c, 1))))
    tr[0] = h[0] - l[0]
    atr = pd.Series(tr, index=df.index).ewm(alpha=1 / period, adjust=False).mean().values
    hl2 = (h + l) / 2
    basic_ub = hl2 + multiplier * atr
    basic_lb = hl2 - multiplier * atr
    final_ub = np.full(n, np.nan)
    final_lb = np.full(n, np.nan)
    st = np.full(n, np.nan)
    final_ub[period - 1] = basic_ub[period - 1]
    final_lb[period - 1] = basic_lb[period - 1]
    st[period - 1] = final_ub[period - 1]
    for i in range(period, n):
        if basic_ub[i] < final_ub[i - 1] or c[i - 1] > final_ub[i - 1]:
            final_ub[i] = basic_ub[i]
        else:
            final_ub[i] = final_ub[i - 1]
        if basic_lb[i] > final_lb[i - 1] or c[i - 1] < final_lb[i - 1]:
            final_lb[i] = basic_lb[i]
        else:
            final_lb[i] = final_lb[i - 1]
        prev_was_ub = not np.isnan(st[i - 1]) and abs(st[i - 1] - final_ub[i - 1]) < 1e-9
        if prev_was_ub:
            if c[i] <= final_ub[i]:
                st[i] = final_ub[i]
            else:
                st[i] = final_lb[i]
        else:
            if c[i] >= final_lb[i]:
                st[i] = final_lb[i]
            else:
                st[i] = final_ub[i]
    direction = np.where(c > st, 1, -1)
    return pd.Series(st, index=df.index), pd.Series(direction, index=df.index)


def get_latest_indicator_values(df: pd.DataFrame, use_previous_candle: bool = True) -> dict:
    """
    완성된 봉의 지표 값만 추출 (라이브 모드용)

    다른 전략에서도 재사용 가능한 공통 함수입니다.
    """
    if len(df) == 0:
        return {}

    candle_idx = -2 if use_previous_candle and len(df) >= 2 else -1
    latest = df.iloc[candle_idx]
    timestamp = df.index[candle_idx]

    return {
        "timestamp": timestamp,
        "close": float(latest["close"]) if not pd.isna(latest["close"]) else None,
        "sma20": float(latest["sma20"]) if "sma20" in latest and not pd.isna(latest["sma20"]) else None,
        "sma50": float(latest["sma50"]) if "sma50" in latest and not pd.isna(latest["sma50"]) else None,
        "sma100": float(latest["sma100"]) if "sma100" in latest and not pd.isna(latest["sma100"]) else None,
        "sma200": float(latest["sma200"]) if "sma200" in latest and not pd.isna(latest["sma200"]) else None,
        "macd_hist": float(latest["macd_hist"]) if "macd_hist" in latest and not pd.isna(latest["macd_hist"]) else None,
        "rsi": float(latest["rsi"]) if "rsi" in latest and not pd.isna(latest["rsi"]) else None,
        "adx": float(latest["adx"]) if "adx" in latest and not pd.isna(latest["adx"]) else None,
    }


__all__ = [
    "_true_range",
    "calculate_adx",
    "calculate_smas",
    "compute_adx_wilder",
    "compute_atr_wilder",
    "compute_rsi",
    "compute_rsi_wilder",
    "compute_slow_stochastic",
    "compute_stoch_rsi",
    "compute_supertrend",
    "compute_vwap_anchored",
    "compute_vwap_rolling",
    "get_latest_indicator_values",
    "set_bollinger_columns",
]
