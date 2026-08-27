#!/usr/bin/env python3
"""Ensure all user-facing application version declarations stay in sync."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Dict


ROOT = Path(__file__).resolve().parents[1]
VERSION = re.compile(r"\bv?(\d+\.\d+\.\d+)\b")


def _version_from_text(path: Path, pattern: re.Pattern[str] = VERSION) -> str:
    match = pattern.search(path.read_text(encoding="utf-8"))
    if not match:
        raise ValueError(f"No semantic version found in {path.relative_to(ROOT)}")
    return match.group(1)


def main() -> None:
    frontend_package = json.loads((ROOT / "frontend/package.json").read_text(encoding="utf-8"))
    lockfile = json.loads((ROOT / "frontend/package-lock.json").read_text(encoding="utf-8"))
    versions: Dict[str, str] = {
        "frontend/package.json": str(frontend_package["version"]),
        "frontend/package-lock.json": str(lockfile["version"]),
        "frontend/package-lock.json package root": str(lockfile["packages"][""]["version"]),
        "backend/main.py": _version_from_text(
            ROOT / "backend/main.py", re.compile(r"version\s*=\s*[\"'](\d+\.\d+\.\d+)[\"']"),
        ),
        "README.md": _version_from_text(ROOT / "README.md"),
        "ARCHITECTURE.md": _version_from_text(ROOT / "ARCHITECTURE.md"),
    }
    expected = next(iter(versions.values()))
    mismatches = {name: version for name, version in versions.items() if version != expected}
    if mismatches:
        print("Release version guard failed. Expected one shared version:")
        for name, version in versions.items():
            print(f"  - {name}: {version}")
        sys.exit(1)

    print(f"Release version guard passed: v{expected}")


if __name__ == "__main__":
    main()
