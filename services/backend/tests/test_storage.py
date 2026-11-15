"""Supabase REST requests are exercised through an in-memory HTTP transport."""

import httpx
import pytest
import logging
import socket
import ssl

from app.config import ConfigurationError, StorageSettings
from app.storage import StorageClient, StorageError

SETTINGS = StorageSettings("https://synthetic.supabase.co", "sb_secret_test_only")


def test_upload_uses_secret_apikey_no_bearer_and_no_upsert():
    seen = []

    def handler(request):
        seen.append(request)
        assert request.headers["apikey"] == "sb_secret_test_only"
        assert "authorization" not in request.headers
        if request.method == "GET":
            return httpx.Response(200, json={"id": "claimly-documents", "public": False})
        assert request.headers["x-upsert"] == "false"
        assert request.headers["content-type"] == "application/pdf"
        assert request.content == b"synthetic"
        return httpx.Response(200, json={})

    storage = StorageClient(SETTINGS, httpx.MockTransport(handler))
    storage.ensure_private()
    storage.upload("workspace/entry/uuid.pdf", b"synthetic", "application/pdf")
    assert seen[1].url.path == "/storage/v1/object/claimly-documents/workspace/entry/uuid.pdf"
    assert "sb_secret_test_only" not in repr(SETTINGS)


@pytest.mark.parametrize("body", [{"id": "claimly-documents", "public": True},
                                  {"id": "claimly-documents"}, {"public": False}])
def test_public_or_unverifiable_bucket_rejected(body):
    storage = StorageClient(SETTINGS, httpx.MockTransport(lambda request: httpx.Response(200, json=body)))
    with pytest.raises(StorageError):
        storage.ensure_private()


@pytest.mark.parametrize("status", [301, 401, 403, 500])
def test_http_errors_and_redirects_are_sanitized(status):
    storage = StorageClient(SETTINGS, httpx.MockTransport(lambda request:
        httpx.Response(status, text="remote-private-information", headers={"Location": "https://other.invalid"})))
    with pytest.raises(StorageError) as error:
        storage.ensure_private()
    assert "remote-private-information" not in error.value.message


def test_timeout_is_sanitized():
    def fail(request):
        raise httpx.ReadTimeout("private details")
    with pytest.raises(StorageError):
        StorageClient(SETTINGS, httpx.MockTransport(fail)).upload("safe.pdf", b"test", "application/pdf")


@pytest.mark.parametrize("url,key", [("http://example.com", "sb_secret_test"),
                                    ("https://[invalid", "sb_secret_test"),
                                    ("https://example.com", "sb_publishable_test"),
                                    ("https://user:password@example.com", "sb_secret_test")])
def test_unsafe_configuration_rejected(url, key):
    with pytest.raises(ConfigurationError):
        StorageSettings(url, key)


@pytest.mark.parametrize("status,code,category", [
    (400, "NoSuchBucket", "not_found"), (401, "InvalidJWT", "authentication"),
    (403, "AccessDenied", "permission"), (404, None, "not_found"),
    (429, "SlowDown", "rate_limit"), (503, "InternalError", "upstream"),
    (302, None, "redirect_rejected"), (409, "ResourceAlreadyExists", "conflict"),
    (413, "EntityTooLarge", "size_limit"),
])
def test_safe_logs_include_real_status_and_known_category(caplog, status, code, category):
    caplog.set_level(logging.WARNING, logger="uvicorn.error.claimly.storage")
    marker = "sensitive-remote-details"
    transport = httpx.MockTransport(lambda request: httpx.Response(status,
        json={"code": code, "message": marker}, headers={"Authorization": marker}))
    with pytest.raises(StorageError) as caught:
        StorageClient(SETTINGS, transport).ensure_private()
    assert caught.value.category == category
    assert caught.value.http_status == status
    assert f"http_status={status}" in caplog.text
    assert f"category={category}" in caplog.text
    assert "operation=bucket_check" in caplog.text
    assert marker not in caplog.text
    assert SETTINGS.secret_key not in caplog.text
    assert SETTINGS.url not in caplog.text
    assert not any(record.exc_info for record in caplog.records)


def test_unknown_response_code_and_url_path_never_reach_logs(caplog):
    marker = "private-path-token"
    storage = StorageClient(SETTINGS, httpx.MockTransport(lambda request:
        httpx.Response(400, json={"code": marker, "message": marker})))
    with pytest.raises(StorageError):
        storage.upload(marker, b"test", "application/pdf")
    assert marker not in caplog.text
    assert "storage_code=none" in caplog.text
    assert "operation=upload" in caplog.text


@pytest.mark.parametrize("error,category", [
    (httpx.ReadTimeout("sensitive-transport-details"), "timeout"),
    (httpx.ConnectTimeout("sensitive-transport-details"), "timeout"),
    (httpx.ProxyError("sensitive-transport-details"), "proxy"),
    (httpx.ConnectError("[WinError 10013] sensitive-transport-details"), "network_denied"),
    (httpx.ConnectError("sensitive-transport-details"), "network"),
])
def test_transport_error_categories_are_sanitized(caplog, error, category):
    def fail(request):
        raise error
    with pytest.raises(StorageError) as caught:
        StorageClient(SETTINGS, httpx.MockTransport(fail)).ensure_private()
    assert caught.value.category == category
    assert caught.value.http_status is None
    assert "http_status=none" in caplog.text
    assert "sensitive-transport-details" not in caplog.text


@pytest.mark.parametrize("native,expected", [
    (ssl.SSLCertVerificationError("private-tls-details"), "tls_certificate"),
    (socket.gaierror(-2, "private-dns-details"), "dns"),
])
def test_wrapped_native_errors_are_classified_without_raw_logging(caplog, native, expected):
    def fail(request):
        raise httpx.ConnectError("private-wrapper-details") from native
    with pytest.raises(StorageError) as caught:
        StorageClient(SETTINGS, httpx.MockTransport(fail)).ensure_private()
    assert caught.value.category == expected
    assert "private-" not in caplog.text


@pytest.mark.parametrize("response,expected", [
    (httpx.Response(200, text="private-invalid-json"), "invalid_bucket_response"),
    (httpx.Response(200, json=[]), "invalid_bucket_response"),
    (httpx.Response(200, json={"id": "claimly-documents"}), "invalid_bucket_response"),
    (httpx.Response(200, json={"id": "claimly-documents", "public": True}), "bucket_not_private"),
    (httpx.Response(200, json={"id": "other-bucket", "public": False}), "bucket_mismatch"),
])
def test_bucket_metadata_failures_have_actionable_categories(caplog, response, expected):
    with pytest.raises(StorageError) as caught:
        StorageClient(SETTINGS, httpx.MockTransport(lambda request: response)).ensure_private()
    assert caught.value.category == expected
    assert "http_status=200" in caplog.text
    assert "private-invalid-json" not in caplog.text
    assert "other-bucket" not in caplog.text


def test_api_url_suffix_is_rejected():
    with pytest.raises(ConfigurationError):
        StorageSettings("https://synthetic.supabase.co/rest/v1", "sb_secret_test_only")
