"""Local browser mutation boundary; CORS is not request authorization."""

import os
from urllib.parse import urlsplit

from starlette.requests import Request
from starlette.responses import JSONResponse

from backend.config.settings import CORS_ORIGINS, IS_FROZEN, get_app_environment

LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def _origin(value):
    """Strict origin (not a URL with credentials/path or an opaque origin)."""
    if not value or any(char.isspace() for char in value) or "\\" in value:
        return None
    try:
        parsed = urlsplit(value)
        if (parsed.scheme not in {"http", "https"} or not parsed.hostname
                or parsed.username is not None or parsed.password is not None
                or parsed.path or parsed.query or parsed.fragment or "?" in value or "#" in value):
            return None
        port = parsed.port
        if port == 0:
            return None
        return parsed.scheme, parsed.hostname.lower(), port if port is not None else (443 if parsed.scheme == "https" else 80)
    except ValueError:
        return None


def local_request_error(request):
    if get_app_environment() == "production":
        return None  # Existing application-wide Basic Auth remains mandatory.
    client = request.client.host if request.client else ""
    if client not in {"127.0.0.1", "::1", "testclient"}:
        return "Local mode requires a loopback client"
    hosts = request.headers.getlist("host")
    authority = _origin(f"{request.url.scheme}://{hosts[0]}") if len(hosts) == 1 else None
    # Starlette's in-process test transport is not a network-accessible host.
    test_transport = client == "testclient" and authority and authority[1] == "testserver"
    if not authority or (authority[1] not in LOOPBACK_HOSTS and not test_transport):
        return "Invalid local Host"
    if request.method in SAFE_METHODS:
        return None
    origins = request.headers.getlist("origin")
    if not origins:
        # Native/CLI calls do not send Origin. Browser requests explicitly
        # marked cross-site/same-site must not use that compatibility exception.
        if request.headers.get("sec-fetch-site", "none") not in {"none", "same-origin"}:
            return "Cross-site local mutation is not allowed"
        return None
    origin = _origin(origins[0]) if len(origins) == 1 else None
    if not origin or origin[1] not in LOOPBACK_HOSTS:
        return "Untrusted local Origin"
    allowed = {authority}
    packaged = IS_FROZEN or getattr(request.app.state, "desktop_server", None) is not None
    if not packaged:
        # Vite defaults to 5181 and proxies to backend 8011 with changeOrigin.
        # Custom frontend ports use the same JOURNAL_FRONTEND_PORT setting.
        port = os.getenv("JOURNAL_FRONTEND_PORT", "5181")
        configured = [*CORS_ORIGINS, f"http://127.0.0.1:{port}", f"http://localhost:{port}", f"http://[::1]:{port}"]
        allowed.update(parsed for value in configured if (parsed := _origin(value)) and parsed[1] in LOOPBACK_HOSTS)
    return None if origin in allowed else "Untrusted local Origin"


class LocalRequestSecurityMiddleware:
    """Protect present and future routes before routing/body parsing."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            error = local_request_error(Request(scope))
            if error:
                response = JSONResponse({"success": False, "error": error, "error_code": "LOCAL_REQUEST_FORBIDDEN"}, status_code=403)
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
