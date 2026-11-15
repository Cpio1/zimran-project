"""Read-only diagnostic boundaries, without live credentials or network calls."""

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock

from app import check_storage
from app.config import DEMO_WORKSPACE_ID, StorageSettings
from app.repository import digest


def test_tracking_query_is_read_only_and_uses_production_key_hash(monkeypatch):
    settings = SimpleNamespace(workspace_id=DEMO_WORKSPACE_ID)
    monkeypatch.setattr(check_storage, "get_database_settings", lambda: settings)
    connection = MagicMock()
    connection.execute.return_value.fetchone.return_value = None

    @contextmanager
    def fake_connection(received):
        assert received is settings
        yield connection

    monkeypatch.setattr(check_storage, "database_connection", fake_connection)
    storage = SimpleNamespace(bucket="claimly-documents")
    assert check_storage.inspect_tracking(storage, "synthetic-key") is None
    calls = connection.execute.call_args_list
    assert calls[0].args[0] == "SET TRANSACTION READ ONLY"
    assert calls[-1].args[0].strip().startswith("SELECT ")
    assert calls[-1].args[1][-1] == digest("synthetic-key")
    assert "metadata" not in calls[-1].args[0]


def test_bucket_probe_never_uploads_or_deletes(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(check_storage, "ENV_FILE", tmp_path / ".env")
    monkeypatch.setattr("sys.argv", ["check_storage"])
    settings = StorageSettings("https://synthetic.supabase.co", "sb_secret_test_only")
    monkeypatch.setattr(check_storage, "get_storage_settings", lambda: settings)
    client = MagicMock()
    monkeypatch.setattr(check_storage, "StorageClient", lambda received: client)
    assert check_storage.main() == 0
    client.ensure_private.assert_called_once_with()
    client.upload.assert_not_called()
    client.remove.assert_not_called()
    assert settings.secret_key not in capsys.readouterr().out
