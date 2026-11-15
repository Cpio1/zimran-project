"""Offline PostgreSQL grammar and access-boundary checks, not a live DB test."""

from pathlib import Path

from pglast import ast, parse_sql
from pglast.enums import AlterTableType

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"


def test_migrations_parse_as_postgresql():
    for migration in sorted(MIGRATIONS.glob("*.sql")):
        statements = parse_sql(migration.read_text(encoding="utf-8"))
        assert statements, migration.name
        assert isinstance(statements[0].stmt, ast.TransactionStmt)
        assert isinstance(statements[-1].stmt, ast.TransactionStmt)


def test_every_created_table_is_private_and_has_rls():
    statements = parse_sql("\n".join(path.read_text(encoding="utf-8") for path in sorted(MIGRATIONS.glob("*.sql"))))
    tables = set()
    protected = set()
    for raw in statements:
        statement = raw.stmt
        if isinstance(statement, ast.CreateStmt):
            assert statement.relation.schemaname == "claimly"
            tables.add(statement.relation.relname)
        if isinstance(statement, ast.AlterTableStmt):
            if any(cmd.subtype == AlterTableType.AT_EnableRowSecurity for cmd in statement.cmds):
                protected.add(statement.relation.relname)
        # No browser-facing policies should accidentally grant direct data access.
        assert not isinstance(statement, ast.CreatePolicyStmt)
    assert tables
    assert tables == protected


def test_seed_workspace_matches_server_configuration():
    from app.config import DEMO_WORKSPACE_ID

    seed = (MIGRATIONS / "0002_shared_workspace.sql").read_text(encoding="utf-8")
    assert str(DEMO_WORKSPACE_ID) in seed
    inserts = [item.stmt for item in parse_sql(seed) if isinstance(item.stmt, ast.InsertStmt)]
    assert len(inserts) == 1
    assert inserts[0].relation.relname == "workspaces"
