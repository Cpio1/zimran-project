"""FastAPI application entry point."""

from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.schemas import CONTRACT_VERSION, HealthEnvelope

app = FastAPI(title="Claimly Backend API", version=CONTRACT_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["GET"],
    allow_headers=["Content-Type"],
    expose_headers=["X-Contract-Version"],
)


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
