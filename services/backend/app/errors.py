"""Public errors contain curated messages, never external exception details."""

from uuid import uuid4

from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, retryable: bool = False):
        self.status, self.code, self.message, self.retryable = status, code, message, retryable


def error_response(error: ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status,
        content={"error": {"code": error.code, "message": error.message,
                           "retryable": error.retryable}, "request_id": str(uuid4())},
        headers={"X-Contract-Version": "2.0.0", **({"Retry-After": "60"} if error.status == 429 else {})},
    )
