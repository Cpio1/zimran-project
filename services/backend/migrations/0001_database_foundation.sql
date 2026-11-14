-- Run once, in order, as the Supabase database owner (not from the browser).
BEGIN;

CREATE SCHEMA claimly;
REVOKE ALL ON SCHEMA claimly FROM PUBLIC, anon, authenticated;

CREATE FUNCTION claimly.set_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TABLE claimly.workspaces (
    id uuid PRIMARY KEY CHECK (id = '10000000-0000-4000-8000-000000000000'::uuid),
    name text NOT NULL CHECK (length(trim(name)) > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE claimly.entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES claimly.workspaces(id) ON DELETE RESTRICT,
    title text NOT NULL CHECK (length(trim(title)) > 0),
    category text NOT NULL CHECK (category IN ('receipt', 'warranty', 'insurance',
        'service_agreement', 'service_contract', 'gift_certificate', 'subscription',
        'membership', 'refund_confirmation', 'correspondence', 'other')),
    provider text,
    subject text,
    facts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(facts) = 'object'),
    data_version integer NOT NULL DEFAULT 1 CHECK (data_version >= 1),
    is_sample boolean NOT NULL DEFAULT false,
    sample_key text CHECK (length(trim(sample_key)) > 0),
    expires_at timestamptz DEFAULT (now() + interval '24 hours'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, sample_key),
    CHECK ((is_sample AND sample_key IS NOT NULL AND expires_at IS NULL)
        OR (NOT is_sample AND sample_key IS NULL AND expires_at IS NOT NULL)),
    CHECK (expires_at IS NULL OR expires_at > created_at)
);

-- Entry lifecycle governs all its documents, pages, jobs, and benefits.
-- A later upload handler must reject additions/edits to protected sample entries.
CREATE TABLE claimly.documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    name text NOT NULL CHECK (length(trim(name)) > 0),
    mime_type text NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
    storage_bucket text NOT NULL CHECK (length(trim(storage_bucket)) > 0),
    storage_path text NOT NULL CHECK (length(trim(storage_path)) > 0),
    size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    status text NOT NULL DEFAULT 'uploaded'
        CHECK (status IN ('uploaded', 'processing', 'needs_review', 'ready', 'failed')),
    page_count integer CHECK (page_count BETWEEN 0 AND 25),
    facts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(facts) = 'object'),
    review_flags jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(review_flags) = 'array'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, entry_id, id),
    UNIQUE (storage_bucket, storage_path),
    FOREIGN KEY (workspace_id, entry_id)
        REFERENCES claimly.entries(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE claimly.analysis_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    document_id uuid NOT NULL,
    document_version integer NOT NULL CHECK (document_version >= 1),
    kind text NOT NULL DEFAULT 'extract' CHECK (kind = 'extract'),
    status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'stale')),
    progress integer CHECK (progress BETWEEN 0 AND 100),
    result jsonb CHECK (jsonb_typeof(result) = 'object'),
    error jsonb CHECK (jsonb_typeof(error) = 'object'),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
    available_at timestamptz NOT NULL DEFAULT now(),
    lease_expires_at timestamptz,
    locked_by text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (workspace_id, document_id)
        REFERENCES claimly.documents(workspace_id, id) ON DELETE CASCADE,
    CHECK (attempts <= max_attempts)
);

