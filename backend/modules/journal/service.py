"""Journal API service layer."""

from __future__ import annotations

from typing import Any, Dict

from backend.modules.journal.repository import delete_entry, list_entries, update_entry_behavior
from backend.modules.journal.daily_repository import (
    delete_daily_journal,
    get_daily_journal,
    list_daily_journals,
    upsert_daily_journal,
)


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


def list_daily_journals_service(start_date: str | None, end_date: str | None) -> Dict[str, Any]:
    try:
        return {
            "success": True,
            "data": list_daily_journals(start_date=start_date, end_date=end_date),
        }
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def get_daily_journal_service(trade_date: str) -> Dict[str, Any]:
    try:
        record = get_daily_journal(trade_date)
        if record is None:
            return {"success": False, "error": "Daily journal entry not found"}
        return {"success": True, "data": record}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def upsert_daily_journal_service(trade_date: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        return {"success": True, "data": upsert_daily_journal(trade_date, payload)}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def delete_daily_journal_service(trade_date: str) -> Dict[str, Any]:
    try:
        if not delete_daily_journal(trade_date):
            return {"success": False, "error": "Daily journal entry not found"}
        return {"success": True, "message": "Daily journal entry deleted"}
    except Exception as exc:
        return {"success": False, "error": str(exc)}
