#!/usr/bin/env python3
"""Fail CI if the local Target R:R helper leaks outside the Plan Lab input UI.

Target R:R is an input-price preview. Official Plan R remains a backend
historical-path simulation result, so the local helper must never become an
API field or a downstream analytics input.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Iterable, List


ROOT = Path(__file__).resolve().parents[1]
TOKEN = re.compile(
    r"\b(?:targetRR|targetRiskReward|targetRiskRewardRatio|splitTargetR|split_target_r|target_rr)\b"
)
ALLOWED_FILES = {
    Path("frontend/src/features/planLab/pastTradePlan.ts"),
    Path("frontend/src/pages/PlanLabPage.tsx"),
    Path("frontend/src/pages/PlanLabPage.test.tsx"),
}


def _source_files() -> Iterable[Path]:
    yield from (ROOT / "backend").rglob("*.py")
    for suffix in ("*.ts", "*.tsx"):
        yield from (ROOT / "frontend/src").rglob(suffix)


def main() -> None:
    errors: List[str] = []
    for path in sorted(_source_files()):
        relative = path.relative_to(ROOT)
        text = path.read_text(encoding="utf-8")
        if TOKEN.search(text) and relative not in ALLOWED_FILES:
            errors.append(f"{relative}: Target R:R helper token is outside the input UI boundary")

    if errors:
        print("Target R:R isolation guard failed:")
        for error in errors:
            print(f"  - {error}")
        sys.exit(1)

    print("Target R:R isolation guard passed.")
    print("Local Target R:R tokens are confined to the Plan Lab input helper/UI.")


if __name__ == "__main__":
    main()
