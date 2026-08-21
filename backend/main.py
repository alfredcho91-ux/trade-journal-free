"""Trade Journal Free API."""

import secrets
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles

from backend.config.settings import (
    CORS_ORIGINS,
    PROJECT_ROOT,
    get_app_environment,
    get_basic_auth_credentials,
)
from backend.modules.deepcoin.router import router as deepcoin_router
from backend.modules.indicators.router import router as indicators_router
from backend.modules.journal.router import router as journal_router

security = HTTPBasic(auto_error=False)

if get_app_environment() == "production":
    get_basic_auth_credentials()


def verify_credentials(
    credentials: Optional[HTTPBasicCredentials] = Depends(security),
):
    """Require Basic Auth outside local development."""
    if get_app_environment() != "production":
        return "local_dev"
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
    title="Trade Journal Free API",
    description="Read-only Deepcoin journal and personal trade analytics",
    version="1.0.0",
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


@app.get("/api/health", dependencies=[])
def health():
    return {"success": True, "data": {"service": "trade-journal-free"}}

app.include_router(journal_router)
app.include_router(deepcoin_router)
app.include_router(indicators_router)

frontend_dist = PROJECT_ROOT / "frontend" / "dist"
frontend_dist.mkdir(parents=True, exist_ok=True)
app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
