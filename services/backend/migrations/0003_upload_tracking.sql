-- Apply after 0001 and 0002. No Storage or LLM calls are made by this migration.
BEGIN;
CREATE TABLE claimly.mutation_requests (
    workspace_id uuid NOT NULL REFERENCES claimly.workspaces(id),
    operation text NOT NULL CHECK (operation IN ('entry', 'upload')),
    key_hash text NOT NULL,
    fingerprint text NOT NULL,
    state text NOT NULL CHECK (state IN ('reserved', 'completed', 'cleanup_required', 'cleaned')),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    response jsonb,
    storage_bucket text,
    storage_path text,
    size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, operation, key_hash),
    UNIQUE (storage_bucket, storage_path),
    CHECK (operation <> 'upload' OR (storage_bucket IS NOT NULL AND storage_path IS NOT NULL AND size_bytes > 0)),
    CHECK ((state = 'completed') = (response IS NOT NULL))
);
CREATE INDEX upload_recovery_idx ON claimly.mutation_requests(updated_at)
    WHERE operation = 'upload' AND state IN ('reserved', 'cleanup_required');
CREATE TRIGGER mutation_requests_updated BEFORE UPDATE ON claimly.mutation_requests
    FOR EACH ROW EXECUTE FUNCTION claimly.set_updated_at();

CREATE TABLE claimly.rate_limit_buckets (
    workspace_id uuid NOT NULL REFERENCES claimly.workspaces(id),
    bucket_key text NOT NULL,
    window_start timestamptz NOT NULL,
    requests integer NOT NULL CHECK (requests > 0),
    PRIMARY KEY (workspace_id, bucket_key, window_start)
);
ALTER TABLE claimly.mutation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE claimly.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON claimly.mutation_requests, claimly.rate_limit_buckets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON claimly.mutation_requests, claimly.rate_limit_buckets TO service_role;
COMMIT;
