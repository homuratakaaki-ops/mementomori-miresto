import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
quota_sql = (root / "docs/specs/sql/holy-angel-test-quota.sql").read_text()
connection = sqlite3.connect(":memory:")
connection.executescript("""
CREATE TABLE workspaces (
 id TEXT PRIMARY KEY NOT NULL,
 edit_token_hash TEXT NOT NULL,
 document_json TEXT NOT NULL,
 remote_revision INTEGER NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 deleted_at TEXT
);
""")
connection.executescript(quota_sql)
for index in range(25):
    connection.execute("INSERT INTO workspaces VALUES (?,?,?,?,?,?,?)", (
        str(index), "hash", "{}", 0, "now", "now", None
    ))
assert connection.execute("SELECT used FROM holy_angel_test_quota").fetchone()[0] == 25
for item in ("26", "1"):
    try:
        connection.execute("INSERT INTO workspaces VALUES (?,?,?,?,?,?,?)", (
            item, "hash", "{}", 0, "now", "now", None
        ))
        raise AssertionError("insert should have been refused")
    except sqlite3.IntegrityError:
        pass
assert connection.execute("SELECT used FROM holy_angel_test_quota").fetchone()[0] == 25
assert connection.execute("SELECT COUNT(*) FROM workspaces").fetchone()[0] == 25
print("PASS D1 compatible SQLite atomic quota test: 25 allowed, cap and duplicate rejected")
