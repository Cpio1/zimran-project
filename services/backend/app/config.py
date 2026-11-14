"""Explicit server-side database configuration; no connections at import time."""

import os
from dataclasses import dataclass, field
from pathlib import Path
from uuid import UUID

from dotenv import load_dotenv
from psycopg.conninfo import conninfo_to_dict

DEMO_WORKSPACE_ID = UUID("10000000-0000-4000-8000-000000000000")
ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


class ConfigurationError(RuntimeError):
    """Required server configuration is missing or invalid."""


@dataclass(frozen=True)
class DatabaseSettings:
    database_url: str = field(repr=False)
    workspace_id: UUID = DEMO_WORKSPACE_ID
    connect_timeout_seconds: int = 10

    def __post_init__(self) -> None:
        if not self.database_url.strip():
            raise ConfigurationError("DATABASE_URL is required for database operations.")
        if not self.database_url.startswith(("postgresql://", "postgres://")):
            raise ConfigurationError("DATABASE_URL must be a PostgreSQL connection URI.")
        try:
            parameters = conninfo_to_dict(self.database_url)
        except Exception:
            raise ConfigurationError("DATABASE_URL is not a valid PostgreSQL URI.") from None
        if not parameters.get("host") or not parameters.get("dbname"):
            raise ConfigurationError("DATABASE_URL must include a host and database name.")
        port = parameters.get("port", "5432")
        if not port.isascii() or not port.isdigit() or not 1 <= int(port) <= 65535:
            raise ConfigurationError("DATABASE_URL port must be a number between 1 and 65535.")
        if self.workspace_id != DEMO_WORKSPACE_ID:
            raise ConfigurationError("DEMO_WORKSPACE_ID must match the single migrated demo workspace.")
        if not 1 <= self.connect_timeout_seconds <= 60:
            raise ConfigurationError("DATABASE_CONNECT_TIMEOUT_SECONDS must be between 1 and 60.")


def get_database_settings() -> DatabaseSettings:
    """Read backend/.env without overriding environment variables supplied by hosting."""
    load_dotenv(ENV_FILE, override=False)
    try:
        workspace_id = UUID(os.environ.get("DEMO_WORKSPACE_ID", str(DEMO_WORKSPACE_ID)))
        timeout = int(os.environ.get("DATABASE_CONNECT_TIMEOUT_SECONDS", "10"))
    except ValueError:
        raise ConfigurationError("Invalid DEMO_WORKSPACE_ID or DATABASE_CONNECT_TIMEOUT_SECONDS.") from None
    return DatabaseSettings(
        database_url=os.environ.get("DATABASE_URL", "").strip(),
        workspace_id=workspace_id,
        connect_timeout_seconds=timeout,
    )
