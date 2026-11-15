"""Exercise reservation/quota decisions with mocked PostgreSQL responses."""

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID

import pytest

from app.config import DEMO_WORKSPACE_ID
from app.errors import ApiError
from app.repository import Repository, digest

ENTRY = UUID("10000000-0000-4000-8000-000000000001")


def repository_with_rows(monkeypatch, rows):
    repository = Repository(SimpleNamespace(workspace_id=DEMO_WORKSPACE_ID))
    db = MagicMock()
    db.execute.return_value.fetchone.side_effect = rows

    @contextmanager
    def transaction(lock=False):
        assert lock
        yield db

    monkeypatch.setattr(repository, "transaction", transaction)
    return repository, db


def file():
    return SimpleNamespace(name="../../untrusted.pdf", mime_type="application/pdf", extension="pdf",
                           sha256="a" * 64, page_count=1, content=b"synthetic")


def test_reservation_generates_safe_uuid_path_and_tracks_before_storage(monkeypatch):
    repository, db = repository_with_rows(monkeypatch, [
        {"expired": False, "is_sample": False}, None, {"n": 0},
        {"n": 0, "bytes": 0}, {"n": 0, "bytes": 0}, {"n": 0},
    ])
    result = repository.reserve_upload(ENTRY, file(), "claimly-documents", "test-key")
    prefix, entry, filename = result["path"].split("/")
    assert UUID(prefix) == DEMO_WORKSPACE_ID
    assert UUID(entry) == ENTRY
    assert UUID(filename.removesuffix(".pdf"))
    assert "untrusted" not in result["path"]
    insertion = db.execute.call_args
    assert "INSERT INTO claimly.mutation_requests" in insertion.args[0]
    assert result["path"] in insertion.args[1]


@pytest.mark.parametrize("entry,status", [(None, 404), ({"expired": True}, 404),
                                        ({"expired": False, "is_sample": True}, 403)])
def test_invalid_or_protected_entry_never_gets_an_intent(monkeypatch, entry, status):
    repository, db = repository_with_rows(monkeypatch, [entry])
    with pytest.raises(ApiError) as error:
        repository.reserve_upload(ENTRY, file(), "claimly-documents", "test-key")
    assert error.value.status == status
    assert not any("INSERT" in call.args[0] for call in db.execute.call_args_list)


@pytest.mark.parametrize("documents,pending,per_entry", [
    ({"n": 99, "bytes": 0}, {"n": 1, "bytes": 0}, 0),
    ({"n": 0, "bytes": 250 * 1024 * 1024}, {"n": 0, "bytes": 0}, 0),
    ({"n": 0, "bytes": 0}, {"n": 0, "bytes": 0}, 5),
])
def test_persistent_pending_reservations_count_towards_capacity(monkeypatch, documents, pending, per_entry):
    repository, db = repository_with_rows(monkeypatch, [
        {"expired": False, "is_sample": False}, None, {"n": 0}, documents, pending, {"n": per_entry},
    ])
    with pytest.raises(ApiError) as error:
        repository.reserve_upload(ENTRY, file(), "claimly-documents", "test-key")
    assert error.value.status == 429
    assert not any("INSERT" in call.args[0] for call in db.execute.call_args_list)


def test_fingerprint_conflict_and_completed_replay(monkeypatch):
    repository, db = repository_with_rows(monkeypatch, [{"fingerprint": "old", "state": "completed", "response": {}}])
    with pytest.raises(ApiError) as error:
        repository._request(db, "upload", "key", "new")
    assert error.value.status == 409
    db.execute.return_value.fetchone.side_effect = [{"fingerprint": "same", "state": "completed", "response": {"saved": True}}]
    assert repository._request(db, "upload", "key", "same") == {"saved": True}


def test_admission_limits_are_checked_in_shared_transaction(monkeypatch):
    repository, db = repository_with_rows(monkeypatch, [{"requests": 31}])
    with pytest.raises(ApiError) as error:
        repository.admit("synthetic-client")
    assert error.value.status == 429
    assert "synthetic-client" not in str(db.execute.call_args_list)


def test_finalization_rejects_already_cleaned_intent(monkeypatch):
    repository, db = repository_with_rows(monkeypatch, [{"state": "cleaned"}])
    with pytest.raises(ApiError) as error:
        repository.complete_upload(digest("key"))
    assert error.value.status == 409
    assert not any("INSERT" in call.args[0] for call in db.execute.call_args_list)
