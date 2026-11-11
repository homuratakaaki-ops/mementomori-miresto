-- Stage 14, test-only D1 schema. Do not execute against production or existing DBs.
-- Database: holy-angel-gacha-test-db; Worker binding: DB.
-- Edit secrets must be hashed in application code before insertion.
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  edit_token_hash TEXT NOT NULL,
  document_json TEXT NOT NULL,
  remote_revision INTEGER NOT NULL DEFAULT 0 CHECK (remote_revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_workspaces_active_updated
  ON workspaces(updated_at) WHERE deleted_at IS NULL;
