"""Read-only Deepcoin fills import and point-in-time indicator snapshots."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlencode

import requests

from backend.config.settings import (
    DeepcoinCredentials,
    get_deepcoin_api_base_url,
    get_deepcoin_credentials,
)
from backend.modules.journal.repository import (
    add_entries_if_new_external_ids,
    existing_external_ids,
    list_entries,
    update_indicator_snapshots_by_external_id,
    update_imported_entries_by_external_id,
)
from backend.modules.deepcoin.snapshot import (
    SNAPSHOT_BIN_COUNT,
    SNAPSHOT_INTERVALS,
    SNAPSHOT_VPVR_CANDLES,
    build_indicator_snapshots as _build_indicator_snapshots,
    indicator_snapshot_for_event as _indicator_snapshot_for_fill,
    snapshot_candle_count as _snapshot_candle_count,
)
from backend.utils.error_handler import BusinessLogicError, DataLoadError

DEEPCOIN_FILLS_PATH = "/deepcoin/trade/fills"
DEEPCOIN_POSITIONS_PATH = "/deepcoin/account/positions"
DEEPCOIN_POSITIONS_HISTORY_PATH = "/deepcoin/account/positions-history"
DEEPCOIN_TRIGGER_ORDERS_HISTORY_PATH = "/deepcoin/trade/trigger-orders-history"
DEEPCOIN_FILL_PAGE_SIZE = 100
DEEPCOIN_FILL_HISTORY_WINDOW_DAYS = 7
DEEPCOIN_FILL_HISTORY_MIN_WINDOW_MINUTES = 5
DEEPCOIN_FILL_HISTORY_MAX_REQUESTS = 140
DEEPCOIN_POSITION_HISTORY_PAGE_SIZE = 100
DEEPCOIN_POSITION_HISTORY_WINDOW_DAYS = 7
DEEPCOIN_POSITION_HISTORY_MIN_WINDOW_MINUTES = 5
DEEPCOIN_POSITION_HISTORY_MAX_REQUESTS = 240
@dataclass(frozen=True)
class _PreparedFill:
    raw: Dict[str, Any]
    external_id: str
    timestamp_ms: int
    coin: str
    event_type: str = "fill"


class DeepcoinClient:
    """Minimal Deepcoin private REST client used only for account-history reads."""

    def __init__(self, credentials: DeepcoinCredentials, base_url: Optional[str] = None):
        self._credentials = credentials
        self._base_url = (base_url or get_deepcoin_api_base_url()).rstrip("/")
        self.truncated = False
        self.positions_truncated = False

    def build_headers(
        self,
        method: str,
        request_path: str,
        *,
        body: str = "",
        timestamp: Optional[str] = None,
    ) -> Dict[str, str]:
        """Build Deepcoin HMAC headers without persisting the secret anywhere."""
        access_timestamp = timestamp or _utc_now_iso()
        prehash = f"{access_timestamp}{method.upper()}{request_path}{body}"
        digest = hmac.new(
            self._credentials.secret_key.encode("utf-8"),
            prehash.encode("utf-8"),
            hashlib.sha256,
        ).digest()
        signature = base64.b64encode(digest).decode("ascii")
        return {
            "DC-ACCESS-KEY": self._credentials.api_key,
            "DC-ACCESS-SIGN": signature,
            "DC-ACCESS-TIMESTAMP": access_timestamp,
            "DC-ACCESS-PASSPHRASE": self._credentials.passphrase,
            "Content-Type": "application/json",
        }

    def _get_fill_page(self, params: Dict[str, str]) -> List[Dict[str, Any]]:
        query = urlencode(params)
        request_path = f"{DEEPCOIN_FILLS_PATH}?{query}"
        try:
            response = requests.get(
                f"{self._base_url}{DEEPCOIN_FILLS_PATH}",
                params=params,
                headers=self.build_headers("GET", request_path),
                timeout=15,
            )
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            raise DataLoadError("Deepcoin trade history is temporarily unavailable") from exc

        if not isinstance(payload, dict):
            raise DataLoadError("Deepcoin returned an invalid trade-history response")
        code = payload.get("code")
        if code not in (None, 0, "0"):
            raise DataLoadError("Deepcoin trade history is temporarily unavailable")
        data = payload.get("data", [])
        if not isinstance(data, list):
            raise DataLoadError("Deepcoin returned an invalid trade-history response")
        return [item for item in data if isinstance(item, dict)]

    def _get_positions_history_page(self, params: Dict[str, str]) -> List[Dict[str, Any]]:
        query = urlencode(params)
        request_path = f"{DEEPCOIN_POSITIONS_HISTORY_PATH}?{query}"
        try:
            response = requests.get(
                f"{self._base_url}{DEEPCOIN_POSITIONS_HISTORY_PATH}",
                params=params,
                headers=self.build_headers("GET", request_path),
                timeout=15,
            )
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            raise DataLoadError("Deepcoin position history is temporarily unavailable") from exc

        if not isinstance(payload, dict):
            raise DataLoadError("Deepcoin returned an invalid position-history response")
        code = payload.get("code")
        if code not in (None, 0, "0"):
            raise DataLoadError("Deepcoin position history is temporarily unavailable")
        data = payload.get("data", [])
        if not isinstance(data, list):
            raise DataLoadError("Deepcoin returned an invalid position-history response")
        return [item for item in data if isinstance(item, dict)]

    def get_open_positions(self) -> List[Dict[str, Any]]:
        """Read the account's current non-zero SWAP positions."""
        params = {"instType": "SWAP"}
        query = urlencode(params)
        request_path = f"{DEEPCOIN_POSITIONS_PATH}?{query}"
        try:
            response = requests.get(
                f"{self._base_url}{DEEPCOIN_POSITIONS_PATH}",
                params=params,
                headers=self.build_headers("GET", request_path),
                timeout=15,
            )
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            raise DataLoadError("Deepcoin open positions are temporarily unavailable") from exc

        if not isinstance(payload, dict) or payload.get("code") not in (None, 0, "0"):
            raise DataLoadError("Deepcoin open positions are temporarily unavailable")
        data = payload.get("data", [])
        if not isinstance(data, list):
            raise DataLoadError("Deepcoin returned an invalid open-position response")
        return [
            item for item in data
            if isinstance(item, dict) and (_to_float(item.get("pos")) or 0) > 0
        ]

    def _get_trigger_orders_history_page(self, params: Dict[str, str]) -> List[Dict[str, Any]]:
        query = urlencode(params)
        request_path = f"{DEEPCOIN_TRIGGER_ORDERS_HISTORY_PATH}?{query}"
        try:
            response = requests.get(
                f"{self._base_url}{DEEPCOIN_TRIGGER_ORDERS_HISTORY_PATH}",
                params=params,
                headers=self.build_headers("GET", request_path),
                timeout=15,
            )
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            raise DataLoadError("Deepcoin trigger-order history is temporarily unavailable") from exc

        if not isinstance(payload, dict):
            raise DataLoadError("Deepcoin returned an invalid trigger-order response")
        code = payload.get("code")
        if code not in (None, 0, "0"):
            raise DataLoadError("Deepcoin trigger-order history is temporarily unavailable")
        data = payload.get("data", [])
        if not isinstance(data, list):
            raise DataLoadError("Deepcoin returned an invalid trigger-order response")
        return [item for item in data if isinstance(item, dict)]

    def get_fills(self, *, inst_type: str, lookback_days: int) -> List[Dict[str, Any]]:
        """Read fills by adaptively splitting time windows that hit the API limit."""
        now = datetime.now(timezone.utc)
        range_start = now - timedelta(days=lookback_days)
        base_windows: List[Tuple[datetime, datetime]] = []
        window_end = now

        while window_end > range_start:
            window_start = max(
                range_start,
                window_end - timedelta(days=DEEPCOIN_FILL_HISTORY_WINDOW_DAYS),
            )
            base_windows.append((window_start, window_end))
            window_end = window_start

        pending = list(base_windows)
        fills: List[Dict[str, Any]] = []
        seen_ids = set()
        request_count = 0
        minimum_window = timedelta(minutes=DEEPCOIN_FILL_HISTORY_MIN_WINDOW_MINUTES)

        while pending:
            window_start, window_end = pending.pop(0)
            if request_count >= DEEPCOIN_FILL_HISTORY_MAX_REQUESTS:
                self.truncated = True
                break

            page = self._get_fill_page(
                {
                    "instType": inst_type,
                    "begin": str(int(window_start.timestamp() * 1000)),
                    "end": str(int(window_end.timestamp() * 1000)),
                    "limit": str(DEEPCOIN_FILL_PAGE_SIZE),
                }
            )
            request_count += 1

            if len(page) >= DEEPCOIN_FILL_PAGE_SIZE:
                span = window_end - window_start
                if span > minimum_window:
                    midpoint = window_start + span / 2
                    right_start = midpoint + timedelta(milliseconds=1)
                    if right_start < window_end:
                        pending.insert(0, (right_start, window_end))
                    if window_start < midpoint:
                        pending.insert(0, (window_start, midpoint))
                    time.sleep(0.22)
                    continue
                self.truncated = True

            for fill in page:
                fill_id = str(fill.get("billId") or _external_id(fill))
                if fill_id not in seen_ids:
                    fills.append(fill)
                    seen_ids.add(fill_id)

            if pending:
                time.sleep(0.22)
        return fills

    def get_positions_history(self, *, lookback_days: int) -> List[Dict[str, Any]]:
        """Read closed SWAP positions without silently losing saturated windows.

        Deepcoin caps the position-history response at 100 rows and does not expose
        a cursor.  A fixed seven-day window can therefore hide older closes whenever
        that window contains 100+ records.  Start with seven-day windows, then split
        any saturated window in half until it is small enough to return completely.
        """
        now = datetime.now(timezone.utc)
        range_start = now - timedelta(days=lookback_days)
        base_windows: List[Tuple[datetime, datetime]] = []
        window_end = now

        while window_end > range_start:
            window_start = max(
                range_start,
                window_end - timedelta(days=DEEPCOIN_POSITION_HISTORY_WINDOW_DAYS),
            )
            base_windows.append((window_start, window_end))
            window_end = window_start

        # Process newest windows first.  Saturated windows are recursively bisected.
        pending = list(base_windows)
        positions: List[Dict[str, Any]] = []
        seen_ids = set()
        request_count = 0
        minimum_window = timedelta(minutes=DEEPCOIN_POSITION_HISTORY_MIN_WINDOW_MINUTES)

        while pending:
            window_start, window_end = pending.pop(0)
            if request_count >= DEEPCOIN_POSITION_HISTORY_MAX_REQUESTS:
                self.positions_truncated = True
                break

            page = self._get_positions_history_page(
                {
                    "instType": "SWAP",
                    "startTime": str(int(window_start.timestamp() * 1000)),
                    "endTime": str(int(window_end.timestamp() * 1000)),
                    "limit": str(DEEPCOIN_POSITION_HISTORY_PAGE_SIZE),
                }
            )
            request_count += 1

            if len(page) >= DEEPCOIN_POSITION_HISTORY_PAGE_SIZE:
                span = window_end - window_start
                if span > minimum_window:
                    midpoint = window_start + span / 2
                    # Avoid querying the exact same boundary millisecond twice.
                    right_start = midpoint + timedelta(milliseconds=1)
                    if right_start < window_end:
                        pending.insert(0, (right_start, window_end))
                    if window_start < midpoint:
                        pending.insert(0, (window_start, midpoint))
                    time.sleep(0.12)
                    continue

                # Even the minimum-sized range is saturated.  Keep what we received
                # and expose a warning instead of pretending the history is complete.
                self.positions_truncated = True

            for position in page:
                position_id = str(position.get("posId") or _position_external_id(position))
                if position_id not in seen_ids:
                    positions.append(position)
                    seen_ids.add(position_id)

            if pending:
                time.sleep(0.12)

        return positions

    def get_trigger_orders_history(self, *, inst_id: str) -> List[Dict[str, Any]]:
        """Read the latest completed trigger orders for one SWAP instrument."""
        return self._get_trigger_orders_history_page(
            {
                "instType": "SWAP",
                "instId": inst_id,
                "limit": "100",
            }
        )


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _timestamp_to_iso(timestamp_ms: int) -> str:
    return datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _iso_to_timestamp_ms(value: Any) -> Optional[int]:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp() * 1000)


