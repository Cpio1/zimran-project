# Real uploads, without AI analysis

This is a **public shared demo**. Use synthetic documents only. Uploaded files and
metadata belong to one shared workspace, not a private browser session. Do not
upload personal or confidential documents. The same warning appears in `/docs`;
the frontend owner still needs to add it prominently before visitor uploads.

## Before starting

Apply `migrations/0003_upload_tracking.sql` in Supabase SQL Editor after 0001 and
0002. It adds two private operational tables, with RLS and no browser access:

- `mutation_requests`: durable idempotency responses and planned upload paths.
- `rate_limit_buckets`: shared, database-backed rate counters.

Migration 0003 has not been applied by this implementation. Do not rerun 0001 or
0002. No live uploads, database writes, Storage changes, or paid AI calls were
performed during automated verification.

Keep these settings only in `services/backend/.env` (already ignored by Git):

```dotenv
DATABASE_URL=<your existing PostgreSQL URI>
DEMO_WORKSPACE_ID=10000000-0000-4000-8000-000000000000
DATABASE_CONNECT_TIMEOUT_SECONDS=10
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SECRET_KEY=<your server-side sb_secret_ key>
SUPABASE_STORAGE_BUCKET=claimly-documents
```

The Storage adapter sends the new secret key in the `apikey` header, not as a
Bearer JWT. It requires HTTPS, does not follow redirects, checks that the bucket
is private before upload, and never creates public URLs or changes bucket privacy.
See [Supabase API key documentation](https://supabase.com/docs/guides/getting-started/api-keys).
It uses a small HTTPX REST adapter rather than adding a full Supabase SDK.

## Run and test on Windows PowerShell

```powershell
Set-Location C:\Users\Lenovo\zimran-project\services\backend
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --no-proxy-headers
```

All automated upload tests mock PostgreSQL and Storage. They include real
synthetic PDF/image parsing, HTTP response-schema validation against the checked-in
contract, retries, capacity limits, and failure recovery. They do not establish
that migration 0003 executes successfully on a live server; live end-to-end testing
is a separate next step after applying it.

## Safely test one real PDF upload

Create a small synthetic PDF containing invented demonstration text. Keep it
under 10 MB and 25 pages; do not use a real receipt, policy, or identity document.
Open <http://127.0.0.1:8000/docs> and use the following endpoints, or use a second
PowerShell terminal. These requests **will create real database and Storage data**.
They do not invoke any model.

```powershell
$entryKey = [guid]::NewGuid().ToString()
$entryBody = @{ title = 'Synthetic PDF upload test'; category = 'other' } | ConvertTo-Json
$entry = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8000/api/v1/entries' -ContentType 'application/json' -Headers @{ 'Idempotency-Key' = $entryKey } -Body $entryBody
$entryId = $entry.data.id

# Replace with the path to your synthetic PDF, without quotes in its filename.
$pdfPath = 'C:\Temp\claimly-synthetic.pdf'
$uploadKey = [guid]::NewGuid().ToString()
$upload = curl.exe --fail-with-body --silent --show-error -X POST 'http://127.0.0.1:8000/api/v1/documents' -H "Idempotency-Key: $uploadKey" --form-string "entry_id=$entryId" -F "file=@$pdfPath;type=application/pdf" | ConvertFrom-Json
$upload

Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/v1/documents/$($upload.data.document.id)"
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/v1/jobs/$($upload.data.job.id)"
```

Expected: entry HTTP 201, upload HTTP 202, document `status=uploaded`, and job
`status=queued`, `result=null`, `error=null`. Jobs stay queued because there is no
LLM worker yet. A valid document with zero extracted benefits is not fabricated.
Verify the private object and database records using the Supabase dashboard.
Keep the bucket private; there is no document preview/download endpoint yet.

On a network retry, reuse the same key and same request. Reusing a key for another
payload returns 409. Completed retries replay the saved response without another
file upload or job. Request IDs remain unique for each HTTP response.

## Validation and public-demo safeguards

- Only PDF, JPEG, and PNG MIME types with matching signatures are accepted.
- Empty, malformed, encrypted PDF, multi-frame image, oversized, or over-limit
  documents are rejected. PDF page limit is 25; image limit is 20 million pixels.
  Validation does not execute embedded PDF instructions or run OCR. It is not an
  antivirus service; all originals remain untrusted data.
- Original filenames are cleaned display metadata. Storage paths use workspace,
  entry, and random document UUIDs plus a validated extension. Uploads never upsert.
- Sample entries reject uploads; no edit/delete routes are exposed in this phase.
  Expired visitor entries reject uploads and their document/job reads return 404.
- One file per request; at most 5 documents/reservations per entry, 100 total
  documents/reservations, 250 MB of files/reservations, and 100 visitor entries.
  The document cap also bounds queued extract jobs. Sample files count towards
  the global file/storage caps.
- Mutation rate: 10 per client IP/minute and 30 globally/minute. Reads: 60 per IP
  and 180 globally/minute. These are fixed-window limits shared across API workers.
  Client IPs are hashed before persistence. Do not trust arbitrary forwarded IPs.
- Idempotency/intent records have a hard cap of 2000. Reservations, including
  ambiguous failed uploads, count towards capacity until recovered.
- Before multipart parsing, request bodies are capped (10 MB plus 64 KB multipart
  overhead; entry JSON 16 KB), limited to 15 seconds, and restricted to two
  concurrent mutations per API process. Use one worker for this small demo.
- A workspace advisory lock makes quota checks/reservations atomic. SQL queries
  have 5-second statement and 2-second lock timeouts. Storage has connection/read
  timeouts. No database transaction is held during the normal file upload.

Capacity failures return 429, so a full queue cannot grow forever while AI is
disabled. Expiry is not automatic physical deletion: scheduled visitor-retention
cleanup remains future work. Until then, operator cleanup must manage capacity.
Behind a reverse proxy, configure trusted proxy addresses and matching frontend
CORS origins explicitly; otherwise all visitors may share the proxy's IP limit.

## Storage/database failures and recovery

PostgreSQL and object storage cannot share one transaction. The implementation:

1. Commits an intent with unique path, metadata, checksum, IDs, and byte reservation.
2. Uploads bytes to private Storage using that path.
3. In one PostgreSQL transaction inserts document + queued job, increments the
   entry version, and saves the completed idempotency response.

A Storage failure may be ambiguous (the server accepted bytes before a timeout).
The intent becomes `cleanup_required`; even if that update fails, the original
`reserved` row tracks the path. A process crash leaves the same durable record.
No queued job is published before finalization.

On a database commit failure after Storage upload, the backend does **not** delete
the object: the commit might actually have succeeded. The same key can recover a
completed response. Incomplete intents return 409 until an operator recovers them.
No raw Storage/SQL exception details or secrets are returned in API errors.

To recover abandoned intents, **stop the API first** (Ctrl+C), wait until the
intent is at least 15 minutes old, then run:

```powershell
.\.venv\Scripts\python.exe -m app.cleanup_uploads --api-stopped
```

This privileged command processes up to 10 incomplete intents per run. It locks
each eligible intent, deletes only its recorded object through the Storage API,
then marks it cleaned to release its reservation. Completed uploads are excluded.
If deletion or commit fails, tracking remains and the command can be retried.
Repeat if more than 10 intents need recovery. After cleanup, use a **new**
Idempotency-Key to retry the original file. Keep original keys for completed
requests. This command does not delete successful visitor uploads or samples.

## Existing API contract conflict and frontend work

The checked-in v2.0.0 contract requires `X-Demo-Session`; the frontend bootstraps
`POST /api/v1/demo/sessions` before any data request. These routes intentionally
use the approved server-selected shared workspace with **no login or sessions**.
The contract files are unchanged; this is a documented security-model deviation,
not a claim of full v2.0.0 compliance. Public field names and response envelopes
are preserved, including required Idempotency-Key and contract-version headers.
Runtime `/openapi.json` documents the routes actually implemented.

Frontend integration still needs coordinated changes by its owner:

- Remove session bootstrap, headers, reset controls, and per-browser privacy copy.
- Add the shared-public warning before upload and show retention/resource limits.
- Use HTTP mode and the correct backend base URL; CORS currently allows localhost:3000.
- Keep multipart `entry_id` + `file`, one file per call, with stable retry keys.
- Treat queued jobs honestly while analysis is disabled; do not poll indefinitely.
- Implement the remaining backend entry lists/details, dashboard/profile, benefit
  retrieval, content preview, and later analysis/retry/cleanup flow. Those routes
  are not silently mocked by this upload implementation.

No frontend, LLM source, or shared contract files were modified.

## Diagnose Storage failures without retrying an upload

From the backend directory:

```powershell
.\.venv\Scripts\python.exe -m app.check_storage --idempotency-key YOUR-ORIGINAL-KEY --compare-project
```

This command performs only a bucket metadata GET and read-only database queries.
It checks the base URL, key type, configured bucket, project-reference match,
bucket existence in `storage.buckets`, and the existing upload-tracking row.
It displays booleans and safe tracking fields, never keys, connection strings,
request headers, filenames, object paths, or raw response messages. It does not
create a bucket, send a file, run recovery, or modify a database record.

Storage warnings now appear in the Uvicorn console with this safe format:

```text
storage_failure operation=bucket_check category=not_found http_status=400 storage_code=NoSuchBucket
```

The API still returns the original safe HTTP 503 envelope. The warning records
the **upstream** HTTP status, which can differ from 503. Supabase can return
`NoSuchBucket` with HTTP 400; classification therefore uses both known protocol
codes and HTTP status. Arbitrary response bodies/codes and exception text are
never logged. Categories distinguish authentication, permission, missing resources,
TLS certificate failures, DNS, network blocks, proxies, timeouts, redirects,
capacity, and malformed bucket metadata.

If `NoSuchBucket` is confirmed and PostgreSQL also reports that the configured
bucket ID/name is missing, create the intended **private** bucket in the correct
project, or configure the exact ID of an existing intended bucket. Do not make
the bucket public or loosen RLS to address a missing bucket. The current adapter
already sends new `sb_secret_` keys through `apikey`, not `Authorization: Bearer`.
Keep TLS verification enabled. Connect/read timeouts remain 10/30 seconds.

Live changes and live upload retries require the operator's approval. When an
upload failed during `bucket_check`, it ran before reservation and sent no file:
if the original key has no tracking row, retry the **same key, entry, filename,
MIME, and bytes** after fixing the bucket and restarting Uvicorn. Ensure the
visitor entry has not expired. A new entry is needed if it has expired.

If tracking instead shows `completed`, replay the same key to recover its response.
If it shows `reserved` or `cleanup_required`, inspect/recover that attempt before
resending bytes; do not bypass it with a new key or run deletion automatically.
The diagnostics do not prove that object writes are allowed: only an explicitly
approved upload can verify that end-to-end.
