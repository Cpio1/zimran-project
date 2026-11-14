"""Read-only live connectivity check: python -m app.check_database."""

import psycopg

from app.config import ConfigurationError, get_database_settings
from app.database import DatabaseConnectionError, database_connection


def check_workspace() -> bool:
    """Connect using existing settings and look for the server-selected workspace."""
    settings = get_database_settings()
    with database_connection(settings) as connection:
        # PostgreSQL enforces read-only access for this transaction.
        connection.execute("SET TRANSACTION READ ONLY")
        rows = connection.execute("SELECT id, name FROM claimly.workspaces").fetchall()
    return any(row["id"] == settings.workspace_id for row in rows)


def failure_hint(error: Exception) -> str:
    """Classify driver errors without displaying driver messages or credentials."""
    cause = error.__context__ if isinstance(error, DatabaseConnectionError) else error
    detail = str(cause).lower()
    if "password authentication failed" in detail or "tenant or user not found" in detail:
        return "Authentication failed. Check the database username and password in backend/.env."
    if "could not translate host name" in detail or "getaddrinfo" in detail or "name resolution" in detail:
        return "DNS lookup failed. Check the connection host and your network/DNS access."
    if "10013" in detail or "permission denied" in detail and not isinstance(cause, psycopg.errors.InsufficientPrivilege):
        return "Network access was blocked. Check sandbox permissions, firewall, or VPN settings."
    if "timeout" in detail or "timed out" in detail or "network is unreachable" in detail:
        return "The database could not be reached. Check network access and the Supabase connection mode."
    if isinstance(cause, psycopg.errors.InsufficientPrivilege):
        return "The database role cannot read claimly.workspaces. Check its schema and table permissions."
    if isinstance(cause, (psycopg.errors.UndefinedTable, psycopg.errors.InvalidSchemaName)):
        return "claimly.workspaces is unavailable. Check that DATABASE_URL targets the migrated project."
    if "ssl" in detail or "certificate" in detail:
        return "TLS negotiation failed. Check the Supabase connection settings and local certificates."
    return "Check DATABASE_URL, Supabase project availability, and network access. No driver details were printed."


def main() -> int:
    try:
        found = check_workspace()
    except ConfigurationError as error:
        print(f"Database configuration error: {error}")
        return 1
    except (DatabaseConnectionError, psycopg.Error) as error:
        print(f"Database check failed: {failure_hint(error)}")
        return 1
    print("PostgreSQL connection and read-only query succeeded.")
    if not found:
        print("Configured shared demo workspace was NOT found.")
        return 2
    print("Configured shared demo workspace was found.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