def _to_float(value: Any) -> Optional[float]:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _to_json_number(value: Any) -> Optional[float]:
    result = _to_float(value)
    return None if result is None else result


def _timestamp_ms(value: Any) -> Optional[int]:
    result = _to_float(value)
    if result is None or result <= 0:
        return None
    if result < 10_000_000_000:
        result *= 1000
    return int(result)


def _base_coin(inst_id: Any) -> Optional[str]:
    value = str(inst_id or "").upper().strip()
    if not value:
        return None
    parts = value.replace("_", "-").replace("/", "-").split("-")
    if len(parts) >= 2 and parts[1] in {"USDT", "USDC"}:
        return parts[0]
    for quote in ("USDT", "USDC"):
        if value.endswith(quote):
            return value[: -len(quote)]
    return None


def _external_id(fill: Dict[str, Any]) -> str:
    stable_id = fill.get("billId") or fill.get("tradeId")
    if stable_id:
        return f"deepcoin:{stable_id}"
    fallback_fields = {
        key: fill.get(key)
        for key in ("ordId", "instId", "ts", "side", "posSide", "fillPx", "fillSz")
    }
    digest = hashlib.sha256(
        json.dumps(fallback_fields, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return f"deepcoin:fill:{digest}"


def _position_external_id(position: Dict[str, Any]) -> str:
    position_id = position.get("posId")
    if position_id:
        return f"deepcoin:position:{position_id}"
    fallback_fields = {
        key: position.get(key)
        for key in ("instId", "posSide", "cTime", "uTime", "avgPx", "closeAvgPx", "closePos")
    }
    digest = hashlib.sha256(
        json.dumps(fallback_fields, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return f"deepcoin:position:{digest}"


def _prepare_fills(raw_fills: Iterable[Dict[str, Any]]) -> Tuple[List[_PreparedFill], int]:
    prepared: List[_PreparedFill] = []
    ignored = 0
    for fill in raw_fills:
        timestamp_ms = _timestamp_ms(fill.get("ts"))
        coin = _base_coin(fill.get("instId"))
        if timestamp_ms is None or coin is None:
            ignored += 1
            continue
        prepared.append(
            _PreparedFill(
                raw=fill,
                external_id=_external_id(fill),
                timestamp_ms=timestamp_ms,
                coin=coin,
            )
        )
    prepared.sort(key=lambda item: item.timestamp_ms)
    return prepared, ignored


def _prepare_closed_positions(raw_positions: Iterable[Dict[str, Any]]) -> Tuple[List[_PreparedFill], int]:
    prepared: List[_PreparedFill] = []
    ignored = 0
    for position in raw_positions:
        timestamp_ms = _timestamp_ms(position.get("uTime")) or _timestamp_ms(position.get("cTime"))
        coin = _base_coin(position.get("instId"))
        if timestamp_ms is None or coin is None:
            ignored += 1
            continue
        prepared.append(
            _PreparedFill(
                raw=position,
                external_id=_position_external_id(position),
                timestamp_ms=timestamp_ms,
                coin=coin,
                event_type="position_close",
            )
        )
    prepared.sort(key=lambda item: item.timestamp_ms)
    return prepared, ignored


def _direction(fill: Dict[str, Any]) -> str:
    position_side = str(fill.get("posSide") or "").lower()
    if position_side == "long":
        return "Long"
    if position_side == "short":
        return "Short"
    return "Long" if str(fill.get("side") or "").lower() == "buy" else "Short"


def _journal_row(fill: _PreparedFill, snapshot: Dict[str, Any], inst_type: str) -> Dict[str, Any]:
    raw = fill.raw
    side = str(raw.get("side") or "").lower()
    execution_type = str(raw.get("execType") or "").lower()
    fee = _to_float(raw.get("fee"))
    order_id = raw.get("ordId")
    notes = f"Deepcoin {inst_type} fill: {side or '-'} / {execution_type or '-'}"
    if order_id:
        notes += f" / order {order_id}"
    return {
        "datetime": _timestamp_to_iso(fill.timestamp_ms),
        "symbol": f"{fill.coin}/USDT",
        "timeframe": "4h",
        "direction": _direction(raw),
        "size": _to_float(raw.get("fillSz")),
        "entry_price": _to_float(raw.get("fillPx")),
        "tags": f"deepcoin,{inst_type.lower()}",
        "notes": notes,
        "source": "deepcoin",
        "external_id": fill.external_id,
        "exchange": "Deepcoin",
        "order_id": str(order_id) if order_id is not None else None,
        "fee": fee,
        "fee_currency": str(raw.get("feeCcy")) if raw.get("feeCcy") else None,
        "indicator_snapshot": snapshot,
        "created_at": _utc_now_iso(),
    }


def _net_position_pnl(position: Dict[str, Any]) -> Optional[float]:
    gross_pnl = _to_float(position.get("pnl"))
    if gross_pnl is None:
        return None
    trading_fee = abs(_to_float(position.get("fee")) or 0.0)
    funding_fee = _to_float(position.get("fundingFee")) or 0.0
    return gross_pnl - trading_fee + funding_fee


def _outcome_from_realized_pnl(realized_pnl: Optional[float]) -> Optional[str]:
    if realized_pnl is None:
        return None
    if realized_pnl > 0:
        return "Win"
    if realized_pnl < 0:
        return "Loss"
    return "Breakeven"


def _price_pnl_pct(entry_price: Optional[float], exit_price: Optional[float], direction: str) -> Optional[float]:
    """Return the underlying price move for a completed position (not leveraged ROE)."""
    if entry_price is None or exit_price is None or entry_price <= 0:
        return None
    move = (exit_price - entry_price) / entry_price * 100.0
    return move if direction == "Long" else -move


def _position_invested_amount(position: Dict[str, Any]) -> Optional[float]:
    """Infer initial margin from exchange PnL, price move, and recorded leverage."""
    leverage = _to_float(position.get("lever"))
    entry_price = _to_float(position.get("avgPx"))
    exit_price = _to_float(position.get("closeAvgPx"))
    gross_pnl = _to_float(position.get("pnl"))
    if leverage is None or leverage <= 0 or gross_pnl is None:
        return None

    price_return_pct = _price_pnl_pct(entry_price, exit_price, _direction(position))
    if price_return_pct is None or abs(price_return_pct) <= 1e-12 or abs(gross_pnl) <= 1e-12:
        return None

    position_notional = abs(gross_pnl / (price_return_pct / 100.0))
    invested_amount = position_notional / leverage
    return invested_amount if invested_amount > 0 else None


def _closed_position_journal_row(
    position: _PreparedFill,
    snapshot: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    raw = position.raw
    position_id = raw.get("posId")
    entry_timestamp_ms = _timestamp_ms(raw.get("cTime"))
    if entry_timestamp_ms is not None and entry_timestamp_ms > position.timestamp_ms:
        entry_timestamp_ms = None
    direction = _direction(raw)
    entry_price = _to_float(raw.get("avgPx"))
    exit_price = _to_float(raw.get("closeAvgPx"))
    gross_pnl = _to_float(raw.get("pnl"))
    trading_fee = _to_float(raw.get("fee"))
    funding_fee = _to_float(raw.get("fundingFee"))
    realized_pnl = _net_position_pnl(raw)
    leverage = _to_float(raw.get("lever"))
    invested_amount = _position_invested_amount(raw)
    pnl_pct = _price_pnl_pct(entry_price, exit_price, direction)
    notes = "Deepcoin SWAP closed position"
    if position_id:
        notes += f" / position {position_id}"
    if gross_pnl is not None:
        notes += f" / reported PnL {gross_pnl:.8g}"
    if trading_fee is not None:
        notes += f" / trading fee {trading_fee:.8g}"
    if funding_fee is not None:
        notes += f" / funding fee {funding_fee:.8g}"
    if realized_pnl is not None:
        notes += f" / net realized PnL {realized_pnl:.8g}"
    return {
        "datetime": _timestamp_to_iso(position.timestamp_ms),
        "entry_datetime": _timestamp_to_iso(entry_timestamp_ms) if entry_timestamp_ms is not None else None,
        "symbol": f"{position.coin}/USDT",
        "timeframe": "4h",
        "direction": direction,
        "size": _to_float(raw.get("closePos")) or _to_float(raw.get("pos")),
        "entry_price": entry_price,
        "exit_price": exit_price,
        "pnl_pct": pnl_pct,
        "outcome": _outcome_from_realized_pnl(realized_pnl),
        "tags": "deepcoin,swap,closed-position",
        "notes": notes,
        "source": "deepcoin_position",
        "external_id": position.external_id,
        "exchange": "Deepcoin",
        "order_id": str(position_id) if position_id is not None else None,
        "fee": trading_fee,
        "fee_currency": str(raw.get("ccy")) if raw.get("ccy") else None,
        "funding_fee": funding_fee,
        "realized_pnl": realized_pnl,
        "leverage": leverage,
        "invested_amount": invested_amount,
        "pnl_calculation_version": 2,
        "indicator_snapshot": snapshot,
        "created_at": _utc_now_iso(),
    }


def _snapshot_event_for_position(position: _PreparedFill) -> _PreparedFill:
    """Use the known opening time for entry analysis, never the close timestamp."""
    if position.event_type != "position_close":
        return position
    entry_timestamp_ms = _timestamp_ms(position.raw.get("cTime"))
    if entry_timestamp_ms is None or entry_timestamp_ms > position.timestamp_ms:
        return position
    return _PreparedFill(
        raw=position.raw,
        external_id=position.external_id,
        timestamp_ms=entry_timestamp_ms,
        coin=position.coin,
        event_type="position_entry",
    )


def _snapshot_needs_refresh(snapshot: Any) -> bool:
    """Return whether a saved snapshot predates the complete multi-timeframe format."""
    if not isinstance(snapshot, dict) or snapshot.get("version") != 3:
        return True
    timeframes = snapshot.get("timeframes")
    if not isinstance(timeframes, dict):
        return True
    return any(
        not isinstance(timeframes.get(interval), dict)
        or timeframes[interval].get("status") != "complete"
        for interval in ("1h", "2h", "4h", "1d")
    )


def _stale_closed_position_snapshot_events(lookback_days: int) -> List[_PreparedFill]:
    """Return stale closed positions that can be rebuilt from their entry time.

    The exchange history endpoint can omit old closed positions. A missing
    entry time is never replaced by exit time because that would introduce
    look-ahead bias into the entry analysis.
    """
    cutoff_ms = int((datetime.now(timezone.utc) - timedelta(days=lookback_days)).timestamp() * 1000)
    events: List[_PreparedFill] = []
    for entry in list_entries():
        if entry.get("source") != "deepcoin_position" or not _snapshot_needs_refresh(entry.get("indicator_snapshot")):
            continue
        entry_time = _iso_to_timestamp_ms(entry.get("entry_datetime"))
        external_id = str(entry.get("external_id") or "").strip()
        coin = _base_coin(entry.get("symbol"))
        if entry_time is None or entry_time < cutoff_ms or not external_id or coin is None:
            continue
        events.append(
            _PreparedFill(
                raw={},
                external_id=external_id,
                timestamp_ms=entry_time,
                coin=coin,
                event_type="position_entry",
            )
        )
    return events


def get_deepcoin_status_service() -> Dict[str, Any]:
    return {
        "success": True,
        "data": {
            "configured": get_deepcoin_credentials() is not None,
            "mode": "read_only",
        },
    }


def get_deepcoin_open_positions_service() -> Dict[str, Any]:
    """Return normalized live positions without persisting account state."""
    credentials = get_deepcoin_credentials()
    if credentials is None:
        raise BusinessLogicError(
            "Deepcoin API credentials are not configured",
            error_code="DEEPCOIN_NOT_CONFIGURED",
        )

    positions = []
    for raw in DeepcoinClient(credentials).get_open_positions():
        coin = _base_coin(raw.get("instId"))
        side = str(raw.get("posSide") or "").lower()
        size = _to_float(raw.get("pos"))
        if coin is None or side not in {"long", "short"} or size is None or size <= 0:
            continue
        raw_times = [
            value for value in (
                _timestamp_ms(raw.get("uTime")),
                _timestamp_ms(raw.get("cTime")),
            )
            if value is not None
        ]
        # Older API variants swap cTime/uTime semantics; their chronological order is stable.
        opened_ms = min(raw_times) if raw_times else None
        updated_ms = max(raw_times) if raw_times else None
        positions.append({
            "position_id": str(raw.get("posId") or ""),
            "symbol": f"{coin}/USDT",
            "direction": "Long" if side == "long" else "Short",
            "size": size,
            "average_price": _to_json_number(raw.get("avgPx")),
            "last_price": _to_json_number(raw.get("lastPx")),
            "unrealized_pnl": _to_json_number(raw.get("unrealizedProfit")),
            "leverage": _to_json_number(raw.get("lever")),
            "opened_at": _timestamp_to_iso(opened_ms) if opened_ms else None,
            "updated_at": _timestamp_to_iso(updated_ms) if updated_ms else None,
        })
    return {"success": True, "data": positions}


def get_deepcoin_trade_markers_service(
    symbol: str,
    direction: str,
    entry_time: str,
    exit_time: str,
    entry_price: float,
) -> Dict[str, Any]:
    """Return confirmed take-profit trigger events for one completed position."""
    credentials = get_deepcoin_credentials()
    if credentials is None:
        raise BusinessLogicError(
            "Deepcoin API credentials are not configured",
            error_code="DEEPCOIN_NOT_CONFIGURED",
        )

    entry_timestamp_ms = _iso_to_timestamp_ms(entry_time)
    exit_timestamp_ms = _iso_to_timestamp_ms(exit_time)
    coin = _base_coin(symbol)
    normalized_direction = direction.strip().lower()
    if (
        entry_timestamp_ms is None
        or exit_timestamp_ms is None
        or exit_timestamp_ms < entry_timestamp_ms
        or coin is None
        or normalized_direction not in {"long", "short"}
        or not math.isfinite(entry_price)
        or entry_price <= 0
    ):
        raise BusinessLogicError(
            "Invalid completed-position marker parameters",
            error_code="INVALID_TRADE_MARKER_PARAMETERS",
        )

    inst_id = f"{coin}-USDT-SWAP"
    raw_orders = DeepcoinClient(credentials).get_trigger_orders_history(inst_id=inst_id)
    candidates: List[Dict[str, Any]] = []
    seen_orders = set()
    for order in raw_orders:
        order_id = str(order.get("ordId") or "").strip()
        trigger_timestamp_ms = _timestamp_ms(order.get("triggerTime"))
        trigger_price = _to_float(order.get("triggerPx"))
        configured_tp_price = (
            _to_float(order.get("tpTriggerPrice"))
            or _to_float(order.get("closeTPTriggerPrice"))
        )
        configured_sl_price = (
            _to_float(order.get("slTriggerPrice"))
            or _to_float(order.get("closeSLTriggerPrice"))
        )
        error_code = str(order.get("errorCode") or "0")
        if (
            str(order.get("ordType") or "").strip().lower() != "tpsl"
            or str(order.get("posSide") or "").strip().lower() != normalized_direction
            or trigger_timestamp_ms is None
            or trigger_price is None
            or error_code != "0"
            or trigger_timestamp_ms < entry_timestamp_ms
            or trigger_timestamp_ms > exit_timestamp_ms
            or (order_id and order_id in seen_orders)
        ):
            continue

        if configured_tp_price:
            tolerance = max(abs(configured_tp_price) * 1e-8, 1e-8)
            is_take_profit = abs(trigger_price - configured_tp_price) <= tolerance
        elif configured_sl_price:
            is_take_profit = False
        else:
            is_take_profit = (
                trigger_price > entry_price
                if normalized_direction == "long"
                else trigger_price < entry_price
            )
        if not is_take_profit:
            continue
        if order_id:
            seen_orders.add(order_id)
        candidates.append(
            {
                "datetime": _timestamp_to_iso(trigger_timestamp_ms),
                "price": trigger_price,
                "size": _to_float(order.get("sz")),
                "order_id": order_id or None,
            }
        )

    target_prices = sorted(
        {candidate["price"] for candidate in candidates},
        reverse=normalized_direction == "short",
    )
    target_rank = {price: index + 1 for index, price in enumerate(target_prices)}
    take_profits = sorted(
        [
            {**candidate, "label": f"TP{target_rank[candidate['price']]}"}
            for candidate in candidates
        ],
        key=lambda candidate: candidate["datetime"],
    )
    warnings = []
    history_times = [
        timestamp
        for order in raw_orders
        if (timestamp := _timestamp_ms(order.get("uTime")) or _timestamp_ms(order.get("cTime")))
        is not None
    ]
    if len(raw_orders) >= 100 and history_times and entry_timestamp_ms < min(history_times):
        warnings.append(
            "Deepcoin returned the maximum 100 trigger orders; older TP events may be unavailable."
        )
    return {
        "success": True,
        "data": {
            "source": "deepcoin_trigger_order_history",
            "take_profits": take_profits,
            "warnings": warnings,
        },
    }


def sync_deepcoin_fills_service(inst_type: str, lookback_days: int) -> Dict[str, Any]:
    """Import recent Deepcoin fills and closed SWAP positions with point-in-time snapshots."""
    credentials = get_deepcoin_credentials()
    if credentials is None:
        raise BusinessLogicError(
            "Deepcoin API credentials are not configured",
            error_code="DEEPCOIN_NOT_CONFIGURED",
        )

    normalized_type = inst_type.upper()
    client = DeepcoinClient(credentials)
    raw_fills = client.get_fills(inst_type=normalized_type, lookback_days=lookback_days)
    prepared, ignored = _prepare_fills(raw_fills)
    raw_positions: List[Dict[str, Any]] = []
    position_history_error = False
    if normalized_type == "SWAP":
        try:
            raw_positions = client.get_positions_history(lookback_days=lookback_days)
        except DataLoadError:
            position_history_error = True
    prepared_positions, positions_ignored = _prepare_closed_positions(raw_positions)
    existing_ids = existing_external_ids([
        *(fill.external_id for fill in prepared),
        *(position.external_id for position in prepared_positions),
    ])
    new_fills = [fill for fill in prepared if fill.external_id not in existing_ids]
    new_positions = [position for position in prepared_positions if position.external_id not in existing_ids]
    existing_fills = [fill for fill in prepared if fill.external_id in existing_ids]
    existing_positions = [position for position in prepared_positions if position.external_id in existing_ids]
    skipped = len(prepared) - len(new_fills)
    snapshot_events = [
        *prepared,
        *(_snapshot_event_for_position(position) for position in prepared_positions),
    ]
    snapshots = _build_indicator_snapshots(snapshot_events) if snapshot_events else {}
    fills_updated = update_imported_entries_by_external_id([
        _journal_row(fill, snapshots.get(fill.external_id, {}), normalized_type)
        for fill in existing_fills
    ])
    positions_updated = update_imported_entries_by_external_id([
        _closed_position_journal_row(position, snapshots.get(position.external_id))
        for position in existing_positions
    ])
    positions_skipped = len(existing_positions) - positions_updated

    # Deepcoin can omit older closed positions from its history response. Keep
    # execution data untouched and refresh only stale entry snapshots locally.
    stale_position_events = _stale_closed_position_snapshot_events(lookback_days)
    stale_snapshots = _build_indicator_snapshots(stale_position_events) if stale_position_events else {}
    positions_snapshots_refreshed = update_indicator_snapshots_by_external_id(stale_snapshots)

    new_events = [*new_fills, *new_positions]
    imported = 0
    positions_imported = 0
    complete_snapshots = 0
    partial_snapshots = 0
    new_entries: List[Tuple[_PreparedFill, Dict[str, Any]]] = []
    for event in new_events:
        snapshot_event = _snapshot_event_for_position(event)
        fallback_reference = f"last_completed_candle_before_deepcoin_{snapshot_event.event_type}"
        snapshot = snapshots.get(
            event.external_id,
            {
                "version": 3,
                "market_source": "Binance USDT-M Futures",
                "market_source_fallback": False,
                "reference": fallback_reference,
                "event_type": snapshot_event.event_type,
                "event_time": _timestamp_to_iso(snapshot_event.timestamp_ms),
                "timeframes": {},
            },
        )
        timeframe_values = snapshot.get("timeframes", {}).values()
        is_complete = bool(timeframe_values) and all(
            value.get("status") == "complete"
            for value in timeframe_values
            if isinstance(value, dict)
        )
        if is_complete:
            complete_snapshots += 1
        else:
            partial_snapshots += 1

        entry = (
            _journal_row(event, snapshot, normalized_type)
            if event.event_type == "fill"
            else _closed_position_journal_row(event, snapshot)
        )
        new_entries.append((event, entry))

    created_ids = add_entries_if_new_external_ids(entry for _, entry in new_entries)
    for event, _ in new_entries:
        if event.external_id in created_ids:
            if event.event_type == "fill":
                imported += 1
            else:
                positions_imported += 1
        else:
            if event.event_type == "fill":
                skipped += 1
            else:
                positions_skipped += 1

    warnings = []
    if getattr(client, "truncated", False):
        warnings.append(
            "Fill history still hit Deepcoin's 100-record limit after adaptive window splitting; "
            "retry with a shorter date range."
        )
    if position_history_error:
        warnings.append("Closed-position history was unavailable; fills were still synchronized.")
    elif getattr(client, "positions_truncated", False):
        warnings.append(
            "Closed-position history still hit Deepcoin's 100-record limit after adaptive window splitting; "
            "retry with a shorter date range."
        )
    if partial_snapshots:
        warnings.append("Some imported records were saved with partial indicator snapshots.")
    if positions_snapshots_refreshed:
        warnings.append(
            f"Refreshed indicator snapshots for {positions_snapshots_refreshed} existing closed positions."
        )
    return {
        "success": True,
        "data": {
            "inst_type": normalized_type,
            "lookback_days": lookback_days,
            "fetched": len(raw_fills),
            "imported": imported,
            "skipped": skipped,
            "ignored": ignored,
            "complete_snapshots": complete_snapshots,
            "partial_snapshots": partial_snapshots,
            "positions_fetched": len(raw_positions),
            "positions_imported": positions_imported,
            "positions_updated": positions_updated,
            "positions_snapshots_refreshed": positions_snapshots_refreshed,
            "fills_updated": fills_updated,
            "positions_skipped": positions_skipped,
            "positions_ignored": positions_ignored,
            "warnings": warnings,
        },
    }


__all__ = [
    "DeepcoinClient",
    "get_deepcoin_open_positions_service",
    "get_deepcoin_status_service",
    "get_deepcoin_trade_markers_service",
    "sync_deepcoin_fills_service",
]
