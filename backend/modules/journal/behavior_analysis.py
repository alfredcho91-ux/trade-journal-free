"""Behavior and edge analysis built on top of the existing trade-quality result.

Entry-time market context comes exclusively from ``quality_analysis``.  This module
only uses post-entry excursion data to explain a recorded plan or exit, never to
decide whether the entry itself complied with a trend rule.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, Iterable, List, Optional

import numpy as np

from backend.modules.journal import repository
from backend.modules.journal.quality_analysis import run_journal_quality_analysis_service
from backend.modules.journal.quality_market import finite
from backend.modules.journal.trade_selection import timestamp_ms

MIN_CONCLUSION_SAMPLE = 5


def _text_list(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []
    result: List[str] = []
    for item in value:
        text = str(item).strip() if item is not None else ""
        if text and text not in result:
            result.append(text)
    return result


def _legacy_mistakes(value: Any) -> List[str]:
    if not isinstance(value, str):
        return []
    return [part.strip() for part in value.split(",") if part.strip()]


def _max_drawdown_pnl(items: Iterable[Dict[str, Any]]) -> Optional[float]:
    cumulative = 0.0
    peak = 0.0
    maximum = 0.0
    count = 0
    for item in sorted(items, key=lambda row: str(row.get("exit_datetime") or "")):
        pnl = finite(item.get("realized_pnl"))
        if pnl is None:
            continue
        count += 1
        cumulative += pnl
        peak = max(peak, cumulative)
        maximum = max(maximum, peak - cumulative)
    return maximum if count else None


def performance_stats(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    """One performance definition shared by tag summaries and the evaluator."""
    pnls = [value for item in items if (value := finite(item.get("realized_pnl"))) is not None]
    wins = [value for value in pnls if value > 0]
    losses = [value for value in pnls if value < 0]
    r_values = [value for item in items if (value := finite(item.get("r_multiple"))) is not None]
    gross_loss = abs(sum(losses))
    return {
        "trade_count": len(items),
        "pnl_sample_count": len(pnls),
        "total_pnl": float(sum(pnls)) if pnls else None,
        "win_rate_pct": len(wins) / len(pnls) * 100 if pnls else None,
        "average_r": float(np.mean(r_values)) if r_values else None,
        "r_sample_count": len(r_values),
        "profit_factor": sum(wins) / gross_loss if gross_loss > 0 else None,
        "average_favorable_move_pct": _mean(item.get("mfe_pct") for item in items),
        "average_adverse_move_pct": _mean(item.get("mae_pct") for item in items),
        "max_drawdown_pnl": _max_drawdown_pnl(items),
    }


def _mean(values: Iterable[Any]) -> Optional[float]:
    valid = [value for item in values if (value := finite(item)) is not None]
    return float(np.mean(valid)) if valid else None


def _planned_comparison(entry: Dict[str, Any], quality: Dict[str, Any]) -> Dict[str, Any]:
    stop_pct = finite(entry.get("planned_stop_pct"))
    target_pct = finite(entry.get("planned_target_pct"))
    excursion = quality.get("excursion") or {}
    realized = finite(excursion.get("realized_move_pct"))
    mfe = finite(excursion.get("mfe_pct"))
    mae = finite(excursion.get("mae_pct"))
    rr = target_pct / stop_pct if stop_pct and target_pct else None
    recorded_time = timestamp_ms(entry.get("plan_recorded_at"))
    entry_time = timestamp_ms(entry.get("entry_datetime"))
    exit_time = timestamp_ms(entry.get("datetime"))
    if recorded_time is None:
        recording_phase = "unknown"
    elif entry_time is not None and recorded_time <= entry_time:
        recording_phase = "before_entry"
    elif exit_time is not None and recorded_time <= exit_time:
        recording_phase = "during_trade"
    elif exit_time is not None:
        recording_phase = "after_exit"
    else:
        recording_phase = "unknown"

    stop_status = "not_recorded"
    if stop_pct is not None and realized is not None:
        if mae is not None and mae >= stop_pct:
            stop_status = "overrun" if realized <= -stop_pct else "touched_not_executed"
        else:
            stop_status = "within_exit"
    target_status = "not_recorded"
    if target_pct is not None and realized is not None:
        if realized >= target_pct:
            target_status = "met"
        elif mfe is not None and mfe >= target_pct:
            target_status = "gave_back_after_hit"
        elif realized > 0:
            target_status = "closed_before_target"
        else:
            target_status = "not_reached"

    return {
        "planned_stop_pct": stop_pct,
        "planned_target_pct": target_pct,
        "planned_rr": rr,
        "planned_entry_reason": entry.get("planned_entry_reason"),
        "plan_recorded_at": entry.get("plan_recorded_at"),
        "recording_phase": recording_phase,
        "eligible_for_exit_plan_review": recording_phase in {"before_entry", "during_trade"},
        "eligible_for_entry_rule_review": recording_phase == "before_entry",
        "actual_price_return_pct": realized,
        "maximum_favorable_move_pct": mfe,
        "maximum_adverse_move_pct": mae,
        "stop_status": stop_status,
        "target_status": target_status,
    }


def _rule_result(rule: Dict[str, Any], item: Dict[str, Any]) -> Dict[str, Any]:
    parameters = rule.get("parameters") if isinstance(rule.get("parameters"), dict) else {}
    plan = item["plan"]
    direction = str(item.get("direction") or "")
    rule_type = rule.get("rule_type")
    status = "unknown"
    reason = "판정에 필요한 기록이 없습니다."

    if rule_type == "trend_direction_forbid":
        market_direction = str(parameters.get("market_direction") or "")
        forbidden_direction = str(parameters.get("forbidden_direction") or "")
        states = item.get("trend_states") if isinstance(item.get("trend_states"), dict) else {}
        directions = [str((states.get(interval) or {}).get("direction") or "") for interval in ("1w", "1d", "4h")]
        if market_direction not in {"up", "down"} or forbidden_direction not in {"Long", "Short"}:
            reason = "규칙 설정값이 올바르지 않습니다."
        elif any(value not in {"up", "down", "sideways"} for value in directions):
            reason = "진입 당시 추세 데이터가 부족합니다."
        elif all(value == market_direction for value in directions):
            status = "violation" if direction == forbidden_direction else "compliant"
            reason = "세 시간대가 규칙의 시장 방향과 일치합니다."
        else:
            status = "compliant"
            reason = "금지 조건의 세 시간대 정렬이 아니었습니다."
    elif rule_type == "max_stop_pct":
        maximum = finite(parameters.get("max_stop_pct"))
        if maximum is None or maximum <= 0:
            reason = "최대 손절률 설정이 올바르지 않습니다."
        elif not plan["eligible_for_entry_rule_review"]:
            reason = "진입 전에 기록된 계획이 아니므로 규칙 준수를 판정하지 않습니다."
        elif plan["planned_stop_pct"] is None:
            reason = "계획 손절률이 기록되지 않았습니다."
        else:
            status = "violation" if plan["planned_stop_pct"] > maximum else "compliant"
            reason = "계획 손절률을 기준으로 판정했습니다."
    elif rule_type == "min_rr":
        minimum = finite(parameters.get("min_rr"))
        if minimum is None or minimum <= 0:
            reason = "최소 손익비 설정이 올바르지 않습니다."
        elif not plan["eligible_for_entry_rule_review"]:
            reason = "진입 전에 기록된 계획이 아니므로 규칙 준수를 판정하지 않습니다."
        elif plan["planned_rr"] is None:
            reason = "계획 SL/TP가 모두 기록되지 않았습니다."
        else:
            status = "violation" if plan["planned_rr"] < minimum else "compliant"
            reason = "계획 TP ÷ 계획 SL을 기준으로 판정했습니다."
    elif rule_type == "no_scale_in":
        scale_tags = {"물타기", "불타기", "scale in", "scale-in"}
        mistakes = {tag.lower() for tag in item.get("mistake_tags", [])}
        if mistakes & scale_tags:
            status = "violation"
            reason = "사용자가 기록한 물타기/불타기 태그가 있습니다."
        else:
            reason = "현재 종료 포지션과 체결 기록만으로는 분할 진입 여부를 확정할 수 없습니다."
    return {
        "rule_id": rule.get("id"),
        "rule_name": rule.get("name"),
        "rule_type": rule_type,
        "status": status,
        "reason": reason,
    }


def _rule_status(checks: List[Dict[str, Any]]) -> str:
    if not checks:
        return "not_configured"
    statuses = {check["status"] for check in checks}
    if "violation" in statuses:
        return "violation"
    if "unknown" in statuses:
        return "unknown"
    return "compliant"


def _automatic_issues(item: Dict[str, Any]) -> List[Dict[str, str]]:
    issues: List[Dict[str, str]] = []
    plan = item["plan"]
    if plan["eligible_for_exit_plan_review"]:
        if plan["stop_status"] == "overrun":
            issues.append({"id": "planned_stop_overrun", "label": "계획 손절률 초과"})
        elif plan["stop_status"] == "touched_not_executed":
            issues.append({"id": "planned_stop_not_executed", "label": "계획 손절선 도달 후 미청산"})
        if plan["target_status"] == "gave_back_after_hit":
            issues.append({"id": "planned_target_giveback", "label": "계획 목표가 도달 후 수익 반납"})
    quality_class = item.get("quality_class")
    if quality_class == "good_entry_early_exit":
        issues.append({"id": "early_exit", "label": "조기청산"})
    elif quality_class == "good_entry_late_exit":
        issues.append({"id": "late_exit", "label": "늦은 청산"})
    for check in item.get("rule_checks", []):
        if check["status"] == "violation":
            issues.append({"id": f"rule:{check['rule_id']}", "label": check["rule_name"] or "규칙 위반"})
    return issues


def _behavior_item(entry: Dict[str, Any], quality: Dict[str, Any], rules: List[Dict[str, Any]]) -> Dict[str, Any]:
    excursion = quality.get("excursion") or {}
    exit_quality = quality.get("exit_quality") or {}
    item = {
        "journal_id": int(entry["id"]),
        "symbol": entry.get("symbol"),
        "direction": entry.get("direction"),
        "entry_datetime": entry.get("entry_datetime"),
        "exit_datetime": entry.get("datetime"),
        "realized_pnl": finite(entry.get("realized_pnl")),
        "r_multiple": finite(entry.get("r_multiple")),
        "mfe_pct": finite(excursion.get("mfe_pct")),
        "mae_pct": finite(excursion.get("mae_pct")),
        "post_exit_opportunity_pct": finite(exit_quality.get("additional_profit_potential_pct")),
        "profit_give_up_pct": finite(exit_quality.get("profit_give_up_pct")),
        "quality_class": quality.get("quality_class"),
        "market_regime": quality.get("market_regime") or {"id": "unavailable", "alignment": "unknown", "trade_bias": "neutral"},
        "trend_states": quality.get("trend_states") or {},
        "setup_tags": _text_list(entry.get("setup_tags")),
        "mistake_tags": list(dict.fromkeys(_text_list(entry.get("mistake_tags")) + _legacy_mistakes(entry.get("mistakes")))),
    }
    item["plan"] = _planned_comparison(entry, quality)
    item["rule_checks"] = [_rule_result(rule, item) for rule in rules if rule.get("is_enabled")]
    item["rule_status"] = _rule_status(item["rule_checks"])
    manual_issues = [{"id": f"mistake:{tag}", "label": tag} for tag in item["mistake_tags"]]
    issues_by_label: Dict[str, Dict[str, str]] = {}
    for issue in [*manual_issues, *_automatic_issues(item)]:
        issues_by_label.setdefault(issue["label"], issue)
    item["issues"] = list(issues_by_label.values())
    return item


def _tag_stats(items: List[Dict[str, Any]], key: str) -> List[Dict[str, Any]]:
    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for item in items:
        for tag in item.get(key, []):
            grouped[tag].append(item)
    rows = [{
        "tag": tag,
        **performance_stats(group),
        "evidence_journal_ids": [
            item["journal_id"]
            for item in sorted(group, key=lambda item: str(item.get("exit_datetime") or ""), reverse=True)
        ],
    } for tag, group in grouped.items()]
    if key == "mistake_tags":
        return sorted(rows, key=lambda row: (row["total_pnl"] is None, row["total_pnl"] or 0, row["tag"]))
    return sorted(rows, key=lambda row: (row["total_pnl"] is None, -(row["total_pnl"] or 0), row["tag"]))


def _biggest_leaks(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    grouped: Dict[str, Dict[str, Any]] = {}
    for item in items:
        issues = item.get("issues") or []
        if not issues:
            continue
        pnl = finite(item.get("realized_pnl"))
        r_value = finite(item.get("r_multiple"))
        share = len(issues)
        for issue in issues:
            row = grouped.setdefault(issue["id"], {
                "id": issue["id"],
                "label": issue["label"],
                "items": [],
                "loss_impact_pnl": 0.0,
                "loss_impact_r": 0.0,
                "r_coverage": 0,
                "opportunity_values": [],
            })
            row["items"].append(item)
            if pnl is not None and pnl < 0:
                row["loss_impact_pnl"] += abs(pnl) / share
            if r_value is not None and r_value < 0:
                row["loss_impact_r"] += abs(r_value) / share
                row["r_coverage"] += 1
            normalized_label = str(issue["label"]).strip().lower()
            if normalized_label in {"조기청산", "early exit"}:
                opportunity = finite(item.get("post_exit_opportunity_pct"))
            elif normalized_label in {"늦은 청산", "late exit"}:
                opportunity = finite(item.get("profit_give_up_pct"))
            else:
                opportunity = None
            if opportunity is not None and opportunity > 0:
                row["opportunity_values"].append(opportunity)
    output = []
    for row in grouped.values():
        stats = performance_stats(row["items"])
        if row["loss_impact_pnl"] <= 0 and row["r_coverage"] == 0 and not row["opportunity_values"]:
            continue
        output.append({
            "id": row["id"],
            "label": row["label"],
            **stats,
            "loss_impact_pnl": row["loss_impact_pnl"],
            "loss_impact_r": row["loss_impact_r"] if row["r_coverage"] else None,
            "opportunity_sample_count": len(row["opportunity_values"]),
            "average_opportunity_pct": _mean(row["opportunity_values"]),
            "conclusion_eligible": len(row["items"]) >= MIN_CONCLUSION_SAMPLE,
            "evidence_journal_ids": [item["journal_id"] for item in sorted(row["items"], key=lambda item: str(item.get("exit_datetime") or ""), reverse=True)],
        })
    return sorted(output, key=lambda row: (
        not row["conclusion_eligible"],
        -row["loss_impact_pnl"],
        -(row["loss_impact_r"] or 0),
        row["label"],
    ))


def _condition_options(items: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    options: List[Dict[str, str]] = []
    for direction in ("Long", "Short"):
        if any(item.get("direction") == direction for item in items):
            options.append({"type": "direction", "value": direction, "label": direction.upper()})
    for symbol in sorted({str(item.get("symbol")) for item in items if item.get("symbol")}):
        options.append({"type": "symbol", "value": symbol, "label": symbol})
    for regime in sorted({str((item.get("market_regime") or {}).get("id")) for item in items if (item.get("market_regime") or {}).get("id")}):
        options.append({"type": "regime", "value": regime, "label": f"장세: {regime}"})
    for tag in sorted({tag for item in items for tag in item.get("setup_tags", [])}):
        options.append({"type": "setup", "value": tag, "label": f"Setup: {tag}"})
    for tag in sorted({tag for item in items for tag in item.get("mistake_tags", [])}):
        options.append({"type": "mistake", "value": tag, "label": f"실수: {tag}"})
    if any(item.get("rule_status") == "compliant" for item in items):
        options.append({"type": "rule_status", "value": "compliant", "label": "규칙 준수"})
    if any(item.get("rule_status") == "violation" for item in items):
        options.append({"type": "rule_status", "value": "violation", "label": "규칙 위반"})
    return options


def _condition_matches(item: Dict[str, Any], condition: Dict[str, Any]) -> bool:
    kind = condition.get("type")
    value = str(condition.get("value") or "")
    if kind == "direction":
        return item.get("direction") == value
    if kind == "symbol":
        return item.get("symbol") == value
    if kind == "regime":
        return (item.get("market_regime") or {}).get("id") == value
    if kind == "setup":
        return value in item.get("setup_tags", [])
    if kind == "mistake":
        return value in item.get("mistake_tags", [])
    if kind == "rule_status":
        return item.get("rule_status") == value
    return False


def _bundle(start_time: int, end_time: int, min_abs_net_return_pct: float) -> Dict[str, Any]:
    quality_response = run_journal_quality_analysis_service(start_time, end_time, min_abs_net_return_pct)
    quality_data = quality_response["data"]
    entries = {int(entry["id"]): entry for entry in repository.list_entries() if entry.get("id") is not None}
    rules = repository.list_behavior_rules()
    items = []
    for quality in quality_data.get("items", []):
        journal_id = quality.get("journal_id")
        entry = entries.get(int(journal_id)) if journal_id is not None else None
        if entry is not None:
            items.append(_behavior_item(entry, quality, rules))
    items.sort(key=lambda item: str(item.get("exit_datetime") or ""), reverse=True)
    plan_items = [item for item in items if (
        item["plan"]["planned_stop_pct"] is not None
        or item["plan"]["planned_target_pct"] is not None
        or bool(item["plan"]["planned_entry_reason"])
    )]
    full_plan_items = [item for item in items if item["plan"]["planned_rr"] is not None]
    rule_status_stats = {
        status: performance_stats([item for item in items if item["rule_status"] == status])
        for status in ("compliant", "violation", "unknown")
    }
    return {
        "items": items,
        "summary": performance_stats(items),
        "plan_summary": {
            "recorded_trade_count": len(plan_items),
            "full_plan_trade_count": len(full_plan_items),
            "stop_overrun_count": sum(item["plan"]["stop_status"] == "overrun" for item in plan_items),
            "target_giveback_count": sum(item["plan"]["target_status"] == "gave_back_after_hit" for item in plan_items),
            "post_exit_record_count": sum(item["plan"]["recording_phase"] == "after_exit" for item in plan_items),
        },
        "setup_stats": _tag_stats(items, "setup_tags"),
        "mistake_stats": _tag_stats(items, "mistake_tags"),
        "biggest_leaks": _biggest_leaks(items),
        "rule_status_stats": rule_status_stats,
        "rules": rules,
        "condition_options": _condition_options(items),
        "minimum_conclusion_sample": MIN_CONCLUSION_SAMPLE,
        "coverage": {
            "selected_closed_positions": len(quality_data.get("items", [])),
            "behavior_items": len(items),
            "missing_quality_items": max(0, len(quality_data.get("items", [])) - len(items)),
        },
        "warnings": list(quality_data.get("warnings") or []),
    }


def run_journal_behavior_analysis_service(
    start_time: int,
    end_time: int,
    min_abs_net_return_pct: float = 0.0,
) -> Dict[str, Any]:
    if start_time > end_time:
        raise ValueError("start_time must be before end_time")
    return {"success": True, "data": _bundle(start_time, end_time, min_abs_net_return_pct)}


def run_journal_behavior_comparison_service(
    start_time: int,
    end_time: int,
    left: Dict[str, Any],
    right: Dict[str, Any],
    min_abs_net_return_pct: float = 0.0,
) -> Dict[str, Any]:
    bundle = _bundle(start_time, end_time, min_abs_net_return_pct)
    output = {}
    for key, condition in (("left", left), ("right", right)):
        selected = [item for item in bundle["items"] if _condition_matches(item, condition)]
        output[key] = {
            "condition": condition,
            "stats": performance_stats(selected),
            "evidence_journal_ids": [item["journal_id"] for item in selected],
        }
    return {"success": True, "data": output}


__all__ = [
    "performance_stats",
    "run_journal_behavior_analysis_service",
    "run_journal_behavior_comparison_service",
]
