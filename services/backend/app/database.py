"""Small synchronous connection boundary for future repositories and workers."""

from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

from app.config import DatabaseSettings, get_database_settings


class DatabaseConnectionError(RuntimeError):
    """A database connection could not be established."""


@contextmanager
def database_connection(settings: DatabaseSettings | None = None) -> Iterator[psycopg.Connection]:
    """Commit on success, roll back on error, and always close the connection.

    Call from synchronous handlers or a worker, not directly on an async event loop.
    SQL should use qualified claimly.table names and parameterized values.
    """
    settings = settings or get_database_settings()
    try:
        connection = psycopg.connect(
            settings.database_url,
            connect_timeout=settings.connect_timeout_seconds,
            sslmode="require",
            prepare_threshold=None,
            row_factory=dict_row,
        )
    except psycopg.Error:
        # Driver errors can contain hostnames/usernames; don't expose credentials.
        raise DatabaseConnectionError(
            "Could not connect to PostgreSQL. Check DATABASE_URL and Supabase network access."
        ) from None
    with connection:
        yield connection
