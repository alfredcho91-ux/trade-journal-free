from __future__ import annotations

from backend.utils import cache as cache_module


def test_data_cache_is_lazy_at_construction(monkeypatch):
    called = False

    def fake_cache(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("disk cache should not initialize during construction")

    monkeypatch.setattr(cache_module, "DISKCACHE_AVAILABLE", True)
    monkeypatch.setattr(cache_module, "Cache", fake_cache)

    cache = cache_module.DataCache(cache_dir="/tmp/should-not-open-at-init")

    assert called is False
    assert cache._cache_ready is False


def test_data_cache_falls_back_to_memory_when_diskcache_fails(monkeypatch, tmp_path):
    def fake_cache(*args, **kwargs):
        raise RuntimeError("readonly database")

    monkeypatch.setattr(cache_module, "DISKCACHE_AVAILABLE", True)
    monkeypatch.setattr(cache_module, "Cache", fake_cache)

    cache = cache_module.DataCache(cache_dir=str(tmp_path / "cache"))

    assert cache.get("missing") is None
    cache.set("foo", "bar")

    assert cache.get("foo") == "bar"
    assert cache.stats()["persistent"] is False
