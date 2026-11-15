"""Minimal server-only Supabase Storage REST adapter, with redirects disabled."""

from urllib.parse import quote
import logging
import socket
import ssl

import httpx

from app.config import StorageSettings
from app.errors import ApiError

logger = logging.getLogger("uvicorn.error.claimly.storage")

# Only known protocol codes may reach logs; response messages and headers never do.
KNOWN_CODES = frozenset({
    "InvalidJWT", "AccessDenied", "NoSuchBucket", "NoSuchKey", "TenantNotFound",
    "InvalidApiKey", "Unauthorized", "InvalidRequest", "EntityTooLarge", "InternalError",
    "ResourceAlreadyExists", "KeyAlreadyExists", "InvalidMimeType", "DatabaseTimeout",
    "SignatureDoesNotMatch", "DatabaseError", "SlowDown", "not_found", "unauthorized",
    "already_exists", "BucketNotFound", "InvalidSignature",
})


def transport_category(error: httpx.HTTPError) -> str:
    if isinstance(error, httpx.TimeoutException):
        return "timeout"
    if isinstance(error, httpx.ProxyError):
        return "proxy"
    current, seen = error, set()
    for _ in range(10):
        if current is None or id(current) in seen:
            break
        seen.add(id(current))
        # HTTP libraries may wrap native exceptions or retain only their message.
        detail = str(current).lower()
        if isinstance(current, ssl.SSLCertVerificationError) or "certificate_verify_failed" in detail:
            return "tls_certificate"
        if isinstance(current, ssl.SSLError):
            return "tls"
        if isinstance(current, socket.gaierror) or "getaddrinfo" in detail or "name resolution" in detail:
            return "dns"
        if getattr(current, "winerror", None) == 10013 or "10013" in detail:
            return "network_denied"
        current = current.__cause__ or current.__context__
    return "network" if isinstance(error, httpx.ConnectError) else "transport"


def http_category(status: int, code: str | None) -> str:
    if status == 401 or code in {"InvalidJWT", "InvalidApiKey", "Unauthorized"}:
        return "authentication"
    if status == 403 or code in {"AccessDenied", "unauthorized"}:
        return "permission"
    if status == 404 or code in {"NoSuchBucket", "BucketNotFound", "not_found"}:
        return "not_found"
    if status == 409:
        return "conflict"
    if status == 413:
        return "size_limit"
    if status == 429 or code == "SlowDown":
        return "rate_limit"
    if 300 <= status < 400:
        return "redirect_rejected"
    return "upstream" if status >= 500 else "invalid_request"


class StorageError(ApiError):
    def __init__(self, category="unknown", http_status=None, operation="unknown", storage_code=None):
        super().__init__(503, "INTERNAL_ERROR", "Private file storage is unavailable. Retry later.", True)
        self.category = category
        self.http_status = http_status
        self.operation = operation
        self.storage_code = storage_code


def fail(operation, category, http_status=None, storage_code=None):
    logger.warning("storage_failure operation=%s category=%s http_status=%s storage_code=%s",
                   operation, category, http_status if http_status is not None else "none",
                   storage_code or "none")
    raise StorageError(category, http_status, operation, storage_code) from None


class StorageClient:
    def __init__(self, settings: StorageSettings, transport=None):
        self.settings = settings
        self.transport = transport

    def _request(self, method, path, *, operation, **kwargs):
        try:
            with httpx.Client(base_url=self.settings.url.rstrip("/") + "/storage/v1/",
                              headers={"apikey": self.settings.secret_key},
                              timeout=httpx.Timeout(30, connect=10), follow_redirects=False,
                              transport=self.transport) as client:
                response = client.request(method, path, **kwargs)
            if not response.is_success:
                try:
                    body = response.json()
                    candidate = (body.get("code") or body.get("error")) if isinstance(body, dict) else None
                    code = candidate if isinstance(candidate, str) and candidate in KNOWN_CODES else None
                except ValueError:
                    code = None
                fail(operation, http_category(response.status_code, code), response.status_code, code)
            return response
        except httpx.HTTPError as error:
            fail(operation, transport_category(error))

    def ensure_private(self):
        response = self._request("GET", "bucket/" + quote(self.settings.bucket, safe=""), operation="bucket_check")
        try:
            bucket = response.json()
            if not isinstance(bucket, dict):
                fail("bucket_check", "invalid_bucket_response", response.status_code)
            if bucket.get("id") != self.settings.bucket:
                fail("bucket_check", "bucket_mismatch", response.status_code)
            if bucket.get("public") is True:
                fail("bucket_check", "bucket_not_private", response.status_code)
            if bucket.get("public") is not False:
                fail("bucket_check", "invalid_bucket_response", response.status_code)
        except (ValueError, AttributeError):
            fail("bucket_check", "invalid_bucket_response", response.status_code)

    def upload(self, path: str, content: bytes, mime_type: str):
        self._request("POST", "object/" + quote(self.settings.bucket, safe="") + "/" + quote(path, safe="/"),
                      operation="upload", content=content, headers={"Content-Type": mime_type, "x-upsert": "false"})

    def remove(self, bucket: str, path: str):
        # Recovery must use the bucket persisted with the intent, even if config changes.
        self._request("DELETE", "object/" + quote(bucket, safe=""), operation="recovery_delete", json={"prefixes": [path]})
