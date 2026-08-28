from pathlib import Path

from scripts import check_release_versions


ROOT = Path(__file__).resolve().parents[2]


def test_release_guard_includes_msix_manifest():
    versions = check_release_versions.collect_versions(ROOT)

    assert versions["packaging/AppxManifest.xml"] == versions["frontend/package.json"]


def test_release_guard_reports_mismatched_declaration(monkeypatch):
    declarations = {
        "frontend/package.json": "1.0.23",
        "frontend/package-lock.json": "1.0.23",
        "frontend/package-lock.json package root": "1.0.23",
        "backend/main.py": "1.0.23",
        "README.md": "1.0.22",
        "ARCHITECTURE.md": "1.0.23",
        "packaging/AppxManifest.xml": "1.0.23",
    }
    monkeypatch.setattr(check_release_versions, "collect_versions", lambda root: declarations)

    expected, mismatches, tag_mismatches = check_release_versions.check_versions(ROOT, check_tags=False)

    assert expected == "1.0.23"
    assert mismatches == {"README.md": "1.0.22"}
    assert tag_mismatches == {}


def test_release_guard_reports_frontend_package_drift(monkeypatch):
    declarations = {
        "frontend/package.json": "1.0.22",
        "frontend/package-lock.json": "1.0.23",
        "frontend/package-lock.json package root": "1.0.23",
        "backend/main.py": "1.0.23",
        "README.md": "1.0.23",
        "ARCHITECTURE.md": "1.0.23",
        "packaging/AppxManifest.xml": "1.0.23",
    }
    monkeypatch.setattr(check_release_versions, "collect_versions", lambda root: declarations)

    expected, mismatches, _ = check_release_versions.check_versions(ROOT, check_tags=False)

    assert expected == "1.0.22"
    assert mismatches == {
        "frontend/package-lock.json": "1.0.23",
        "frontend/package-lock.json package root": "1.0.23",
        "backend/main.py": "1.0.23",
        "README.md": "1.0.23",
        "ARCHITECTURE.md": "1.0.23",
        "packaging/AppxManifest.xml": "1.0.23",
    }


def test_release_guard_reports_architecture_drift(monkeypatch):
    declarations = {
        "frontend/package.json": "1.0.23",
        "frontend/package-lock.json": "1.0.23",
        "frontend/package-lock.json package root": "1.0.23",
        "backend/main.py": "1.0.23",
        "README.md": "1.0.23",
        "ARCHITECTURE.md": "1.0.22",
        "packaging/AppxManifest.xml": "1.0.23",
    }
    monkeypatch.setattr(check_release_versions, "collect_versions", lambda root: declarations)

    expected, mismatches, _ = check_release_versions.check_versions(ROOT, check_tags=False)

    assert expected == "1.0.23"
    assert mismatches == {"ARCHITECTURE.md": "1.0.22"}


def test_release_guard_reports_appx_manifest_drift(monkeypatch):
    declarations = {
        "frontend/package.json": "1.0.23",
        "frontend/package-lock.json": "1.0.23",
        "frontend/package-lock.json package root": "1.0.23",
        "backend/main.py": "1.0.23",
        "README.md": "1.0.23",
        "ARCHITECTURE.md": "1.0.23",
        "packaging/AppxManifest.xml": "1.0.22",
    }
    monkeypatch.setattr(check_release_versions, "collect_versions", lambda root: declarations)

    expected, mismatches, _ = check_release_versions.check_versions(ROOT, check_tags=False)

    assert expected == "1.0.23"
    assert mismatches == {"packaging/AppxManifest.xml": "1.0.22"}


def test_release_guard_reports_semantic_tag_drift(monkeypatch):
    class Result:
        stdout = "v1.0.24\n"

    monkeypatch.setattr(check_release_versions.subprocess, "run", lambda *args, **kwargs: Result())

    mismatches = check_release_versions.find_tag_mismatches(ROOT, "1.0.23")

    assert mismatches == {"v1.0.24": "1.0.24"}
