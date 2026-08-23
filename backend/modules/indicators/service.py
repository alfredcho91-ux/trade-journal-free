"""Indicator-domain service functions."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from core.indicator_pipelines import compute_trend_judgment_indicators
from core.vpvr import calculate_vpvr
from backend.modules.indicators.reverse_calc import get_indicator_projections
from backend.modules.journal.market_data import load_journal_ohlcv, market_source
from backend.utils.data_service import BINANCE_TFS, fetch_binance_klines
from backend.utils.error_handler import DataLoadError
from backend.utils.response_builder import success_response
from backend.utils.validators import validate_coin_symbol


def safe_float(value: Any) -> Optional[float]:
    """Convert numeric values while normalizing NaN and infinity."""
    if value is None:
        return None
    try:
        converted = float(value)
    except (TypeError, ValueError):
        return None
    return converted if np.isfinite(converted) else None

VPVR_DEFAULT_CANDLES = {
    "1h": 10 * 24,
    "2h": 20 * 12,
    "4h": 40 * 6,
    "1d": 180,
}

PROJECTION_VWAP_ANCHORS = {
    "1h": ("day", "week"),
    "2h": ("day", "week"),
    "4h": ("week", "month"),
    "1d": ("month",),
}


# Include a possible leap year plus the currently forming daily candle.
PROJECTION_MIN_CANDLES = {
    "1d": 367,
}

TRADE_REPORT_WARMUP_CANDLES = 250
TRADE_REPORT_SERIES_COLUMNS = (
    "volume",
    "rsi",
    "macd",
    "macd_signal",
    "macd_hist",
    "stoch_rsi_k",
    "stoch_rsi_d",
    "slow_stoch_5k",
    "slow_stoch_5d",
    "slow_stoch_10k",
    "slow_stoch_10d",
    "slow_stoch_20k",
    "slow_stoch_20d",
)

VPVR_REQUIRED_COLUMNS = [
    "open_time",
    "open_dt",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "close_time",
    "quote_volume",
    "trade_count",
    "taker_buy_base_volume",
    "taker_buy_quote_volume",
]


def run_indicator_projection_service(coin: str, interval: str) -> Dict[str, Any]:
    """Load recent Binance klines and calculate RSI price projections."""
    normalized_input = coin.upper().strip().replace("/", "")
    base_coin = normalized_input[:-4] if normalized_input.endswith("USDT") else normalized_input
    normalized_coin = validate_coin_symbol(base_coin)
    if interval not in BINANCE_TFS:
        raise ValueError(f"Unsupported Binance interval: {interval}")

    required_candles = max(
        (
            PROJECTION_MIN_CANDLES.get(interval, 101),
        )
    )
    df = fetch_binance_klines(f"{normalized_coin}USDT", interval, total_candles=required_candles)
    if df is None or len(df) < 2:
        raise DataLoadError("Binance OHLCV data is temporarily unavailable")

    vwap_anchors = PROJECTION_VWAP_ANCHORS.get(interval, ("day",))
    result = get_indicator_projections(
        df.iloc[:-1].copy(),
        vwap_anchors=vwap_anchors,
    )
    if "error" in result:
        raise ValueError(str(result["error"]))
    return result


def _to_utc_iso(value: Any) -> str:
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize("UTC")
    else:
        timestamp = timestamp.tz_convert("UTC")
    return timestamp.isoformat().replace("+00:00", "Z")


def _load_vpvr_candles(
    coin: str,
    interval: str,
    candles: Optional[int],
) -> tuple[str, int, pd.DataFrame]:
    normalized_coin = validate_coin_symbol(coin)
    if interval not in BINANCE_TFS:
        raise ValueError(f"Unsupported Binance interval: {interval}")

    effective_candles = candles or VPVR_DEFAULT_CANDLES.get(interval, 300)
    raw_df = fetch_binance_klines(
        f"{normalized_coin}USDT",
        interval,
        total_candles=effective_candles + 1,
    )
    if raw_df is None or len(raw_df) < 2:
        raise DataLoadError("Binance OHLCV data is temporarily unavailable")

    df = raw_df.iloc[:-1].copy()

    missing_columns = [column for column in VPVR_REQUIRED_COLUMNS if column not in df.columns]
    if missing_columns:
        raise ValueError(f"Binance candle data is missing columns: {', '.join(missing_columns)}")

    return normalized_coin, effective_candles, df


def run_vpvr_source_service(
    coin: str,
    interval: str,
    candles: Optional[int] = None,
) -> Dict[str, Any]:
    """Load normalized Binance OHLCV candles for VPVR data inspection."""
    normalized_coin, effective_candles, df = _load_vpvr_candles(coin, interval, candles)

    source_candles = [
        {
            "open_time": int(row.open_time),
            "open_time_iso": _to_utc_iso(row.open_dt),
            "open": float(row.open),
            "high": float(row.high),
            "low": float(row.low),
            "close": float(row.close),
            "volume": float(row.volume),
            "close_time": int(row.close_time),
            "quote_volume": float(row.quote_volume),
            "trade_count": int(row.trade_count),
            "taker_buy_base_volume": float(row.taker_buy_base_volume),
            "taker_buy_quote_volume": float(row.taker_buy_quote_volume),
        }
        for row in df[VPVR_REQUIRED_COLUMNS].itertuples(index=False)
    ]

    return success_response(
        data={
            "source": "binance",
            "symbol": f"{normalized_coin}/USDT",
            "interval": interval,
            "requested_candles": effective_candles,
            "count": len(source_candles),
            "candles": source_candles,
        }
    )


def run_vpvr_service(
    coin: str,
    interval: str,
    candles: Optional[int] = None,
    bin_count: int = 24,
    price_range: float = 10_000,
) -> Dict[str, Any]:
    """Calculate a Binance-based volume profile for the selected timeframe."""
    normalized_coin, effective_candles, df = _load_vpvr_candles(coin, interval, candles)
    profile = calculate_vpvr(df, bin_count=bin_count, price_range=price_range)

    return success_response(
        data={
            "source": "binance",
            "symbol": f"{normalized_coin}/USDT",
            "interval": interval,
            "requested_candles": effective_candles,
            "candle_count": len(df),
            "allocation_method": "candle_range_proportional",
            **profile,
        }
    )


def _trade_report_series(frame: pd.DataFrame) -> Dict[str, Dict[str, List[Any]]]:
    series: Dict[str, Dict[str, List[Any]]] = {}
    for column in TRADE_REPORT_SERIES_COLUMNS:
        if column not in frame.columns:
            continue
        values = pd.to_numeric(frame[column], errors="coerce").replace([np.inf, -np.inf], np.nan)
        valid = values.dropna()
        timestamps = frame.loc[valid.index, "open_dt"].map(_to_utc_iso)
        series[column] = {
            "t": timestamps.tolist(),
            "v": [float(value) for value in valid.tolist()],
        }
    return series


def _trade_report_latest(frame: pd.DataFrame) -> Optional[Dict[str, Optional[float]]]:
    if frame.empty:
        return None
    row = frame.iloc[-1]
    return {
        column: safe_float(row.get(column))
        for column in TRADE_REPORT_SERIES_COLUMNS
        if column != "volume"
    }


def _trade_report_candles(frame: pd.DataFrame) -> List[Dict[str, Any]]:
    columns = [
        "open_dt",
        "open_time",
        "open",
        "high",
        "low",
        "close",
        "volume",
    ]
    serialized = frame.loc[:, columns].copy()
    serialized["open_dt"] = serialized["open_dt"].astype(str)
    return serialized.to_dict(orient="records")


def run_trade_report_service(
    coin: str,
    interval: str,
    limit: int = 300,
    end_time: Optional[int] = None,
    as_of: Optional[int] = None,
    profile_candles: int = 300,
    bin_count: int = 24,
    exchange: Optional[str] = None,
    instrument_type: str = "SWAP",
) -> Dict[str, Any]:
    """Build one historical chart report without using post-trade data in references."""
    normalized_coin = validate_coin_symbol(coin)
    if interval not in BINANCE_TFS:
        raise ValueError(f"Unsupported Binance interval: {interval}")

    raw = load_journal_ohlcv(
        f"{normalized_coin}/USDT",
        interval,
        total_candles=limit + TRADE_REPORT_WARMUP_CANDLES,
        end_time=end_time,
        exchange=exchange,
        instrument_type=instrument_type,
    )
    if raw is None or raw.empty:
        raise DataLoadError("Trade-exchange OHLCV data is temporarily unavailable")

    now_ms = int(pd.Timestamp.now(tz="UTC").timestamp() * 1000)
    completed = raw.loc[pd.to_numeric(raw["close_time"], errors="coerce") < now_ms].copy()
    if completed.empty:
        raise DataLoadError("No completed exchange candles were available")

    indicators = compute_trend_judgment_indicators(completed)
    chart_frame = indicators.tail(limit).copy()

    reference_frame = indicators.iloc[0:0].copy()
    if as_of is not None:
        reference_frame = indicators.loc[
            pd.to_numeric(indicators["close_time"], errors="coerce") < as_of
        ].copy()

    profile_payload = None
    projection_payload = None
    profile_as_of = None
    if not reference_frame.empty:
        profile_frame = reference_frame.tail(profile_candles)
        profile = calculate_vpvr(profile_frame, bin_count=bin_count, price_range=None)
        profile_payload = {
            "source": market_source(raw),
            "symbol": f"{normalized_coin}/USDT",
            "interval": interval,
            "requested_candles": profile_candles,
            "candle_count": len(profile_frame),
            "allocation_method": "candle_range_proportional",
            **profile,
        }
        if len(reference_frame) >= 20:
            projection_payload = get_indicator_projections(
                reference_frame,
                vwap_anchors=PROJECTION_VWAP_ANCHORS.get(interval, ("day", "week")),
            )
            if "error" in projection_payload:
                projection_payload = None
        profile_as_of = (
            pd.to_datetime(int(reference_frame.iloc[-1]["close_time"]), unit="ms", utc=True)
            .isoformat()
            .replace("+00:00", "Z")
        )

    return success_response(
        data={
            "source": market_source(raw),
            "symbol": f"{normalized_coin}/USDT",
            "interval": interval,
            "count": len(chart_frame),
            "profile_as_of": profile_as_of,
            "candles": _trade_report_candles(chart_frame),
            "series": _trade_report_series(chart_frame),
            "latest": _trade_report_latest(reference_frame),
            "vpvr": profile_payload,
            "vwaps": projection_payload,
        }
    )
