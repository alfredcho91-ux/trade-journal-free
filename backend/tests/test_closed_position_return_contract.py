import pytest

from backend.modules.journal import performance, quality_analysis
from backend.modules.journal.closed_position_returns import closed_position_net_return_pct


def closed_position(**changes):
    return {
        "id": 1,
        "source": "binance_position",
        "direction": "Long",
        "entry_price": 100.0,
        "exit_price": 110.0,
        "realized_pnl": 8.0,
        "fee": 0.0,
        "funding_fee": 0.0,
        "leverage": 2.0,
        "invested_amount": None,
        **changes,
    }


@pytest.mark.parametrize(
    ("entry", "expected_return"),
    [
        (closed_position(invested_amount=200.0, realized_pnl=10.0), 5.0),
        (closed_position(fee=2.0), 16.0),
        (closed_position(funding_fee=-1.0), pytest.approx(17.7777777778)),
        (closed_position(fee=2.0, funding_fee=1.0), pytest.approx(17.7777777778)),
        (closed_position(entry_price=100.0, exit_price=100.0), None),
        (closed_position(realized_pnl=0.0), None),
        (closed_position(leverage=None), None),
        (closed_position(entry_price="invalid"), None),
    ],
)
def test_closed_position_return_consumers_preserve_characterized_results(entry, expected_return):
    """Performance and Quality use the same accepted closed-position policy."""
    assert closed_position_net_return_pct(entry) == expected_return
    assert quality_analysis._net_return_pct(entry) == expected_return
    assert performance.summarize_performance([entry])["net_return_pct"] == expected_return


def test_quality_keeps_its_non_position_size_fallback_outside_closed_position_policy():
    entry = {
        "id": 1,
        "source": "manual_trade",
        "entry_price": 100.0,
        "size": 3.0,
        "realized_pnl": 15.0,
        "invested_amount": None,
        "leverage": None,
    }

    assert quality_analysis._net_return_pct(entry) == 5.0
