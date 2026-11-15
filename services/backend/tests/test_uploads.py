"""HTTP/contract tests with both external systems replaced by explicit fakes."""

import io
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from PIL import Image
from pypdf import PdfWriter

from app.errors import ApiError
from app.file_validation import MAX_FILE_BYTES
from app.main import app
from app.routes import get_repository, get_storage
from app.storage import StorageError
from app.upload_service import upload_document

NOW = "2026-11-15T12:00:00Z"
ENTRY_ID = str(uuid4())
DOCUMENT_ID = str(uuid4())
JOB_ID = str(uuid4())
DOCUMENT = {"id": DOCUMENT_ID, "entry_id": ENTRY_ID, "name": "sample.pdf",
            "mime_type": "application/pdf", "version": 1, "status": "uploaded", "page_count": 1,
            "facts": {}, "review_flags": [], "created_at": NOW}
JOB = {"id": JOB_ID, "kind": "extract", "status": "queued", "progress": None, "result": None,
       "error": None, "created_at": NOW, "updated_at": NOW}


def pdf(pages=1):
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=100, height=100)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def contract_check(response, schema):
    contract = json.loads((Path(__file__).resolve().parents[3] / "front/contracts/backend.openapi.json").read_text(encoding="utf-8"))
    Draft202012Validator({"$ref": f"#/components/schemas/{schema}",
                          "components": contract["components"]}).validate(response.json())


@pytest.fixture
def api(monkeypatch):
    # Any accidental database connection fails before network or credential use.
    monkeypatch.setattr(psycopg, "connect", MagicMock(side_effect=AssertionError("Live DB forbidden in upload tests")))
    repository = MagicMock()
    repository.create_entry.side_effect = lambda body, key: {
        "id": ENTRY_ID, **body, "facts": {}, "data_version": 1,
        "document_ids": [], "benefit_ids": [], "created_at": NOW, "updated_at": NOW}
    repository.reserve_upload.return_value = {"path": "safe/uuid.pdf", "key_hash": "hashed-key"}
    repository.complete_upload.return_value = {"document": DOCUMENT, "job": JOB}
    repository.get_document.return_value = DOCUMENT
    repository.get_job.return_value = JOB
    storage = MagicMock()
    storage.settings.bucket = "claimly-documents"
    app.dependency_overrides[get_repository] = lambda: repository
    app.dependency_overrides[get_storage] = lambda: storage
    with TestClient(app) as client:
        yield client, repository, storage
    app.dependency_overrides.clear()


def upload(client, content=None, mime="application/pdf", entry=ENTRY_ID, key="upload-key-001"):
    return client.post("/api/v1/documents", data={"entry_id": entry},
                       files={"file": ("sample.pdf", pdf() if content is None else content, mime)},
                       headers={"Idempotency-Key": key})


def test_create_entry_without_session(api):
    client, repository, _ = api
    response = client.post("/api/v1/entries", json={"title": "Synthetic sample", "category": "other"},
                           headers={"Idempotency-Key": "entry-key-001"})
    assert response.status_code == 201
    contract_check(response, "EntryEnvelope")
    assert response.headers["X-Contract-Version"] == "2.0.0"
    assert repository.create_entry.call_args.args[0]["provider"] is None


def test_successful_upload_and_status_endpoints(api):
    client, repository, storage = api
    response = upload(client)
    assert response.status_code == 202
    contract_check(response, "UploadAcceptedEnvelope")
    assert response.json()["data"]["job"]["status"] == "queued"
    assert response.json()["data"]["job"]["result"] is None
    assert "storage_path" not in response.text and "secret" not in response.text
    storage.ensure_private.assert_called_once()
    storage.upload.assert_called_once()
    repository.complete_upload.assert_called_once()
    for path, schema in [(f"/api/v1/documents/{DOCUMENT_ID}", "DocumentEnvelope"),
                         (f"/api/v1/jobs/{JOB_ID}", "JobEnvelope")]:
        result = client.get(path)
        assert result.status_code == 200
        contract_check(result, schema)


