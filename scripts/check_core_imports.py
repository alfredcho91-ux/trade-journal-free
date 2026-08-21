#!/usr/bin/env python3
"""
Core Guard: core/ 디렉토리가 backend/를 import하지 않는지 검증

사용법:
    python3 scripts/check_core_imports.py

또는:
    chmod +x scripts/check_core_imports.py
    ./scripts/check_core_imports.py

CI/CD 통합:
    .github/workflows/test.yml에서 사용 가능
"""

import ast
import sys
from pathlib import Path
from typing import List, Tuple


def check_core_imports(
    core_dir: str = "core",
    forbidden_modules: List[str] = None
) -> Tuple[bool, List[str]]:
    """
    core/ 디렉토리에서 금지된 모듈 import를 AST 파싱으로 검사

    Args:
        core_dir: 검사할 core 디렉토리 경로
        forbidden_modules: 금지된 모듈 리스트 (기본값: ["backend", "frontend", "fastapi"])

    Returns:
        (성공 여부, 에러 메시지 리스트)
    """
    if forbidden_modules is None:
        forbidden_modules = ["backend", "frontend", "fastapi"]

    core_path = Path(core_dir)
    if not core_path.exists():
        return True, []  # core 디렉토리가 없으면 통과

    errors = []

    for py_file in core_path.rglob("*.py"):
        try:
            with open(py_file, "r", encoding="utf-8") as f:
                content = f.read()
                tree = ast.parse(content, filename=str(py_file))

            # AST를 순회하며 import 구문 찾기
            for node in ast.walk(tree):
                # import backend 형태
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        module = alias.name.split('.')[0]  # backend.utils → backend
                        if module in forbidden_modules:
                            errors.append(
                                f"{py_file.relative_to(Path.cwd())}:{node.lineno} "
                                f"imports '{module}' (line: {node.lineno})"
                            )

                # from backend import ... 형태
                elif isinstance(node, ast.ImportFrom):
                    if node.module:
                        module = node.module.split('.')[0]  # backend.utils → backend
                        if module in forbidden_modules:
                            errors.append(
                                f"{py_file.relative_to(Path.cwd())}:{node.lineno} "
                                f"imports from '{module}' (line: {node.lineno})"
                            )

        except SyntaxError as e:
            # 파싱 실패는 무시 (다른 도구가 잡을 것)
            errors.append(
                f"{py_file.relative_to(Path.cwd())}: SyntaxError - {e}"
            )
        except Exception as e:
            # 기타 오류는 보고
            errors.append(
                f"{py_file.relative_to(Path.cwd())}: Error - {e}"
            )

    return len(errors) == 0, errors


def main():
    """메인 함수"""
    success, errors = check_core_imports()

    if not success:
        print("❌ Architecture Violation: 'core' cannot import from app layers:")
        print()
        for error in errors:
            print(f"  {error}")
        print()
        print("💡 'core' 디렉토리는 독립 라이브러리로 유지되어야 합니다.")
        print("   backend/ 또는 frontend/를 import하면 안 됩니다.")
        sys.exit(1)

    print("✅ Core isolation check passed.")
    print("   'core' 디렉토리가 backend/frontend를 import하지 않습니다.")
    sys.exit(0)


if __name__ == "__main__":
    main()
