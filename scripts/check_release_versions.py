#!/usr/bin/env python3
"""Ensure all user-facing application version declarations stay in sync."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple


ROOT = Path(__file__).resolve().parents[1]
VERSION = re.compile(r"\bv?(\d+\.\d+\.\d+)\b")


def _version_from_text(path: Path, pattern: re.Pattern[str] = VERSION, root: Path = ROOT) -> str:
    match = pattern.search(path.read_text(encoding="utf-8"))
    if not match:
        try:
            display_path = path.relative_to(root)
        except ValueError:
            display_path = path
        raise ValueError(f"No semantic version found in {display_path}")
    return match.group(1)


def collect_versions(root: Path = ROOT) -> Dict[str, str]:
    """Collect every version declaration that must agree for a release."""
    frontend_package = json.loads((root / "frontend/package.json").read_text(encoding="utf-8"))
    lockfile = json.loads((root / "frontend/package-lock.json").read_text(encoding="utf-8"))
    versions: Dict[str, str] = {
        "frontend/package.json": str(frontend_package["version"]),
        "frontend/package-lock.json": str(lockfile["version"]),
        "frontend/package-lock.json package root": str(lockfile["packages"][""]["version"]),
        "backend/main.py": _version_from_text(
            root / "backend/main.py", re.compile(r"version\s*=\s*[\"'](\d+\.\d+\.\d+)[\"']"), root,
        ),
        "README.md": _version_from_text(root / "README.md", root=root),
        "ARCHITECTURE.md": _version_from_text(root / "ARCHITECTURE.md", root=root),
        "packaging/AppxManifest.xml": _version_from_text(
            root / "packaging/AppxManifest.xml",
            re.compile(r'\bVersion\s*=\s*"(\d+\.\d+\.\d+)(?:\.0)?"'),
            root,
        ),
    }
    return versions


def find_tag_mismatches(root: Path, expected: str) -> Dict[str, str]:
    """Return semantic version tags on HEAD that disagree with the source version."""
    try:
        result = subprocess.run(
            ["git", "tag", "--points-at", "HEAD"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return {}

    tags = [tag.strip() for tag in result.stdout.splitlines() if tag.strip()]
    semantic_tags = [tag for tag in tags if re.fullmatch(r"v\d+\.\d+\.\d+", tag)]
    return {tag: tag[1:] for tag in semantic_tags if tag[1:] != expected}


def check_versions(root: Path = ROOT, check_tags: bool = True) -> Tuple[str, Dict[str, str], Dict[str, str]]:
    versions = collect_versions(root)
    expected = next(iter(versions.values()))
    mismatches = {name: version for name, version in versions.items() if version != expected}
    tag_mismatches = find_tag_mismatches(root, expected) if check_tags else {}
    return expected, mismatches, tag_mismatches


def main(argv: Optional[List[str]] = None) -> None:
    root = ROOT
    if argv:
        root = Path(argv[0]).resolve()
    expected, mismatches, tag_mismatches = check_versions(root)
    if mismatches:
        print("Release version guard failed. Expected one shared version:")
        for name, version in collect_versions(root).items():
            print(f"  - {name}: {version}")
        sys.exit(1)
    if tag_mismatches:
        print("Release version guard failed. A semantic tag on HEAD disagrees with source:")
        for tag, version in tag_mismatches.items():
            print(f"  - {tag}: {version} (source: {expected})")
        sys.exit(1)

    print(f"Release version guard passed: v{expected}")


if __name__ == "__main__":
    main()
