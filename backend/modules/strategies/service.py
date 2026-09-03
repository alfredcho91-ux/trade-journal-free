"""Domain transitions for Strategy Playbook and immutable versions."""

from __future__ import annotations

import sqlite3
import unicodedata
from typing import Any, Dict, Optional

from backend.modules.strategies import repository
from backend.utils.error_handler import APIError, NotFoundError, ValidationError


def _normalized_keyed_text(value: Any, field: str, maximum: int) -> tuple[str, str]:
    if not isinstance(value, str):
        raise ValidationError(f"{field} must be text")
    normalized = unicodedata.normalize("NFKC", value).strip()
    if not normalized or len(normalized) > maximum:
        raise ValidationError(f"{field} must be between 1 and {maximum} characters")
    return normalized, normalized.casefold()


def _description(value: Any) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _conflict(message: str, error_code: str = "STRATEGY_CONFLICT") -> APIError:
    return APIError(message, error_code=error_code, status_code=409)


def _map_repository_error(exc: Exception) -> APIError:
    if isinstance(exc, repository.StrategyRepositoryNotFound):
        return APIError(str(exc), error_code="NOT_FOUND", status_code=404)
    if isinstance(exc, repository.StrategyRepositoryConflict):
        return _conflict(str(exc))
    return APIError("Strategy operation failed", status_code=500)


def list_strategies_service(include_archived: bool = False) -> Dict[str, Any]:
    return {"success": True, "data": repository.list_strategies(include_archived=include_archived)}


def get_strategy_service(strategy_id: int) -> Dict[str, Any]:
    strategy = repository.get_strategy(strategy_id)
    if strategy is None:
        raise NotFoundError("Strategy", str(strategy_id))
    return {"success": True, "data": strategy}


def create_strategy_service(payload: Dict[str, Any]) -> Dict[str, Any]:
    name, name_key = _normalized_keyed_text(payload.get("name"), "Strategy name", 120)
    initial = payload["initial_version"]
    label, label_key = _normalized_keyed_text(
        initial.get("version_label"), "Version label", 40
    )
    try:
        strategy = repository.create_strategy(
            name=name,
            name_key=name_key,
            description=_description(payload.get("description")),
            version_label=label,
            version_label_key=label_key,
            version_description=_description(initial.get("description")),
            rules=initial["rules"],
        )
    except sqlite3.IntegrityError as exc:
        raise _conflict(
            "A Strategy with this normalized name already exists",
            "STRATEGY_NAME_CONFLICT",
        ) from exc
    return {"success": True, "data": strategy}


def update_strategy_service(strategy_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
    changes: Dict[str, Any] = {}
    if "name" in payload:
        name, name_key = _normalized_keyed_text(
            payload.get("name"), "Strategy name", 120
        )
        changes.update({"name": name, "name_key": name_key})
    if "description" in payload:
        changes["description"] = _description(payload.get("description"))
    try:
        strategy = repository.update_strategy(strategy_id, changes)
    except sqlite3.IntegrityError as exc:
        raise _conflict(
            "A Strategy with this normalized name already exists",
            "STRATEGY_NAME_CONFLICT",
        ) from exc
    if strategy is None:
        raise NotFoundError("Strategy", str(strategy_id))
    return {"success": True, "data": strategy}


def archive_strategy_service(strategy_id: int) -> Dict[str, Any]:
    strategy = repository.set_strategy_archived(strategy_id, True)
    if strategy is None:
        raise NotFoundError("Strategy", str(strategy_id))
    return {"success": True, "data": strategy}


def restore_strategy_service(strategy_id: int) -> Dict[str, Any]:
    strategy = repository.set_strategy_archived(strategy_id, False)
    if strategy is None:
        raise NotFoundError("Strategy", str(strategy_id))
    return {"success": True, "data": strategy}


def list_versions_service(strategy_id: int) -> Dict[str, Any]:
    versions = repository.list_versions(strategy_id)
    if versions is None:
        raise NotFoundError("Strategy", str(strategy_id))
    return {"success": True, "data": versions}


def get_version_service(strategy_id: int, version_id: int) -> Dict[str, Any]:
    version = repository.get_version(strategy_id, version_id)
    if version is None:
        raise NotFoundError("StrategyVersion", str(version_id))
    return {"success": True, "data": version}


def create_version_service(strategy_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
    label, label_key = _normalized_keyed_text(
        payload.get("version_label"), "Version label", 40
    )
    try:
        version = repository.create_version(
            strategy_id,
            version_label=label,
            version_label_key=label_key,
            description=_description(payload.get("description")),
            rules=payload["rules"],
        )
    except sqlite3.IntegrityError as exc:
        raise _conflict(
            "This Version label already exists for the Strategy",
            "STRATEGY_VERSION_LABEL_CONFLICT",
        ) from exc
    except (repository.StrategyRepositoryNotFound, repository.StrategyRepositoryConflict) as exc:
        raise _map_repository_error(exc) from exc
    return {"success": True, "data": version}


def activate_version_service(strategy_id: int, version_id: int) -> Dict[str, Any]:
    try:
        version = repository.activate_version(strategy_id, version_id)
    except (repository.StrategyRepositoryNotFound, repository.StrategyRepositoryConflict) as exc:
        raise _map_repository_error(exc) from exc
    return {"success": True, "data": version}


def retire_version_service(strategy_id: int, version_id: int) -> Dict[str, Any]:
    try:
        version = repository.retire_version(strategy_id, version_id)
    except (repository.StrategyRepositoryNotFound, repository.StrategyRepositoryConflict) as exc:
        raise _map_repository_error(exc) from exc
    return {"success": True, "data": version}
