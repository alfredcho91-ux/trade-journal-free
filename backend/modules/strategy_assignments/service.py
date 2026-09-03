"""Service boundary for explicit Journal StrategyVersion assignments."""

from __future__ import annotations

from typing import Any, Dict

from backend.modules.strategy_assignments import repository
from backend.utils.error_handler import APIError, NotFoundError


def _map_not_found(exc: Exception, identifier: int) -> APIError:
    if isinstance(exc, repository.AssignmentJournalNotFound):
        return NotFoundError("Journal entry", str(identifier))
    if isinstance(exc, repository.AssignmentVersionNotFound):
        return NotFoundError("StrategyVersion", str(identifier))
    return APIError("Assignment operation failed", status_code=500)


def get_assignment_service(journal_entry_id: int) -> Dict[str, Any]:
    try:
        assignment = repository.get_assignment(journal_entry_id)
    except repository.AssignmentJournalNotFound as exc:
        raise _map_not_found(exc, journal_entry_id) from exc
    return {"success": True, "data": assignment}


def put_assignment_service(
    journal_entry_id: int, strategy_version_id: int,
) -> Dict[str, Any]:
    try:
        assignment = repository.put_assignment(
            journal_entry_id, strategy_version_id
        )
    except repository.AssignmentJournalNotFound as exc:
        raise _map_not_found(exc, journal_entry_id) from exc
    except repository.AssignmentVersionNotFound as exc:
        raise _map_not_found(exc, strategy_version_id) from exc
    return {"success": True, "data": assignment}


def delete_assignment_service(journal_entry_id: int) -> Dict[str, Any]:
    try:
        repository.delete_assignment(journal_entry_id)
    except repository.AssignmentJournalNotFound as exc:
        raise _map_not_found(exc, journal_entry_id) from exc
    return {"success": True, "data": None}
