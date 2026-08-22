"""Small adapter around the operating-system credential vault."""

from __future__ import annotations

from typing import Any, Optional

SERVICE_NAME = "Trade Journal Free"


class KeyringStoreError(RuntimeError):
    """Raised when the operating-system credential vault is unavailable."""


def save_keyring_payload(exchange_id: str, payload: str) -> None:
    try:
        _keyring_module().set_password(SERVICE_NAME, exchange_id.lower(), payload)
    except Exception as exc:
        raise KeyringStoreError("The operating-system credential vault is unavailable") from exc


def load_keyring_payload(exchange_id: str) -> Optional[str]:
    try:
        return _keyring_module().get_password(SERVICE_NAME, exchange_id.lower())
    except Exception as exc:
        raise KeyringStoreError("The operating-system credential vault is unavailable") from exc


def delete_keyring_payload(exchange_id: str) -> bool:
    keyring: Any = None
    try:
        keyring = _keyring_module()
        if not keyring.get_password(SERVICE_NAME, exchange_id.lower()):
            return False
        keyring.delete_password(SERVICE_NAME, exchange_id.lower())
        return True
    except Exception as exc:
        password_delete_error = getattr(getattr(keyring, "errors", None), "PasswordDeleteError", None)
        if password_delete_error is not None and isinstance(exc, password_delete_error):
            return False
        raise KeyringStoreError("The operating-system credential vault is unavailable") from exc


def _keyring_module() -> Any:
    try:
        import keyring
    except ImportError as exc:
        raise KeyringStoreError("Install the keyring package to store API credentials securely") from exc
    return keyring


__all__ = [
    "KeyringStoreError",
    "delete_keyring_payload",
    "load_keyring_payload",
    "save_keyring_payload",
]
