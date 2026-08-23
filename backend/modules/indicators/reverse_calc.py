import pandas as pd
import numpy as np
from typing import Any, Dict, Literal, Optional, Sequence

from core.indicator_primitives import compute_rsi_wilder, compute_vwap_anchored, compute_vwap_standard_deviation

def calculate_required_price_for_rsi(closes: pd.Series, target_rsi: float = 30.0, period: int = 14) -> Optional[float]:
    """
    목표 RSI 값에 도달하기 위해 필요한 다음 캔들의 종가(Close)를 역산합니다.
    Wilder's Smoothing (RMA) 방식을 사용합니다.
    """
    if len(closes) < period + 1:
        return None

    # 1. 기존 데이터로 Gain/Loss 계산
    delta = closes.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = -delta.where(delta < 0, 0.0)

    # 2. 현재 시점의 평균 Gain/Loss (Wilder's Smoothing)
    avg_gain = gain.ewm(alpha=1/period, min_periods=period, adjust=False).mean().iloc[-1]
    avg_loss = loss.ewm(alpha=1/period, min_periods=period, adjust=False).mean().iloc[-1]

    # 3. 목표 RS 계산
    if target_rsi >= 100:
        return float('inf')
    if target_rsi <= 0:
        return 0.0

    target_rs = target_rsi / (100.0 - target_rsi)

    # 4. 다음 캔들의 필요 Gain/Loss 역산
    # 공식: target_rs = (avg_gain * (period - 1) + next_gain) / (avg_loss * (period - 1) + next_loss)
    # next_gain과 next_loss는 둘 중 하나만 0보다 큼.

    current_close = closes.iloc[-1]

    # Case A: 가격이 올라서(next_gain > 0, next_loss = 0) 목표 RSI 도달
    required_gain = target_rs * (avg_loss * (period - 1)) - (avg_gain * (period - 1))
    if required_gain >= 0:
        return float(current_close + required_gain)

    # Case B: 가격이 떨어져서(next_gain = 0, next_loss > 0) 목표 RSI 도달
    required_loss = ((avg_gain * (period - 1)) / target_rs) - (avg_loss * (period - 1))
    if required_loss >= 0:
        return float(current_close - required_loss)

    return current_close

def get_indicator_projections(
    df: pd.DataFrame,
    vwap_anchors: Sequence[Literal["day", "week", "month"]] = ("day",),
) -> Dict[str, Any]:
    """
    데이터프레임을 받아 주요 지표들의 도달 예상 가격을 반환합니다.
    """
    if df.empty or len(df) < 20:
        return {"error": "Not enough data"}

    closes = df['close'] # type: ignore
    current_price = float(closes.iloc[-1])
    current_rsi_value = compute_rsi_wilder(closes, length=14).iloc[-1]
    current_rsi = None if pd.isna(current_rsi_value) else float(current_rsi_value)
    vwaps = [
        {"anchor": anchor, "value": compute_vwap_anchored(df, anchor=anchor)}
        for anchor in vwap_anchors
    ]
    vwap_deviations = [
        compute_vwap_standard_deviation(df, anchor=anchor, length=14)
        for anchor in ("day", "week", "month")
    ]

    projections = {
        "rsi_30": calculate_required_price_for_rsi(closes, target_rsi=30.0), # type: ignore
        "rsi_70": calculate_required_price_for_rsi(closes, target_rsi=70.0), # type: ignore
    }

    # Sanitize NaN values to None for valid JSON
    sanitized_projections = {
        k: (None if isinstance(v, float) and np.isnan(v) else v)
        for k, v in projections.items()
    }

    return {
        "current_price": current_price,
        "current_rsi": current_rsi,
        "vwaps": vwaps,
        # Keep the monthly field for older clients while exposing all supported anchors.
        "vwap_deviation": vwap_deviations[-1],
        "vwap_deviations": vwap_deviations,
        "projections": sanitized_projections
    }
