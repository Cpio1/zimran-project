"""Read-only bucket and optional upload-tracking diagnostics; no object writes."""

import argparse
import os
import re
from urllib.parse import urlsplit

import psycopg
from dotenv import dotenv_values
from psycopg.conninfo import conninfo_to_dict

from app.config import ENV_FILE, ConfigurationError, get_database_settings, get_storage_settings
from app.database import DatabaseConnectionError, database_connection
from app.repository import digest
from app.storage import StorageClient, StorageError


def inspect_tracking(settings, idempotency_key):
    """Return selected safe fields only; never select filenames, paths, or responses."""
    database = get_database_settings()
    with database_connection(database) as db:
        db.execute("SET TRANSACTION READ ONLY")
        db.execute("SET LOCAL statement_timeout = '5s'")
        return db.execute("""SELECT state, created_at, updated_at, size_bytes,
            storage_bucket = %s AS bucket_matches, storage_path IS NOT NULL AS has_path,
            response IS NOT NULL AS has_completed_response
            FROM claimly.mutation_requests WHERE workspace_id = %s
            AND operation = 'upload' AND key_hash = %s""",
            (settings.bucket, database.workspace_id, digest(idempotency_key))).fetchone()


def inspect_project(settings):
    """Compare project references without disclosing connection settings or references."""
    database = get_database_settings()
    parameters = conninfo_to_dict(database.database_url)
    host = parameters.get("host", "")
    user = parameters.get("user", "")
    direct = re.fullmatch(r"db\.([a-z0-9]+)\.supabase\.co", host)
    project = direct.group(1) if direct else user.rsplit(".", 1)[-1] if "." in user and host.endswith(".pooler.supabase.com") else None
    storage_host = urlsplit(settings.url).hostname or ""
    storage = re.fullmatch(r"([a-z0-9]+)\.supabase\.co", storage_host)
    matches = project == storage.group(1) if project and storage else None
    print(f"Database and Storage project references match: {matches if matches is not None else 'not comparable'}", flush=True)
    with database_connection(database) as db:
        db.execute("SET TRANSACTION READ ONLY")
        db.execute("SET LOCAL statement_timeout = '5s'")
        row = db.execute("""SELECT
            EXISTS(SELECT 1 FROM storage.buckets WHERE id = %s) AS bucket_id_exists,
            EXISTS(SELECT 1 FROM storage.buckets WHERE name = %s) AS bucket_name_exists,
            EXISTS(SELECT 1 FROM storage.buckets WHERE id = %s AND NOT public) AS bucket_id_is_private""",
            (settings.bucket, settings.bucket, settings.bucket)).fetchone()
    print(f"PostgreSQL Storage catalog checks: {dict(row)}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--idempotency-key", help="Read the existing upload intent for this key")
    parser.add_argument("--tracking-only", action="store_true", help="Skip the Storage HTTP request")
    parser.add_argument("--compare-project", action="store_true", help="Compare project references and read bucket existence from PostgreSQL")
    args = parser.parse_args()
    raw = dotenv_values(ENV_FILE)
    for name in ("SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_STORAGE_BUCKET"):
        print(f"{name} process override differs from .env: {name in os.environ and os.environ[name] != raw.get(name)}", flush=True)
    try:
        settings = get_storage_settings()
    except ConfigurationError as error:
        print(f"Storage configuration error: {error}", flush=True)
        return 1
    print(f"Base HTTPS project URL without API path: {urlsplit(settings.url).path in ('', '/')}", flush=True)
    print(f"New secret key type: {settings.secret_key.startswith('sb_secret_')}", flush=True)
    print(f"Expected claimly-documents bucket configured: {settings.bucket == 'claimly-documents'}", flush=True)
    failed = False
    if args.compare_project:
        try:
            inspect_project(settings)
        except (ConfigurationError, DatabaseConnectionError, psycopg.Error):
            print("Read-only project/catalog comparison failed; details suppressed.", flush=True)
            failed = True
    if args.idempotency_key:
        try:
            row = inspect_tracking(settings, args.idempotency_key)
            print(f"Upload tracking record: {dict(row) if row else 'not found'}", flush=True)
        except (ConfigurationError, DatabaseConnectionError, psycopg.Error):
            print("Read-only tracking lookup failed; no driver details displayed.", flush=True)
            failed = True
    if not args.tracking_only:
        try:
            StorageClient(settings).ensure_private()
            print("Read-only bucket check succeeded: HTTP 200; bucket ID matches and bucket is private.", flush=True)
        except StorageError as error:
            print(f"Read-only bucket check failed: category={error.category} http_status={error.http_status}", flush=True)
            failed = True
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
