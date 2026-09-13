"""Serve browser routes from the bundled frontend without masking API 404s."""

from starlette.responses import Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope


class FrontendStaticFiles(StaticFiles):
    """Allow direct entry and refresh for the screens in frontend/src/App.tsx."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        if path in {
            "journal", "trade-analysis", "risk-lab", "plan-lab",
            "trade-explorer", "hold-reentry", "playbook",
        }:
            path = "index.html"
        return await super().get_response(path, scope)
