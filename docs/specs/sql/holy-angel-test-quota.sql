-- Dedicated test D1 only. Apply after ensuring only the test DB is selected.
-- Trigger aborts inserts above 25 and automatically counts successful inserts.
CREATE TABLE IF NOT EXISTS holy_angel_test_quota (
  name TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0 AND used <= 25)
);
INSERT OR IGNORE INTO holy_angel_test_quota(name,used) VALUES ('workspaces',0);

CREATE TRIGGER IF NOT EXISTS holy_angel_test_workspace_quota
BEFORE INSERT ON workspaces
BEGIN
  SELECT CASE WHEN
    (SELECT used FROM holy_angel_test_quota WHERE name='workspaces') IS NULL
    OR (SELECT used FROM holy_angel_test_quota WHERE name='workspaces') >= 25
    THEN RAISE(ABORT, 'test workspace quota exhausted')
  END;
  UPDATE holy_angel_test_quota SET used=used+1 WHERE name='workspaces';
END;
-- SQLite trigger and INSERT are one atomic statement: failed insert rolls back counter.
-- Never reset the counter automatically; migration applies only to isolated test DB.
