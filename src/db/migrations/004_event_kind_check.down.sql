-- Migration 004 (DOWN) — remove EventKind/json_valid checks from events table.

CREATE TABLE events_old (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT    NOT NULL DEFAULT (datetime('now')),
  task_run_id  INTEGER REFERENCES task_runs(id) ON DELETE SET NULL,
  session_id   TEXT    REFERENCES sessions(session_id) ON DELETE SET NULL,
  trace_id     TEXT,
  span_id      TEXT,
  kind         TEXT    NOT NULL,
  payload      TEXT    NOT NULL DEFAULT '{}'
);

INSERT INTO events_old SELECT * FROM events;
DROP TABLE events;
ALTER TABLE events_old RENAME TO events;

CREATE INDEX idx_events_task_ts ON events(task_run_id, ts);
CREATE INDEX idx_events_trace ON events(trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX idx_events_kind_ts ON events(kind, ts);

CREATE TRIGGER events_no_update
BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(FAIL, 'events is append-only');
END;

CREATE TRIGGER events_no_delete
BEFORE DELETE ON events
WHEN (SELECT COUNT(*) FROM _retention_grant) = 0
BEGIN
  SELECT RAISE(FAIL, 'events is append-only outside retention job');
END;
