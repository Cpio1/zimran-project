-- Seed only the shared workspace. No fabricated analysis or missing file records.
BEGIN;
INSERT INTO claimly.workspaces (id, name)
VALUES ('10000000-0000-4000-8000-000000000000', 'Claimly public demo')
ON CONFLICT (id) DO NOTHING;
COMMIT;
