# Claimly backend

Python/FastAPI backend with health, shared-workspace entry creation, private
document upload, document metadata, and queued-job status. Public response shapes
follow Claimly contract **2.0.0**; its session requirement conflicts with the
approved shared-workspace design (see [UPLOADS.md](UPLOADS.md)). Health does not
require configuration. Data endpoints require real PostgreSQL and Storage settings.
AI analysis is not implemented: accepted jobs remain queued with no fabricated result.

See [UPLOADS.md](UPLOADS.md) for migration 0003, safe testing commands, safeguards,
failure recovery, and remaining frontend work.

## Install on Windows PowerShell

Install Python 3.11 or newer and make sure `python --version` works.
Run these commands from any PowerShell window:

```powershell
Set-Location C:\Users\Lenovo\zimran-project\services\backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

The virtual environment keeps this backend's dependencies separate from other
projects. `requirements-dev.txt` installs both runtime and test dependencies.
For a runtime-only installation, use `requirements.txt` instead.
Dependency files specify compatible version ranges rather than a frozen lockfile.

These commands use the virtual environment's Python directly, so activation and
PowerShell execution-policy changes are unnecessary.

## Run locally

From `services/backend`:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Keep this terminal open. Stop the server with **Ctrl+C**. `--reload` restarts it
when you edit Python files; omit this flag for deployments.

## Verify the endpoint

Open <http://127.0.0.1:8000/health> in a browser. It should return HTTP 200
with this JSON (the UUID changes for every request):

```json
{
  "data": {
    "status": "ok",
    "service": "backend",
    "contract_version": "2.0.0"
  },
  "request_id": "b71a096f-c335-46b5-9fe0-8a76be735c33"
}
```

The response includes `X-Contract-Version: 2.0.0`. To inspect the header, use the
browser's Developer Tools > Network, reload the page, and select the `health`
request. Or run this in a second PowerShell window:

```powershell
$healthResponse = Invoke-WebRequest -Uri http://127.0.0.1:8000/health -UseBasicParsing
$healthResponse.StatusCode
$healthResponse.Headers['X-Contract-Version']
$healthResponse.Content
```

Interactive API documentation is at <http://127.0.0.1:8000/docs>.
CORS permits browser requests from `http://localhost:3000` and exposes the
contract-version header to frontend JavaScript. The current API only needs GET.

## Run tests

From `services/backend`, with the development dependencies installed:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

Tests check the health body, version header, unique UUIDs, allowed frontend
requests, CORS preflight, and rejection of other origins for browser access.
The schema test reads `contracts/backend.openapi.json`, falling back to
`front/contracts/backend.openapi.json`, and validates the response against
`HealthEnvelope`. If neither file exists, only this schema test is skipped;
the explicit response tests still run.

At initial setup, the root-level `contracts/backend.openapi.json` was absent.
The existing `front/contracts/backend.openapi.json` contains version 2.0.0 and
its `HealthEnvelope` matches the requested response. It is read for verification
only; no frontend or contract files are modified.

## Files

- `app/__init__.py`: marks the application as a Python package.
- `app/main.py`: FastAPI application, CORS, version header, and health route.
- `app/schemas.py`: typed health response models and per-response UUID generation.
- `tests/test_health.py`: automated endpoint, CORS, and contract checks.
- `requirements.txt`: runtime dependencies (FastAPI, Pydantic, and Uvicorn).
- `requirements-dev.txt`: runtime plus test dependencies.
- `pytest.ini`: tells pytest where to find tests.
- `.gitignore`: excludes the local environment, Python caches, and local secrets.
- `README.md`: setup, run, and verification instructions.

## Configure Supabase for Phase 3A

From `services/backend`, create your ignored local configuration file:

```powershell
Copy-Item .env.example .env
```

Edit `.env` locally. Do not paste real credentials into source files or frontend
configuration. Existing hosting environment variables override `.env` values.

| Variable | What to set |
| --- | --- |
| `DATABASE_URL` | Required for database operations. PostgreSQL connection URI from your project's **Connect** dialog, including its database password. |
| `DEMO_WORKSPACE_ID` | Keep `10000000-0000-4000-8000-000000000000`; it matches the migrated shared workspace. Any other ID fails validation. |
| `DATABASE_CONNECT_TIMEOUT_SECONDS` | Optional; defaults to `10`, accepts `1` through `60`. |

Use the direct connection if your machine has the required network connectivity,
or the **session pooler** connection for an IPv4 Windows development setup. Copy
the exact host, port, username, and database from Supabase rather than guessing.
For URI passwords containing reserved characters, use percent encoding.
See [Supabase's connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres).

The module uses Psycopg 3, requires TLS (`sslmode=require`), sets a connection
timeout, and disables prepared statements for pooler compatibility. The connection
context commits on success, rolls back on errors, and closes on exit. It is
synchronous and intended for sync handlers or workers. There is no startup
connection, fallback database, mock data, automatic migration, or connection pool.

The SQL connection password is different from a Supabase API secret. Uploads now
also require `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (a backend `sb_secret_...` key),
and `SUPABASE_STORAGE_BUCKET=claimly-documents`. The bucket must remain private.
Never put database credentials or secret keys in `NEXT_PUBLIC_*` variables.
No Supabase Auth setup is needed.

Missing/invalid database settings raise `ConfigurationError` when settings are
requested; a failed connection raises `DatabaseConnectionError` with a sanitized
message. Database configuration does not change `/health`, which remains a
process-liveness endpoint rather than a database-readiness probe.

## Apply migrations later

Migrations are not applied automatically. For a fresh project, use SQL Editor to run
`migrations/0001_database_foundation.sql` followed by
`migrations/0002_shared_workspace.sql` as the database owner. See
[migrations/README.md](migrations/README.md) for the full procedure, tables,
sample lifecycle, access controls, and verification queries.

New Phase 3A files:

- `.env.example`: credential-free configuration template.
- `app/config.py`: validates server settings and loads the backend's `.env`.
- `app/database.py`: opens a transactional PostgreSQL connection on explicit use.
- `migrations/0001_database_foundation.sql`: six tables, constraints, indexes,
  timestamp triggers, and access controls.
- `migrations/0002_shared_workspace.sql`: inserts only the shared workspace.
- `migrations/README.md`: migration procedure and schema details.
- `tests/test_database.py`: offline settings and mocked connection tests.
- `tests/test_migrations.py`: PostgreSQL syntax and basic access-boundary checks.

Run the same install and pytest commands above to include all Phase 3A tests.
Tests do not need Supabase credentials or network access. They do not execute SQL
against a database; live migration and permission checks are still outstanding.

## Check an existing database connection

After applying the migrations and configuring `.env`, run this explicitly from
`services/backend`:

```powershell
.\.venv\Scripts\python.exe -m app.check_database
```

The check uses the existing configuration and connection module, starts a
read-only transaction, and executes `SELECT id, name FROM claimly.workspaces`.
It reports whether the configured shared workspace exists without printing
credentials or raw driver errors. Exit codes: `0` = connected and found,
`1` = configuration/connection/query failure, `2` = query succeeded but workspace
missing. It does not apply migrations or change records. This command is separate
from the offline test suite and `/health`.

If the check reports an invalid port, replace the local URI with the exact
PostgreSQL URI from the project's Connect dialog, filling in only the database
password (percent-encoded if needed). The port must be numeric, between 1 and
65535. Use the session pooler URI for an IPv4-only development network. Do not
share `.env` or paste the URI into logs or chat.
