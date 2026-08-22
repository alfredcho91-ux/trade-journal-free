from __future__ import annotations

from backend.desktop_instance import DesktopInstance


def test_desktop_instance_prevents_second_process_lock(tmp_path):
    first = DesktopInstance(tmp_path)
    second = DesktopInstance(tmp_path)

    assert first.acquire() is True
    try:
        assert second.acquire() is False
    finally:
        first.release()

    assert second.acquire() is True
    second.release()


def test_desktop_instance_publishes_and_removes_metadata(tmp_path):
    instance = DesktopInstance(tmp_path)
    assert instance.acquire() is True

    instance.publish("http://127.0.0.1:5181")
    assert instance.metadata_path.read_text(encoding="utf-8").find("127.0.0.1:5181") >= 0

    instance.release()
    assert not instance.metadata_path.exists()
