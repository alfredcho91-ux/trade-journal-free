"""Supported exchange connector metadata."""

from typing import Any, Dict


SUPPORTED_EXCHANGES: Dict[str, Dict[str, Any]] = {
    "deepcoin": {
        "name": "Deepcoin",
        "connector": "native",
        "instrument_types": ["SWAP", "SPOT"],
        "requires_passphrase": True,
    },
    "binance": {
        "name": "Binance",
        "connector": "ccxt",
        "instrument_types": ["SWAP", "SPOT"],
        "requires_passphrase": False,
    },
    "bybit": {
        "name": "Bybit",
        "connector": "ccxt",
        "instrument_types": ["SWAP", "SPOT"],
        "requires_passphrase": False,
    },
    "okx": {
        "name": "OKX",
        "connector": "ccxt",
        "instrument_types": ["SWAP", "SPOT"],
        "requires_passphrase": True,
    },
}


__all__ = ["SUPPORTED_EXCHANGES"]