@pytest.mark.parametrize("content,mime,expected", [
    (b"", "application/pdf", 422), (b"hello", "text/plain", 422),
    (b"hello", "application/pdf", 422), (b"%PDF-not-a-real-pdf", "application/pdf", 422),
    (b"x" * (MAX_FILE_BYTES + 1), "application/pdf", 413),
    (b"x" * (MAX_FILE_BYTES + 100_000), "application/pdf", 413),
])
def test_invalid_or_oversized_upload_never_reaches_storage(api, content, mime, expected):
    client, repository, storage = api
    response = upload(client, content, mime)
    assert response.status_code == expected
    contract_check(response, "ErrorEnvelope")
    storage.upload.assert_not_called()
    repository.reserve_upload.assert_not_called()


@pytest.mark.parametrize("fmt,mime", [("JPEG", "image/jpeg"), ("PNG", "image/png")])
def test_real_image_formats_accepted(api, fmt, mime):
    client, repository, _ = api
    buffer = io.BytesIO()
    Image.new("RGB", (4, 4)).save(buffer, format=fmt)
    assert upload(client, buffer.getvalue(), mime).status_code == 202
    assert repository.reserve_upload.call_args.args[1].mime_type == mime


def test_page_limit(api):
    client, _, storage = api
    assert upload(client, pdf(26)).status_code == 422
    storage.upload.assert_not_called()


@pytest.mark.parametrize("status,code", [(404, "NOT_FOUND"), (403, "FORBIDDEN"), (429, "RATE_LIMITED")])
def test_missing_entry_sample_protection_and_capacity(api, status, code):
    client, repository, storage = api
    repository.reserve_upload.side_effect = ApiError(status, code, "Upload rejected.")
    response = upload(client)
    assert response.status_code == status
    contract_check(response, "ErrorEnvelope")
    storage.upload.assert_not_called()


def test_storage_failure_preserves_recovery_intent(api):
    client, repository, storage = api
    storage.upload.side_effect = StorageError()
    response = upload(client)
    assert response.status_code == 503
    repository.mark_cleanup.assert_called_once_with("hashed-key")
    repository.complete_upload.assert_not_called()
    contract_check(response, "ErrorEnvelope")


def test_database_finalization_failure_does_not_delete_possibly_committed_file(api):
    client, repository, storage = api
    repository.complete_upload.side_effect = psycopg.OperationalError("private driver details")
    response = upload(client)
    assert response.status_code == 503
    assert "private driver details" not in response.text
    storage.remove.assert_not_called()


def test_idempotent_upload_replays_without_sending_file_again(api):
    client, repository, storage = api
    repository.reserve_upload.return_value = {"cached": {"document": DOCUMENT, "job": JOB}}
    assert upload(client).status_code == 202
    storage.upload.assert_not_called()
    repository.complete_upload.assert_not_called()


def test_missing_key_and_invalid_entry_id(api):
    client, repository, storage = api
    response = client.post("/api/v1/entries", json={"title": "test", "category": "other"})
    assert response.status_code == 422
    assert upload(client, entry="not-a-uuid").status_code == 422
    storage.upload.assert_not_called()
    repository.create_entry.assert_not_called()


def test_multiple_files_rejected(api):
    client, _, storage = api
    response = client.post("/api/v1/documents", data={"entry_id": ENTRY_ID},
                           files=[("file", ("a.pdf", pdf(), "application/pdf")),
                                  ("file", ("b.pdf", pdf(), "application/pdf"))],
                           headers={"Idempotency-Key": "upload-key-001"})
    assert response.status_code == 422
    storage.upload.assert_not_called()


def test_rate_limit_and_cors(api):
    client, repository, _ = api
    preflight = client.options("/api/v1/documents", headers={"Origin": "http://localhost:3000",
        "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Idempotency-Key,Content-Type"})
    assert preflight.status_code == 200
    repository.admit.side_effect = ApiError(429, "RATE_LIMITED", "Try later.", True)
    response = upload(client)
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "60"


def test_failed_tracking_update_leaves_original_intent_without_finalization():
    repository, storage = MagicMock(), MagicMock()
    repository.reserve_upload.return_value = {"key_hash": "key", "path": "path"}
    storage.upload.side_effect = StorageError()
    repository.mark_cleanup.side_effect = psycopg.OperationalError("unavailable")
    with pytest.raises(psycopg.Error):
        upload_document(repository, storage, ENTRY_ID, SimpleNamespace(content=b"test", mime_type="application/pdf"), "key")
    repository.complete_upload.assert_not_called()
