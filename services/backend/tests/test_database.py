"""Configuration and connection lifecycle tests; never contact a database."""

from unittest.mock import MagicMock
from uuid import uuid4

import psycopg
import pytest

from app import config, database
from app.config import ConfigurationError, DatabaseSettings

TEST_URI = "postgresql://postgres:test-only-password@localhost:5432/postgres"


@pytest.fixture(autouse=True)
def isolated_environment(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "ENV_FILE", tmp_path / ".env")
    for name in ("DATABASE_URL", "DEMO_WORKSPACE_ID", "DATABASE_CONNECT_TIMEOUT_SECONDS"):
        # Register restoration even if initially absent: load_dotenv later mutates
        # os.environ directly, outside monkeypatch's own setenv calls.
        monkeypatch.setenv(name, "")
        monkeypatch.delenv(name, raising=False)


def test_missing_configuration_fails_before_connecting(monkeypatch):
    connect = MagicMock()
    monkeypatch.setattr(database.psycopg, "connect", connect)
    with pytest.raises(ConfigurationError, match="DATABASE_URL is required"):
        with database.database_connection():
            pytest.fail("Must not yield without configuration")
    connect.assert_not_called()


def test_backend_env_file_and_environment_override(monkeypatch):
    config.ENV_FILE.write_text(f"DATABASE_URL={TEST_URI}\nDATABASE_CONNECT_TIMEOUT_SECONDS=8\n")
    monkeypatch.setenv("DATABASE_CONNECT_TIMEOUT_SECONDS", "12")
    settings = config.get_database_settings()
    assert settings.database_url == TEST_URI
    assert settings.connect_timeout_seconds == 12
    assert settings.workspace_id == config.DEMO_WORKSPACE_ID
    assert "test-only-password" not in repr(settings)


@pytest.mark.parametrize("uri", [
    "", "sqlite:///local.db", "postgresql:///postgres", "postgresql://host",
    "postgresql://localhost:not-a-port/postgres",
    "postgresql://localhost:0/postgres",
    "postgresql://localhost:65536/postgres",
])
def test_invalid_database_url_is_rejected(uri):
    with pytest.raises(ConfigurationError):
        DatabaseSettings(database_url=uri)


def test_other_workspaces_are_rejected():
    with pytest.raises(ConfigurationError, match="single migrated"):
        DatabaseSettings(database_url=TEST_URI, workspace_id=uuid4())


@pytest.mark.parametrize("name,value", [
    ("DEMO_WORKSPACE_ID", "not-a-uuid"),
    ("DATABASE_CONNECT_TIMEOUT_SECONDS", "not-a-number"),
    ("DATABASE_CONNECT_TIMEOUT_SECONDS", "0"),
    ("DATABASE_CONNECT_TIMEOUT_SECONDS", "61"),
])
def test_invalid_environment_values_fail_clearly(monkeypatch, name, value):
    monkeypatch.setenv("DATABASE_URL", TEST_URI)
    monkeypatch.setenv(name, value)
    with pytest.raises(ConfigurationError):
        config.get_database_settings()


def test_connection_uses_tls_and_transaction_context(monkeypatch):
    connection = MagicMock()
    connection.__enter__.return_value = connection
    connect = MagicMock(return_value=connection)
    monkeypatch.setattr(database.psycopg, "connect", connect)
    with database.database_connection(DatabaseSettings(database_url=TEST_URI)) as opened:
        assert opened is connection
    kwargs = connect.call_args.kwargs
    assert kwargs["sslmode"] == "require"
    assert kwargs["connect_timeout"] == 10
    assert kwargs["prepare_threshold"] is None
    connection.__exit__.assert_called_once_with(None, None, None)


def test_body_failure_reaches_transaction_context(monkeypatch):
    connection = MagicMock()
    connection.__enter__.return_value = connection
    monkeypatch.setattr(database.psycopg, "connect", MagicMock(return_value=connection))
    with pytest.raises(ValueError, match="rollback"):
        with database.database_connection(DatabaseSettings(database_url=TEST_URI)):
            raise ValueError("rollback")
    assert connection.__exit__.call_args.args[0] is ValueError


def test_connection_error_does_not_expose_credentials(monkeypatch):
    monkeypatch.setattr(database.psycopg, "connect", MagicMock(
        side_effect=psycopg.OperationalError(f"connection failed: {TEST_URI}")
    ))
    with pytest.raises(database.DatabaseConnectionError) as error:
        with database.database_connection(DatabaseSettings(database_url=TEST_URI)):
            pytest.fail("Must not yield after connection failure")
    assert "DATABASE_URL" in str(error.value)
    assert "test-only-password" not in str(error.value)
    assert error.value.__suppress_context__
