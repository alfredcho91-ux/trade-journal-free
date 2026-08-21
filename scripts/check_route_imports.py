#!/usr/bin/env python3
"""
Route Guard: router 레이어가 strategy 레이어를 직접 import하지 않는지 검증

허용 의존성 방향:
    router -> service -> strategy/core/utils
"""

import ast
import sys
from pathlib import Path
from typing import List, Tuple


def _collect_router_files(
    routes_dir: str = "backend/routes",
    modules_dir: str = "backend/modules",
) -> List[Path]:
    """Collect router files from compatibility routes and domain modules."""
    files: List[Path] = []

    routes_path = Path(routes_dir).resolve()
    if routes_path.exists():
        files.extend(routes_path.rglob("*.py"))

    modules_path = Path(modules_dir).resolve()
    if modules_path.exists():
        files.extend(modules_path.rglob("router.py"))

    # Deterministic order and dedupe
    return sorted({p.resolve() for p in files}, key=str)


def check_route_imports(
    routes_dir: str = "backend/routes",
    modules_dir: str = "backend/modules",
    forbidden_modules: List[str] = None,
) -> Tuple[bool, List[str]]:
    """
    router 파일에서 금지된 모듈 import를 AST 파싱으로 검사.

    Args:
        routes_dir: 검사할 compatibility routes 디렉토리 경로
        modules_dir: 검사할 domain modules 디렉토리 경로
        forbidden_modules: 금지된 루트 모듈 리스트 (기본값: ["strategy"])

    Returns:
        (성공 여부, 에러 메시지 리스트)
    """
    if forbidden_modules is None:
        forbidden_modules = ["strategy"]

    router_files = _collect_router_files(routes_dir=routes_dir, modules_dir=modules_dir)
    if not router_files:
        return True, []

    errors: List[str] = []
    cwd = Path.cwd().resolve()

    def _display_path(path: Path) -> str:
        try:
            return str(path.resolve().relative_to(cwd))
        except Exception:
            return str(path)

    for py_file in router_files:
        try:
            content = py_file.read_text(encoding="utf-8")
            tree = ast.parse(content, filename=str(py_file))

            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        module_root = alias.name.split(".")[0]
                        if module_root in forbidden_modules:
                            errors.append(
                                f"{_display_path(py_file)}:{node.lineno} imports '{alias.name}'"
                            )
                elif isinstance(node, ast.ImportFrom):
                    # 상대 import (from .strategy import ...)는 routes 내부 참조이므로 허용
                    if getattr(node, "level", 0) and node.level > 0:
                        continue
                    if node.module:
                        module_root = node.module.split(".")[0]
                        if module_root in forbidden_modules:
                            errors.append(
                                f"{_display_path(py_file)}:{node.lineno} imports from '{node.module}'"
                            )
        except SyntaxError as exc:
            errors.append(f"{_display_path(py_file)}: SyntaxError - {exc}")
        except Exception as exc:
            errors.append(f"{_display_path(py_file)}: Error - {exc}")

    return len(errors) == 0, errors


def main():
    success, errors = check_route_imports()

    if not success:
        print("❌ Architecture Violation: router layer cannot import strategy directly:")
        print()
        for error in errors:
            print(f"  {error}")
        print()
        print("💡 Use services layer as indirection: router -> service -> strategy/core.")
        sys.exit(1)

    print("✅ Route import guard passed.")
    print("   router layer (backend/routes + backend/modules/*/router.py) does not import strategy.")
    sys.exit(0)


if __name__ == "__main__":
    main()