-- Versions are snapshots. A future worker must compare them with the document's
-- current version before applying results; historical jobs must not block bumps.
CREATE TABLE claimly.document_pages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    document_id uuid NOT NULL,
    document_version integer NOT NULL CHECK (document_version >= 1),
    page integer NOT NULL CHECK (page BETWEEN 1 AND 25),
    text text NOT NULL,
    needs_review boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, document_id, document_version, page),
    FOREIGN KEY (workspace_id, document_id)
        REFERENCES claimly.documents(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE claimly.benefits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    document_id uuid NOT NULL,
    document_version integer NOT NULL CHECK (document_version >= 1),
    candidate_key text NOT NULL CHECK (length(trim(candidate_key)) > 0),
    title text NOT NULL CHECK (length(trim(title)) > 0),
    type text NOT NULL CHECK (type IN ('service', 'warranty_coverage', 'insurance_coverage',
        'voucher', 'membership_benefit', 'return_option', 'other')),
    description text NOT NULL,
    conditions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(conditions) = 'array'),
    instructions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(instructions) = 'array'),
    evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_refs) = 'array'),
    units_total integer CHECK (units_total > 0),
    stated_value_cents bigint CHECK (stated_value_cents >= 0),
    currency text CHECK (currency = 'USD'),
    deadline_rule jsonb CHECK (jsonb_typeof(deadline_rule) = 'object'),
    deadline_date date,
    deadline_status text NOT NULL DEFAULT 'not_known'
        CHECK (deadline_status IN ('document_confirmed', 'user_set', 'needs_review', 'not_known')),
    needs_review boolean NOT NULL DEFAULT true,
    usage_state text NOT NULL DEFAULT 'unknown'
        CHECK (usage_state IN ('unknown', 'unused', 'partial', 'used')),
    used_units integer CHECK (used_units >= 0),
    remaining_units integer CHECK (remaining_units >= 0),
    data_version integer NOT NULL DEFAULT 1 CHECK (data_version >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, document_id, candidate_key),
    FOREIGN KEY (workspace_id, entry_id, document_id)
        REFERENCES claimly.documents(workspace_id, entry_id, id) ON DELETE CASCADE,
    CHECK (units_total IS NULL OR used_units IS NULL OR used_units <= units_total),
    CHECK ((usage_state = 'unknown' AND used_units IS NULL AND remaining_units IS NULL)
        OR (usage_state <> 'unknown' AND used_units IS NOT NULL
            AND remaining_units IS NOT DISTINCT FROM
                CASE WHEN units_total IS NOT NULL THEN units_total - used_units ELSE NULL END))
);

CREATE INDEX entries_workspace_created_idx ON claimly.entries(workspace_id, created_at DESC, id);
CREATE INDEX entries_cleanup_idx ON claimly.entries(expires_at, id) WHERE NOT is_sample;
CREATE INDEX documents_entry_idx ON claimly.documents(workspace_id, entry_id, created_at, id);
CREATE INDEX documents_hash_idx ON claimly.documents(workspace_id, sha256);
CREATE INDEX jobs_document_idx ON claimly.analysis_jobs(workspace_id, document_id, created_at DESC);
CREATE INDEX jobs_queue_idx ON claimly.analysis_jobs(available_at, created_at, id) WHERE status = 'queued';
CREATE INDEX jobs_lease_idx ON claimly.analysis_jobs(lease_expires_at) WHERE status = 'running';
CREATE UNIQUE INDEX jobs_one_active_document_idx ON claimly.analysis_jobs(workspace_id, document_id)
    WHERE status IN ('queued', 'running');
CREATE INDEX benefits_entry_idx ON claimly.benefits(workspace_id, entry_id, id);
CREATE INDEX benefits_deadline_idx ON claimly.benefits(workspace_id, deadline_date, id);

CREATE TRIGGER workspaces_updated BEFORE UPDATE ON claimly.workspaces
    FOR EACH ROW EXECUTE FUNCTION claimly.set_updated_at();
CREATE TRIGGER entries_updated BEFORE UPDATE ON claimly.entries
    FOR EACH ROW EXECUTE FUNCTION claimly.set_updated_at();
CREATE TRIGGER documents_updated BEFORE UPDATE ON claimly.documents
    FOR EACH ROW EXECUTE FUNCTION claimly.set_updated_at();
CREATE TRIGGER jobs_updated BEFORE UPDATE ON claimly.analysis_jobs
    FOR EACH ROW EXECUTE FUNCTION claimly.set_updated_at();
CREATE TRIGGER pages_updated BEFORE UPDATE ON claimly.document_pages
    FOR EACH ROW EXECUTE FUNCTION claimly.set_updated_at();
CREATE TRIGGER benefits_updated BEFORE UPDATE ON claimly.benefits
    FOR EACH ROW EXECUTE FUNCTION claimly.set_updated_at();

-- No browser policies: shared public access will be mediated by the Backend.
ALTER TABLE claimly.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE claimly.entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE claimly.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE claimly.analysis_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE claimly.document_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE claimly.benefits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA claimly FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA claimly FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA claimly TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA claimly TO service_role;

COMMIT;
