"""Recovery only deletes incomplete, locked intents and retains failures."""

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.cleanup_uploads import cleanup
from app.storage import StorageError


@pytest.mark.parametrize("fails", [False, True])
def test_cleanup_uses_recorded_bucket_and_marks_only_after_storage_success(fails):
    db = MagicMock()
    db.execute.return_value.fetchone.side_effect = [
        {"storage_bucket": "recorded-private-bucket", "storage_path": "safe/uuid.pdf", "key_hash": "key"}, None,
    ]

    @contextmanager
    def transaction(lock=False):
        assert lock
        yield db

    repository = SimpleNamespace(transaction=transaction, workspace="synthetic-workspace")
    storage = MagicMock()
    if fails:
        storage.remove.side_effect = StorageError()
        with pytest.raises(StorageError):
            cleanup(repository, storage)
        assert not any(call.args[0].strip().startswith("UPDATE ") for call in db.execute.call_args_list)
    else:
        assert cleanup(repository, storage) == 1
        assert any(call.args[0].strip().startswith("UPDATE ") for call in db.execute.call_args_list)
    storage.remove.assert_called_once_with("recorded-private-bucket", "safe/uuid.pdf")
    query = db.execute.call_args_list[0].args[0]
    assert "FOR UPDATE" in query
    assert "15 minutes" in query
    assert "state IN ('reserved', 'cleanup_required')" in query
