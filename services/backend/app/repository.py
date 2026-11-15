"""PostgreSQL persistence and atomic admission limits for the shared demo."""

import hashlib
import json
from contextlib import contextmanager
from uuid import uuid4

from psycopg.types.json import Jsonb

from app.config import get_database_settings
from app.database import database_connection
from app.errors import ApiError
from app.upload_models import DocumentData, EntryData, JobData


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def public_entry(row):
    return EntryData.model_validate(row).model_dump(mode="json")


def public_document(row):
    return DocumentData.model_validate(row).model_dump(mode="json")


def public_job(row):
    return JobData.model_validate(row).model_dump(mode="json")


class Repository:
    def __init__(self, settings=None):
        self.settings = settings or get_database_settings()
        self.workspace = self.settings.workspace_id

    @contextmanager
    def transaction(self, lock=False):
        with database_connection(self.settings) as connection:
            connection.execute("SET LOCAL statement_timeout = '5s'")
            connection.execute("SET LOCAL lock_timeout = '2s'")
            if lock:
                # One shared workspace: serialize short quota/reservation transactions.
                connection.execute("SELECT pg_advisory_xact_lock(785392140)")
            yield connection

    def admit(self, client_ip: str, write=True):
        group = "write" if write else "read"
        limits = [(group + ":global", 30 if write else 180),
                  (group + ":" + digest(client_ip), 10 if write else 60)]
        with self.transaction(lock=True) as db:
            db.execute("DELETE FROM claimly.rate_limit_buckets WHERE window_start < date_trunc('minute', now()) - interval '2 minutes'")
            for key, limit in limits:
                row = db.execute("""INSERT INTO claimly.rate_limit_buckets
                    (workspace_id, bucket_key, window_start, requests)
                    VALUES (%s, %s, date_trunc('minute', now()), 1)
                    ON CONFLICT (workspace_id, bucket_key, window_start)
                    DO UPDATE SET requests = rate_limit_buckets.requests + 1 RETURNING requests""",
                    (self.workspace, key)).fetchone()
                if row["requests"] > limit:
                    raise ApiError(429, "RATE_LIMITED", "Demo request limit reached. Retry in a minute.", True)

    def _request(self, db, operation, key_hash, fingerprint):
        row = db.execute("""SELECT * FROM claimly.mutation_requests
            WHERE workspace_id = %s AND operation = %s AND key_hash = %s""",
            (self.workspace, operation, key_hash)).fetchone()
        if row:
            if row["fingerprint"] != fingerprint:
                raise ApiError(409, "CONFLICT", "Idempotency-Key was already used with a different request.")
            if row["state"] != "completed":
                raise ApiError(409, "CONFLICT", "Upload is pending or requires operator recovery. Retry the same key later.", True)
            return row["response"]
        count = db.execute("SELECT count(*) AS n FROM claimly.mutation_requests WHERE workspace_id = %s",
                           (self.workspace,)).fetchone()["n"]
        if count >= 2000:
            raise ApiError(429, "RATE_LIMITED", "Demo operation capacity reached. An operator must clean up.")
        return None

    def create_entry(self, body, key):
        fingerprint, key_hash = digest(body), digest(key)
        with self.transaction(lock=True) as db:
            cached = self._request(db, "entry", key_hash, fingerprint)
            if cached is not None:
                return cached
            count = db.execute("SELECT count(*) AS n FROM claimly.entries WHERE workspace_id = %s AND NOT is_sample",
                               (self.workspace,)).fetchone()["n"]
            if count >= 100:
                raise ApiError(429, "RATE_LIMITED", "Demo entry capacity reached. An operator must clean up.")
            row = db.execute("""INSERT INTO claimly.entries
                (workspace_id, title, category, provider, subject) VALUES (%s, %s, %s, %s, %s) RETURNING *""",
                (self.workspace, body["title"], body["category"], body["provider"], body["subject"])).fetchone()
            data = public_entry(row)
            db.execute("""INSERT INTO claimly.mutation_requests
                (workspace_id, operation, key_hash, fingerprint, state, response)
                VALUES (%s, 'entry', %s, %s, 'completed', %s)""",
                (self.workspace, key_hash, fingerprint, Jsonb(data)))
            return data

    def _entry(self, db, entry_id):
        row = db.execute("""SELECT *, expires_at IS NOT NULL AND expires_at <= now() AS expired
            FROM claimly.entries WHERE workspace_id = %s AND id = %s""",
            (self.workspace, entry_id)).fetchone()
        if row is None or row["expired"]:
            raise ApiError(404, "NOT_FOUND", "Entry not found or expired.")
        return row

    def reserve_upload(self, entry_id, file, bucket, key):
        key_hash = digest(key)
        fingerprint = digest([str(entry_id), file.name, file.mime_type, file.sha256])
        with self.transaction(lock=True) as db:
            entry = self._entry(db, entry_id)
            if entry["is_sample"]:
                raise ApiError(403, "FORBIDDEN", "Preloaded sample entries cannot be modified. Create a new entry.")
            cached = self._request(db, "upload", key_hash, fingerprint)
            if cached is not None:
                return {"cached": cached}
            stats = db.execute("""SELECT count(*) AS n, coalesce(sum(size_bytes), 0) AS bytes
                FROM claimly.documents WHERE workspace_id = %s""", (self.workspace,)).fetchone()
            pending = db.execute("""SELECT count(*) AS n, coalesce(sum(size_bytes), 0) AS bytes
                FROM claimly.mutation_requests WHERE workspace_id = %s AND operation = 'upload'
                AND state IN ('reserved', 'cleanup_required')""", (self.workspace,)).fetchone()
            entry_count = db.execute("""SELECT
                (SELECT count(*) FROM claimly.documents WHERE workspace_id = %s AND entry_id = %s) +
                (SELECT count(*) FROM claimly.mutation_requests WHERE workspace_id = %s
                 AND operation = 'upload' AND state IN ('reserved', 'cleanup_required')
                 AND metadata->>'entry_id' = %s) AS n""",
                (self.workspace, entry_id, self.workspace, str(entry_id))).fetchone()["n"]
            if entry_count >= 5 or stats["n"] + pending["n"] >= 100 or stats["bytes"] + pending["bytes"] + len(file.content) > 250 * 1024 * 1024:
                raise ApiError(429, "RATE_LIMITED", "Demo file capacity reached (5 per entry, 100 files, 250 MB total).")
            # Every upload produces one job; the document+reservation cap also bounds the queue.
            document_id, job_id = str(uuid4()), str(uuid4())
            path = f"{self.workspace}/{entry_id}/{document_id}.{file.extension}"
            metadata = {"document_id": document_id, "job_id": job_id, "entry_id": str(entry_id),
                        "name": file.name, "mime_type": file.mime_type, "sha256": file.sha256,
                        "page_count": file.page_count}
            db.execute("""INSERT INTO claimly.mutation_requests
                (workspace_id, operation, key_hash, fingerprint, state, metadata, storage_bucket, storage_path, size_bytes)
                VALUES (%s, 'upload', %s, %s, 'reserved', %s, %s, %s, %s)""",
                (self.workspace, key_hash, fingerprint, Jsonb(metadata), bucket, path, len(file.content)))
            return {"key_hash": key_hash, "path": path}

    def mark_cleanup(self, key_hash):
        with self.transaction(lock=True) as db:
            db.execute("""UPDATE claimly.mutation_requests SET state = 'cleanup_required'
                WHERE workspace_id = %s AND operation = 'upload' AND key_hash = %s AND state = 'reserved'""",
                (self.workspace, key_hash))

    def complete_upload(self, key_hash):
        with self.transaction(lock=True) as db:
            intent = db.execute("""SELECT * FROM claimly.mutation_requests
                WHERE workspace_id = %s AND operation = 'upload' AND key_hash = %s FOR UPDATE""",
                (self.workspace, key_hash)).fetchone()
            if intent is None or intent["state"] != "reserved":
                raise ApiError(409, "CONFLICT", "Upload reservation is no longer active.")
            m = intent["metadata"]
            entry = self._entry(db, m["entry_id"])
            if entry["is_sample"]:
                raise ApiError(403, "FORBIDDEN", "Preloaded sample entries cannot be modified.")
            document = db.execute("""INSERT INTO claimly.documents
                (id, workspace_id, entry_id, name, mime_type, storage_bucket, storage_path, size_bytes, sha256, page_count)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
                (m["document_id"], self.workspace, m["entry_id"], m["name"], m["mime_type"], intent["storage_bucket"],
                 intent["storage_path"], intent["size_bytes"], m["sha256"], m["page_count"])).fetchone()
            job = db.execute("""INSERT INTO claimly.analysis_jobs (id, workspace_id, document_id, document_version)
                VALUES (%s, %s, %s, 1) RETURNING *""", (m["job_id"], self.workspace, m["document_id"])).fetchone()
            db.execute("""UPDATE claimly.entries SET data_version = data_version + 1
                WHERE workspace_id = %s AND id = %s""", (self.workspace, m["entry_id"]))
            data = {"document": public_document(document), "job": public_job(job)}
            db.execute("""UPDATE claimly.mutation_requests SET state = 'completed', response = %s
                WHERE workspace_id = %s AND operation = 'upload' AND key_hash = %s""",
                (Jsonb(data), self.workspace, key_hash))
            return data

    def get_document(self, document_id):
        with self.transaction() as db:
            row = db.execute("""SELECT d.* FROM claimly.documents d JOIN claimly.entries e
                ON (e.workspace_id, e.id) = (d.workspace_id, d.entry_id)
                WHERE d.workspace_id = %s AND d.id = %s AND (e.expires_at IS NULL OR e.expires_at > now())""",
                (self.workspace, document_id)).fetchone()
            if row is None:
                raise ApiError(404, "NOT_FOUND", "Document not found or expired.")
            return public_document(row)

    def get_job(self, job_id):
        with self.transaction() as db:
            row = db.execute("""SELECT j.* FROM claimly.analysis_jobs j
                JOIN claimly.documents d ON (d.workspace_id, d.id) = (j.workspace_id, j.document_id)
                JOIN claimly.entries e ON (e.workspace_id, e.id) = (d.workspace_id, d.entry_id)
                WHERE j.workspace_id = %s AND j.id = %s AND (e.expires_at IS NULL OR e.expires_at > now())""",
                (self.workspace, job_id)).fetchone()
            if row is None:
                raise ApiError(404, "NOT_FOUND", "Job not found or expired.")
            return public_job(row)
