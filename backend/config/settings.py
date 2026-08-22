# config/settings.py
"""Application settings and configuration"""

import os
import shlex
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

SOURCE_ROOT = Path(__file__).resolve().parent.parent.parent
IS_FROZEN = bool(getattr(sys, "frozen", False))
BUNDLE_ROOT = Path(getattr(sys, "_MEIPASS", SOURCE_ROOT))


def _default_app_data_dir() -> Path:
    """Return the per-user writable directory for the packaged application."""
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Trade Journal Free"
    if sys.platform == "win32":
        return Path(os.getenv("APPDATA", str(Path.home()))) / "Trade Journal Free"
    return Path(os.getenv("XDG_DATA_HOME", str(Path.home() / ".local" / "share"))) / "trade-journal-free"


APP_DATA_DIR = Path(os.getenv("TRADE_JOURNAL_DATA_DIR", str(_default_app_data_dir()))).expanduser()
# Source runs keep files beside the project. Packaged runs never write into the application bundle.
PROJECT_ROOT = APP_DATA_DIR if IS_FROZEN else SOURCE_ROOT
FRONTEND_DIST_DIR = BUNDLE_ROOT / "frontend" / "dist" if IS_FROZEN else SOURCE_ROOT / "frontend" / "dist"
LOCAL_ENV_PATH = PROJECT_ROOT / ".env"
LOCAL_ENV_KEYS_LOADED: set[str] = set()


def _load_local_env() -> None:
    """Load persisted credentials without overriding explicit environment values."""
    if not LOCAL_ENV_PATH.is_file():
        return

    for raw_line in LOCAL_ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        try:
            parts = shlex.split(line, comments=True, posix=True)
        except ValueError:
            continue
        if len(parts) != 1 or "=" not in parts[0]:
            continue
        key, value = parts[0].split("=", 1)
        if key and key.replace("_", "").isalnum():
            if key not in os.environ:
                os.environ[key] = value
                LOCAL_ENV_KEYS_LOADED.add(key)


_load_local_env()


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
    from backend.modules.exchanges.credentials import load_exchange_credentials

    stored = load_exchange_credentials("deepcoin")
    if stored is None or not stored.passphrase:
        return None
    return DeepcoinCredentials(
        api_key=stored.api_key,
        secret_key=stored.secret_key,
        passphrase=stored.passphrase,
    )


def get_deepcoin_api_base_url() -> str:
    """Return the configurable Deepcoin REST base URL without a trailing slash."""
    return os.getenv("DEEPCOIN_API_BASE_URL", "https://api.deepcoin.com").rstrip("/")

# Timeframe to minutes mapping
TIMEFRAME_TO_MINUTES = {
    "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30, "1h": 60,
    "2h": 120, "4h": 240, "6h": 360, "8h": 480, "12h": 720, "1d": 1440,
    "1w": 10_080, "1M": 43_200,
}
