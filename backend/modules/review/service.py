"""Single-snapshot API orchestration. No writes or cross-request result cache."""

from backend.modules.review.context import load_context
from backend.modules.review.core import build_review, detect_patterns, diagnose
from backend.modules.review.schemas import DiagnosisEnvelope, PatternEnvelope, TradingEnvelope


def trading_review(request, *, db_path=None):
    context = load_context(request, db_path=db_path)
    return TradingEnvelope(data=build_review(context, request))


def pattern_review(request, *, db_path=None):
    context = load_context(request, db_path=db_path)
    return PatternEnvelope(data=detect_patterns(context.current, request))


def strategy_execution_review(request, *, db_path=None):
    context = load_context(request, db_path=db_path)
    return DiagnosisEnvelope(data=diagnose(context.current, request))
