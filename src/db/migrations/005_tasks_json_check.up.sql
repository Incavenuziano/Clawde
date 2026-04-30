-- Migration 005 (UP) — enforce json_valid checks on tasks JSON text columns.
-- P1.5 (T-086/T-087): depends_on + source_metadata.

CREATE TABLE tasks_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  priority        TEXT    NOT NULL DEFAULT 'NORMAL'
                  CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  prompt          TEXT    NOT NULL,
  agent           TEXT    NOT NULL DEFAULT 'default',
  session_id      TEXT,
  working_dir     TEXT,
  depends_on      TEXT    NOT NULL DEFAULT '[]'
                  CHECK (json_valid(depends_on)),
  source          TEXT    NOT NULL
                  CHECK (source IN (
                    'cli', 'telegram', 'webhook-github', 'webhook-generic',
                    'cron', 'subagent'
                  )),
  source_metadata TEXT    NOT NULL DEFAULT '{}'
                  CHECK (json_valid(source_metadata)),
  dedup_key       TEXT    UNIQUE,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO tasks_new
SELECT *
FROM tasks;

DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

CREATE INDEX idx_tasks_priority_created ON tasks(priority, created_at);
CREATE INDEX idx_tasks_session ON tasks(session_id) WHERE session_id IS NOT NULL;

CREATE TRIGGER tasks_no_update
BEFORE UPDATE ON tasks
BEGIN
  SELECT RAISE(FAIL, 'tasks is immutable after INSERT (ADR 0007)');
END;
