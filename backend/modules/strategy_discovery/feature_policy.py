"""Versioned, deliberately small search space. No outcome or retrospective features."""

ENGINE_VERSION = 1
POLICY_VERSION = 1
MAX_TRADES = 2000
MAX_SYMBOLS = 32
MAX_CANDIDATES = 64
MIN_SAMPLE = 5
MIN_COVERAGE_PCT = 80
DISCOVERY_PCT = 70
FEATURES = ("symbol", "direction")
METRICS = ("average_return_pct", "average_r", "win_rate_pct", "profit_factor")


def metadata():
    return {
        "engine_version": ENGINE_VERSION, "policy_version": POLICY_VERSION,
        "features": list(FEATURES), "primary_metrics": ["average_return_pct", "average_r"],
        "metrics": list(METRICS), "discovery_pct": DISCOVERY_PCT,
        "minimum_sample_per_segment": MIN_SAMPLE, "minimum_coverage_pct": MIN_COVERAGE_PCT,
        "max_trades": MAX_TRADES, "max_symbols": MAX_SYMBOLS,
        "max_candidates": MAX_CANDIDATES, "max_conditions": 2,
        "time_basis": "UTC_CLOSE_RANGE_WITH_ENTRY_PURGED_HOLDOUT",
        "evidence_semantics": "OBSERVED_ASSOCIATION",
        "profit_factor_reason": "PNL_CURRENCY_UNVERIFIED",
        "ranking_basis": "Discovery primary-metric uplift only; never holdout performance.",
    }
