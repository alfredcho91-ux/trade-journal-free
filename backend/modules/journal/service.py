"""Journal API service layer."""

from __future__ import annotations

from typing import Any, Dict

from backend.modules.journal.repository import delete_entry, list_entries, update_entry_behavior


def get_journal_service() -> Dict[str, Any]:
    """Get all journal entries."""
    try:
        return {"success": True, "data": list_entries()}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def delete_journal_service(entry_id: int) -> Dict[str, Any]:
    """Delete one journal entry by id."""
    try:
        deleted = delete_entry(entry_id)
        if not deleted:
            return {"success": False, "error": "Journal entry not found"}
        return {"success": True, "message": "Entry deleted"}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def update_journal_behavior_service(entry_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Update user-authored plan and behavior labels without touching exchange fields."""
    try:
        record = update_entry_behavior(entry_id, payload)
        if record is None:
            return {"success": False, "error": "Journal entry not found"}
        return {"success": True, "data": record}
    except Exception as exc:
        return {"success": False, "error": str(exc)}
