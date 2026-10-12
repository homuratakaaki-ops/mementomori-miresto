-- Test DB only. Apply separately after review, never to a production database.
-- Permanent lifetime cap: at most 25 creation attempts may pass the quota gate.
CREATE TABLE IF NOT EXISTS holy_angel_test_quota (
  name TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0 AND used <= 25)
);
INSERT OR IGNORE INTO holy_angel_test_quota(name,used) VALUES ('workspaces',0);
-- Server gate: UPDATE ... SET used=used+1 WHERE name='workspaces' AND used<25;
-- If changed rows != 1, fail closed. Do not reset this counter automatically.
