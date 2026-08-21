from backend.modules.journal.stop_loss_analysis import (
    STOP_HORIZONS,
    _classify_stop,
    _confirmed_stop_events,
    _match_confirmed_stops,
    _summary,
)


def test_stop_analysis_tracks_only_three_completed_four_hour_candles():
    assert STOP_HORIZONS == (1, 2, 3)


def test_confirmed_stop_events_exclude_tp_untriggered_and_failed_orders():
    orders = [
        {
            "ordId": "sl",
            "ordType": "TPSL",
            "posSide": "long",
            "triggerTime": "1786000000000",
            "triggerPx": "99",
            "slTriggerPrice": "99",
            "tpTriggerPrice": "105",
            "errorCode": "0",
        },
        {
            "ordId": "tp",
            "ordType": "TPSL",
            "posSide": "long",
            "triggerTime": "1786000001000",
            "triggerPx": "105",
            "slTriggerPrice": "99",
            "tpTriggerPrice": "105",
            "errorCode": "0",
        },
        {
            "ordId": "pending",
            "ordType": "TPSL",
            "posSide": "long",
            "triggerTime": "0",
            "triggerPx": "0",
            "slTriggerPrice": "98",
            "errorCode": "0",
        },
        {
            "ordId": "failed",
            "ordType": "TPSL",
            "posSide": "long",
            "triggerTime": "1786000002000",
            "triggerPx": "97",
            "slTriggerPrice": "97",
            "errorCode": "4",
        },
    ]

    events = _confirmed_stop_events("BTC/USDT", orders)

    assert [event["order_id"] for event in events] == ["sl"]
    assert events[0]["direction"] == "Long"
    assert events[0]["trigger_price"] == 99


def test_stop_matching_requires_adverse_price_and_close_proximity():
    position = {
        "id": 1,
        "symbol": "BTC/USDT",
        "direction": "Long",
        "entry_datetime": "2026-08-05T00:00:00Z",
        "datetime": "2026-08-05T01:00:00Z",
        "entry_price": 100,
        "exit_price": 98.9,
    }
    events = {
        "BTC/USDT": [
            {
                "symbol": "BTC/USDT",
                "direction": "Long",
                "trigger_time": 1785891600000,
                "trigger_price": 99,
                "order_id": "confirmed-stop",
            },
            {
                "symbol": "BTC/USDT",
                "direction": "Long",
                "trigger_time": 1785891600000,
                "trigger_price": 101,
                "order_id": "profitable-trailing-stop",
            },
        ]
    }

    matches = _match_confirmed_stops([position], events)

    assert len(matches) == 1
    assert matches[0][1]["order_id"] == "confirmed-stop"


def test_stop_classification_uses_one_percent_opposite_move_for_good_stop():
    assert _classify_stop(True, 2.5, 0.5, 0.99, None) == "false_stop"
    assert _classify_stop(True, 2.5, 0.5, 1.0, None) == "good_stop"
    assert _classify_stop(False, 0.5, 2.5, 1.2, 3) == "reversal_opportunity"
    assert _classify_stop(False, 0.5, 2.5, 0.9, 3) == "noise_chop"


def test_stop_summary_keeps_pending_candles_out_of_class_percentages():
    items = [
        {"classification": "false_stop"},
        {"classification": "good_stop"},
        {"classification": "insufficient_data"},
    ]

    summary = _summary(items)

    assert summary["confirmed_stop_count"] == 3
    assert summary["classified_stop_count"] == 2
    assert summary["pending_stop_count"] == 1
    assert summary["class_pct"]["false_stop"] == 50
