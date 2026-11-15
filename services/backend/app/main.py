"""FastAPI application entry point."""

from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
import psycopg

from app.config import ConfigurationError
from app.database import DatabaseConnectionError
from app.errors import ApiError, error_response
from app.routes import router
from app.upload_guard import UploadGuard

from app.schemas import CONTRACT_VERSION, HealthEnvelope

app = FastAPI(title="Claimly Backend API", version=CONTRACT_VERSION,
    description="Shared public demo: do not upload personal or confidential documents. "
                "All uploaded documents belong to the shared workspace. AI analysis is not enabled yet.")
app.include_router(router)
app.add_middleware(UploadGuard)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Idempotency-Key"],
    expose_headers=["X-Contract-Version"],
)


@app.exception_handler(ApiError)
async def api_error_handler(request, error):
    return error_response(error)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request, error):
    return error_response(ApiError(422, "VALIDATION_ERROR", "Invalid request fields or missing Idempotency-Key."))


@app.exception_handler(HTTPException)
async def http_error_handler(request, error):
    code = "NOT_FOUND" if error.status_code == 404 else "VALIDATION_ERROR"
    return error_response(ApiError(error.status_code, code, "Request could not be handled."))


async def database_error_handler(request, error):
    return error_response(ApiError(503, "INTERNAL_ERROR",
        "Database unavailable or not configured. Check backend settings and migrations.", True))


@app.exception_handler(ConfigurationError)
async def configuration_error_handler(request, error):
    return error_response(ApiError(503, "INTERNAL_ERROR",
        "Backend configuration missing or invalid. Check database and Storage settings.", True))


for exception_type in (DatabaseConnectionError, psycopg.Error):
    app.add_exception_handler(exception_type, database_error_handler)


@app.middleware("http")
async def add_contract_version(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    response = await call_next(request)
    response.headers["X-Contract-Version"] = CONTRACT_VERSION
    return response


@app.get(
    "/health",
    response_model=HealthEnvelope,
    operation_id="backend_health",
    responses={
        200: {
            "headers": {
                "X-Contract-Version": {
                    "description": "Contract version",
                    "schema": {"type": "string", "const": CONTRACT_VERSION},
                }
            }
        }
    },
)
async def health() -> HealthEnvelope:
    """Report that the backend is running, without checking external services."""
    return HealthEnvelope()
