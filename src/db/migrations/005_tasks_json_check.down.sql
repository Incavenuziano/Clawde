-- Migration 005 (DOWN) — remove json_valid checks from tasks JSON text columns.

CREATE TABLE tasks_old (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  priority        TEXT    NOT NULL DEFAULT 'NORMAL'
                  CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  prompt          TEXT    NOT NULL,
  agent           TEXT    NOT NULL DEFAULT 'default',
  session_id      TEXT,
  working_dir     TEXT,
  depends_on      TEXT    NOT NULL DEFAULT '[]',
  source          TEXT    NOT NULL
                  CHECK (source IN (
                    'cli', 'telegram', 'webhook-github', 'webhook-generic',
                    'cron', 'subagent'
                  )),
  source_metadata TEXT    NOT NULL DEFAULT '{}',
  dedup_key       TEXT    UNIQUE,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO tasks_old
SELECT *
FROM tasks;

DROP TABLE tasks;
ALTER TABLE tasks_old RENAME TO tasks;

CREATE INDEX idx_tasks_priority_created ON tasks(priority, created_at);
CREATE INDEX idx_tasks_session ON tasks(session_id) WHERE session_id IS NOT NULL;

CREATE TRIGGER tasks_no_update
BEFORE UPDATE ON tasks
BEGIN
  SELECT RAISE(FAIL, 'tasks is immutable after INSERT (ADR 0007)');
END;
