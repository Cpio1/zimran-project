# Claimly backend

Minimal Python/FastAPI backend implementing `GET /health` for Claimly API
contract version **2.0.0**. It does not require external services or secrets.

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
