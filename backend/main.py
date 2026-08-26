"""Trade Journal API."""

import secrets
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles

from backend.config.settings import (
    CORS_ORIGINS,
    FRONTEND_DIST_DIR,
    IS_FROZEN,
    get_app_environment,
    get_basic_auth_credentials,
)
from backend.modules.deepcoin.router import router as deepcoin_router
from backend.modules.exchanges.router import router as exchanges_router
from backend.modules.indicators.router import router as indicators_router
from backend.modules.journal.router import router as journal_router
from backend.modules.plan_lab.router import router as plan_lab_router
from backend.utils.log_redaction import install_log_redaction

install_log_redaction()

security = HTTPBasic(auto_error=False)

if get_app_environment() == "production":
    get_basic_auth_credentials()


def verify_credentials(
    request: Request,
    credentials: Optional[HTTPBasicCredentials] = Depends(security),
):
    """Require Basic Auth outside local development."""
    if get_app_environment() != "production":
        client = request.client.host if request.client else ""
        if client in {"127.0.0.1", "::1", "testclient"}:
            return "local_dev"
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Development mode only accepts loopback requests",
        )
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Basic"},
        )

    username, password = get_basic_auth_credentials()
    if not (
        secrets.compare_digest(credentials.username, username)
        and secrets.compare_digest(credentials.password, password)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username


app = FastAPI(
    title="Trade Journal API",
    description="Read-only multi-exchange journal and personal trade analytics",
    version="1.0.15",
    default_response_class=ORJSONResponse,
    dependencies=[Depends(verify_credentials)],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_request: Request, exc: RequestValidationError):
    """Return field errors without echoing credential or other request values."""
    fields = [
        {
            "location": [str(part) for part in error.get("loc", ())],
            "message": str(error.get("msg", "Invalid value")),
            "type": str(error.get("type", "validation_error")),
        }
        for error in exc.errors()
    ]
    return ORJSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "success": False,
            "error": "Request validation failed",
            "error_code": "VALIDATION_ERROR",
            "details": {"fields": fields},
        },
    )


@app.get("/api/health", dependencies=[])
def health():
    return {"success": True, "data": {"service": "trade-journal-free"}}


@app.post("/api/desktop/shutdown", dependencies=[])
def desktop_shutdown(request: Request):
    """Stop only the local packaged server; never remove exchange credentials."""
    client_host = request.client.host if request.client else ""
    if client_host not in {"127.0.0.1", "::1", "testclient"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Local requests only")

    server = getattr(request.app.state, "desktop_server", None)
    if server is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Desktop shutdown is unavailable")
    server.should_exit = True
    return {"success": True, "data": {"shutting_down": True}}

app.include_router(journal_router)
app.include_router(plan_lab_router)
app.include_router(exchanges_router)
app.include_router(deepcoin_router)
app.include_router(indicators_router)

if not FRONTEND_DIST_DIR.exists() and not IS_FROZEN:
    FRONTEND_DIST_DIR.mkdir(parents=True, exist_ok=True)
if not FRONTEND_DIST_DIR.is_dir():
    raise RuntimeError("Trade Journal Free frontend files are missing from this installation.")
app.mount("/", StaticFiles(directory=str(FRONTEND_DIST_DIR), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
