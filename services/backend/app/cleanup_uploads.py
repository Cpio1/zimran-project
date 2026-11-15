"""Operator recovery for incomplete uploads; never run automatically on startup.

python -m app.cleanup_uploads
Only abandoned intents older than 15 minutes are eligible. Completed documents
are never deleted by this command. This is not visitor-retention cleanup.
"""

import argparse
import psycopg

from app.config import ConfigurationError, get_storage_settings
from app.database import DatabaseConnectionError
from app.errors import ApiError
from app.repository import Repository
from app.storage import StorageClient


def cleanup(repository, storage):
    count = 0
    # Process one row per transaction; row lock excludes finalization of this intent.
    for _ in range(10):
        with repository.transaction(lock=True) as db:
            row = db.execute("""SELECT * FROM claimly.mutation_requests
                WHERE workspace_id = %s AND operation = 'upload'
                AND state IN ('reserved', 'cleanup_required')
                AND updated_at < now() - interval '15 minutes'
                ORDER BY updated_at LIMIT 1 FOR UPDATE""", (repository.workspace,)).fetchone()
            if row is None:
                break
            # Deletion is limited to this intent's recorded bucket and UUID path.
            # If Storage deletion or DB commit fails, the row remains eligible.
            storage.remove(row["storage_bucket"], row["storage_path"])
            db.execute("""UPDATE claimly.mutation_requests SET state = 'cleaned'
                WHERE workspace_id = %s AND operation = 'upload' AND key_hash = %s""",
                (repository.workspace, row["key_hash"]))
            count += 1
    return count


def main():
    parser = argparse.ArgumentParser(description="Recover abandoned uploads after stopping the API.")
    parser.add_argument("--api-stopped", action="store_true",
                        help="Confirm the API has been stopped so no uploads are in flight.")
    if not parser.parse_args().api_stopped:
        print("Stop the API first, then run this command with --api-stopped.")
        return 1
    try:
        count = cleanup(Repository(), StorageClient(get_storage_settings()))
    except (ConfigurationError, DatabaseConnectionError, psycopg.Error, ApiError):
        print("Recovery failed. Check backend configuration, migration 0003, and Storage access; retry safely.")
        return 1
    print(f"Recovered {count} abandoned upload(s); completed documents were untouched.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
