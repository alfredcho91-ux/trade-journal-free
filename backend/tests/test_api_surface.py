from backend.main import app


def test_free_edition_exposes_only_journal_analysis_routes():
    actual = {
        (method, route.path)
        for route in app.routes
        if route.path.startswith("/api")
        for method in (route.methods or set())
        if method not in {"HEAD", "OPTIONS"}
    }
    expected = {
        ("GET", "/api/health"),
        ("POST", "/api/desktop/shutdown"),
        ("GET", "/api/journal"),
        ("DELETE", "/api/journal/{entry_id}"),
        ("GET", "/api/journal/current-market"),
        ("GET", "/api/journal/excursions"),
        ("GET", "/api/journal/performance"),
        ("GET", "/api/journal/quality-analysis"),
        ("GET", "/api/journal/behavior-analysis"),
        ("POST", "/api/journal/behavior-analysis/compare"),
        ("PATCH", "/api/journal/{entry_id}/behavior"),
        ("GET", "/api/journal/behavior-rules"),
        ("POST", "/api/journal/behavior-rules"),
        ("PATCH", "/api/journal/behavior-rules/{rule_id}"),
        ("DELETE", "/api/journal/behavior-rules/{rule_id}"),
        ("GET", "/api/journal/sl-tp-analysis"),
        ("GET", "/api/journal/stop-loss-analysis"),
        ("GET", "/api/journal/stop-optimization"),
        ("GET", "/api/deepcoin/status"),
        ("GET", "/api/deepcoin/open-positions"),
        ("POST", "/api/deepcoin/sync"),
        ("GET", "/api/deepcoin/trade-markers"),
        ("GET", "/api/exchanges"),
        ("GET", "/api/exchanges/executions"),
        ("GET", "/api/exchanges/open-positions"),
        ("POST", "/api/exchanges/{exchange_id}/credentials"),
        ("DELETE", "/api/exchanges/{exchange_id}/credentials"),
        ("POST", "/api/exchanges/{exchange_id}/sync"),
        ("GET", "/api/indicators/projection"),
        ("GET", "/api/indicators/trade-report/{coin}/{interval}"),
        ("GET", "/api/indicators/vpvr-source/{coin}/{interval}"),
        ("GET", "/api/indicators/vpvr/{coin}/{interval}"),
    }
    assert actual == expected
