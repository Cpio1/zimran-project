"""Bound request bodies before multipart parsing and bound concurrent mutations."""

from threading import BoundedSemaphore

import anyio

from app.errors import ApiError, error_response
from app.file_validation import MAX_FILE_BYTES


class UploadGuard:
    def __init__(self, app):
        self.app = app
        self.slots = BoundedSemaphore(2)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST" or scope["path"] not in ("/api/v1/entries", "/api/v1/documents"):
            return await self.app(scope, receive, send)
        if not self.slots.acquire(blocking=False):
            return await error_response(ApiError(429, "RATE_LIMITED", "Demo is busy. Retry later.", True))(scope, receive, send)
        limit = MAX_FILE_BYTES + 64 * 1024 if scope["path"] == "/api/v1/documents" else 16 * 1024
        try:
            content = bytearray()
            try:
                with anyio.fail_after(15):
                    while True:
                        message = await receive()
                        if message["type"] == "http.disconnect":
                            return
                        chunk = message.get("body", b"")
                        if len(content) + len(chunk) > limit:
                            return await error_response(ApiError(413, "FILE_TOO_LARGE", "Request body exceeds the demo limit."))(scope, receive, send)
                        content.extend(chunk)
                        if not message.get("more_body", False):
                            break
            except TimeoutError:
                return await error_response(ApiError(408, "VALIDATION_ERROR", "Upload body timed out."))(scope, receive, send)
            delivered = False

            async def replay():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {"type": "http.request", "body": bytes(content), "more_body": False}
                return await receive()

            await self.app(scope, replay, send)
        finally:
            self.slots.release()
