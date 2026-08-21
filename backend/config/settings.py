# config/settings.py
"""Application settings and configuration"""

import os
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


def get_app_environment() -> str:
    """Return the normalized application environment."""
    return os.getenv("APP_ENV", "development").strip().lower()


def get_basic_auth_credentials() -> tuple[str, str]:
    """Load required production credentials without insecure defaults."""
    username = os.getenv("DEMO_USERNAME", "").strip()
    password = os.getenv("DEMO_PASSWORD", "")
    if get_app_environment() == "production" and (not username or not password):
        raise RuntimeError(
            "DEMO_USERNAME and DEMO_PASSWORD must be configured when APP_ENV=production"
        )
    return username, password

# CORS settings
_DEFAULT_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:3000",
]

_cors_origins_env = os.getenv("CORS_ORIGINS", "")
CORS_ORIGINS: List[str] = (
    [origin.strip() for origin in _cors_origins_env.split(",") if origin.strip()]
    if _cors_origins_env
    else _DEFAULT_CORS_ORIGINS
)

# Journal settings
JOURNAL_DIR = Path(os.getenv("JOURNAL_DIR", str(PROJECT_ROOT / "journal"))).expanduser()
JOURNAL_DB_PATH = Path(
    os.getenv("JOURNAL_DB_PATH", str(JOURNAL_DIR / "trade_journal.db"))
).expanduser()
JOURNAL_CSV_PATH = Path(
    os.getenv("JOURNAL_CSV_PATH", str(JOURNAL_DIR / "trade_journal.csv"))
).expanduser()
JOURNAL_PATH = JOURNAL_CSV_PATH
JOURNAL_COLUMNS = [
    "id",
    "datetime",
    "entry_datetime",
    "symbol",
    "timeframe",
    "direction",
    "entry_reason_1_indicator",
    "entry_reason_1",
    "entry_reason_2_indicator",
    "entry_reason_2",
    "entry_reason_3_indicator",
    "entry_reason_3",
    "indicators",
    "size",
    "entry_price",
    "exit_price",
    "pnl_pct",
    "r_multiple",
    "outcome",
    "emotion",
    "tags",
    "mistakes",
    "notes",
    "source",
    "external_id",
    "exchange",
    "order_id",
    "fee",
    "fee_currency",
    "funding_fee",
    "realized_pnl",
    "leverage",
    "invested_amount",
    "pnl_calculation_version",
    "indicator_snapshot",
    "created_at",
]


@dataclass(frozen=True)
class DeepcoinCredentials:
    """Read-only API credentials loaded only from the server environment."""

    api_key: str
    secret_key: str
    passphrase: str


def get_deepcoin_credentials() -> Optional[DeepcoinCredentials]:
    """Return complete Deepcoin credentials, or ``None`` when not configured."""
    api_key = os.getenv("DEEPCOIN_API_KEY", "").strip()
    secret_key = os.getenv("DEEPCOIN_SECRET_KEY", "")
    passphrase = os.getenv("DEEPCOIN_PASSPHRASE", "")
    if not all((api_key, secret_key, passphrase)):
        return None
    return DeepcoinCredentials(
        api_key=api_key,
        secret_key=secret_key,
        passphrase=passphrase,
    )


def get_deepcoin_api_base_url() -> str:
    """Return the configurable Deepcoin REST base URL without a trailing slash."""
    return os.getenv("DEEPCOIN_API_BASE_URL", "https://api.deepcoin.com").rstrip("/")

# Timeframe to minutes mapping
TIMEFRAME_TO_MINUTES = {
    "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30, "1h": 60,
    "2h": 120, "4h": 240, "6h": 360, "8h": 480, "12h": 720, "1d": 1440,
}
