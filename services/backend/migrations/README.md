# Supabase database foundation (Phase 3A)

These are ordered, manually applied PostgreSQL migrations for Supabase. They
do not run on API startup. No live project was contacted during implementation.

## Apply later using Supabase SQL Editor

1. Select the intended hackathon Supabase project in the dashboard.
2. Open SQL Editor as the database owner. Paste the entire contents of
   `0001_database_foundation.sql` into a new query and run it once.
3. After success, run the entire `0002_shared_workspace.sql` in a second query.
4. Record the applied filenames and date in your team's deployment notes.
   Migration 0001 intentionally fails if already applied; do not remove tables
   to force a rerun. Add a new numbered migration for subsequent schema changes.
   Migration 0002 safely skips an existing workspace.
5. Verify with the following read-only query in SQL Editor:

```sql
SELECT id, name FROM claimly.workspaces;
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'claimly';
```

The first query should return workspace UUID
`10000000-0000-4000-8000-000000000000`; the second should list six tables with
`rowsecurity = true`. Both migrations have explicit transactions, so a failed
migration should not leave half its changes applied.

The `anon`, `authenticated`, and `service_role` roles are supplied by Supabase.
These scripts assume those roles exist. They do not create user accounts or Auth
configuration. Keep `claimly` out of Supabase's exposed Data API schemas.

## Tables and relationships

All tables have UUID primary keys and timezone-aware creation/update timestamps.
Update triggers maintain `updated_at`; future application writes must explicitly
increment document/data versions when their underlying data changes.

| Table | Stores |
| --- | --- |
| `workspaces` | The one fixed public demo workspace; other UUIDs are rejected. |
| `entries` | Vault title, category, company, subject, facts, version, and sample/expiry metadata. |
| `documents` | Original file location, MIME, size, SHA-256, version, analysis status, and extracted facts. File bytes belong in private Storage later. |
| `analysis_jobs` | Extract-only queue state, input document version, result/error, attempts, schedule, and worker lease fields. No worker is implemented yet. |
| `document_pages` | Page text, page number, document version, and review flag. |
| `benefits` | Extracted benefit, source document/version, candidate key, evidence, limits, deadline information, and unknown/confirmed usage. |

Entries belong to the workspace. Documents belong to entries; pages and jobs
belong to documents. Benefits reference a document in the same entry and
workspace. Composite foreign keys reject mismatched relationships. Deleting an
entry cascades to its dependent database records; it does **not** delete Storage
files. Do not add a public deletion flow before implementing tracked file cleanup.

Document states: `uploaded`, `processing`, `needs_review`, `ready`, `failed`.
Job states: `queued`, `running`, `succeeded`, `failed`, `cancelled`, `stale`.
Only one queued/running job per document is allowed. Unique page and candidate
keys support later retry-safe writes. Worker claiming, retries, evidence validation,
stale-version checks, and version increments are application work for a later phase.
JSONB columns hold contract-shaped facts, evidence, and results; SQL does not
fully validate those nested API schemas.

Indexes support entry lists, entry documents/benefits, hashes, deadlines, expired
visitor entries, queued jobs, and expired worker leases. There is no vector DB.

## Sample and visitor lifecycle

The lifecycle is stored on the owning **entry** and inherited by its documents,
jobs, pages, and benefits. Future uploads should create visitor entries rather
than mix visitor documents into a protected sample entry.

- Samples: `is_sample = true`, a stable unique `sample_key`, and explicit
  `expires_at = NULL`. Use the key for idempotent future seed writes.
- Visitor records: `is_sample = false`, `sample_key = NULL`, and a required
  `expires_at` (default 24 hours after creation).
- Cleanup is not implemented. A later scheduled backend task must select expired
  non-sample entries, coordinate active workers, delete Storage objects, and then
  remove dependent records with retry handling. Expiry alone does not hide or delete rows.
- Sample protection from public edits will be enforced by future backend routes.
  The privileged database role can still edit sample records.

Only the workspace is seeded now. No fake document, nonexistent Storage object,
or fabricated analysis is inserted. Real synthetic sample files and reviewed
results can be seeded in a later phase without changing these tables.

## Access boundary and verification limits

All tables enable RLS with no browser policies. Schema/table/function privileges
are revoked from `PUBLIC`, `anon`, and `authenticated`; `service_role` receives
schema usage and table CRUD. Database owners and privileged server roles can
bypass RLS, so future backend code must still select the configured workspace
and validate every referenced object. No credentials belong in the frontend.

Offline tests parse SQL using PostgreSQL's parser and check basic RLS boundaries.
They cannot prove migrations execute successfully, FK enforcement, trigger
behaviour, or permissions on a live Supabase project. Those integration checks
remain for the separately authorized migration/deployment phase.
