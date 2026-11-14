"""Offline tests for the explicitly invoked live check."""

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import psycopg
import pytest

from app import check_database
from app.config import DEMO_WORKSPACE_ID
from app.config import ConfigurationError
from app.database import DatabaseConnectionError


@pytest.mark.parametrize("found", [True, False])
def test_check_is_read_only_and_checks_configured_workspace(monkeypatch, found):
    settings = SimpleNamespace(workspace_id=DEMO_WORKSPACE_ID)
    monkeypatch.setattr(check_database, "get_database_settings", lambda: settings)
    connection = MagicMock()
    connection.execute.return_value.fetchall.return_value = [
        {"id": DEMO_WORKSPACE_ID if found else uuid4(), "name": "Synthetic test workspace"}
    ]

    @contextmanager
    def fake_connection(received):
        assert received is settings
        yield connection

    monkeypatch.setattr(check_database, "database_connection", fake_connection)
    assert check_database.check_workspace() is found
    assert [call.args[0] for call in connection.execute.call_args_list] == [
        "SET TRANSACTION READ ONLY", "SELECT id, name FROM claimly.workspaces"
    ]


@pytest.mark.parametrize("found,expected", [(True, 0), (False, 2)])
def test_command_reports_result(monkeypatch, capsys, found, expected):
    monkeypatch.setattr(check_database, "check_workspace", lambda: found)
    assert check_database.main() == expected
    output = capsys.readouterr().out
    assert "query succeeded" in output
    assert ("NOT found" in output) is not found


def test_connection_failure_hides_raw_details(monkeypatch, capsys):
    def fail():
        try:
            raise psycopg.OperationalError("password authentication failed: secret-test-value")
        except psycopg.Error:
            raise DatabaseConnectionError("sanitized") from None

    monkeypatch.setattr(check_database, "check_workspace", fail)
    assert check_database.main() == 1
    output = capsys.readouterr().out
    assert "Authentication failed" in output
    assert "secret-test-value" not in output


def test_configuration_failure_is_reported_without_traceback(monkeypatch, capsys):
    def fail():
        raise ConfigurationError("DATABASE_URL port must be a number between 1 and 65535.")

    monkeypatch.setattr(check_database, "check_workspace", fail)
    assert check_database.main() == 1
    assert "Database configuration error:" in capsys.readouterr().out
