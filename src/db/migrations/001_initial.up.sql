-- Migration 001 (UP) — schema inicial completo do Clawde.
-- Referências: ARCHITECTURE.md §11.2, BLUEPRINT.md §2, ADR 0007 (tasks vs task_runs).
--
-- PRAGMAs do client (openDb): journal_mode=WAL, busy_timeout=5000,
--   synchronous=NORMAL, foreign_keys=ON.
-- Esta migration assume foreign_keys=ON.

-- =========================================================================
-- Tabela de versionamento de migrations
-- =========================================================================
CREATE TABLE IF NOT EXISTS _migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- =========================================================================
-- tasks — intenção, IMUTÁVEL após INSERT (ADR 0007)
-- =========================================================================
CREATE TABLE tasks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  priority        TEXT    NOT NULL DEFAULT 'NORMAL'
                  CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  prompt          TEXT    NOT NULL,
  agent           TEXT    NOT NULL DEFAULT 'default',
  session_id      TEXT,
  working_dir     TEXT,
  depends_on      TEXT    NOT NULL DEFAULT '[]',  -- JSON array de task IDs
  source          TEXT    NOT NULL
                  CHECK (source IN (
                    'cli', 'telegram', 'webhook-github', 'webhook-generic',
                    'cron', 'subagent'
                  )),
  source_metadata TEXT    NOT NULL DEFAULT '{}',  -- JSON
  dedup_key       TEXT    UNIQUE,                  -- NULL não conflita (SQLite default)
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tasks_priority_created ON tasks(priority, created_at);
CREATE INDEX idx_tasks_session ON tasks(session_id) WHERE session_id IS NOT NULL;

-- Trigger: tasks é imutável após INSERT.
CREATE TRIGGER tasks_no_update
BEFORE UPDATE ON tasks
BEGIN
  SELECT RAISE(FAIL, 'tasks is immutable after INSERT (ADR 0007)');
END;

-- =========================================================================
-- task_runs — cada tentativa de execução (lease/heartbeat)
-- =========================================================================
CREATE TABLE task_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id        INTEGER NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  attempt_n      INTEGER NOT NULL DEFAULT 1,
  worker_id      TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'pending'
                 CHECK (status IN (
                   'pending', 'running', 'succeeded', 'failed', 'abandoned'
                 )),
  lease_until    TEXT,
  started_at     TEXT,
  finished_at    TEXT,
  result         TEXT,
  error          TEXT,
  msgs_consumed  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (task_id, attempt_n)
);

CREATE INDEX idx_task_runs_status_lease ON task_runs(status, lease_until);
CREATE INDEX idx_task_runs_task ON task_runs(task_id);

-- =========================================================================
-- sessions — sessões Claude (UUID determinístico como PK)
-- =========================================================================
CREATE TABLE sessions (
  session_id     TEXT    PRIMARY KEY,
  agent          TEXT    NOT NULL,
  state          TEXT    NOT NULL DEFAULT 'created'
                 CHECK (state IN (
                   'created', 'active', 'idle', 'stale',
                   'compact_pending', 'archived'
                 )),
  last_used_at   TEXT,
  msg_count      INTEGER NOT NULL DEFAULT 0,
  token_estimate INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sessions_state ON sessions(state);

-- =========================================================================
-- messages — espelha JSONL nativo localmente
-- =========================================================================
CREATE TABLE messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT    NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  role       TEXT    NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content    TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_messages_session ON messages(session_id);

-- =========================================================================
-- messages_fts — busca full-text (FTS5 trigram, multi-idioma)
-- =========================================================================
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='id',
  tokenize='trigram'
);

CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;
CREATE TRIGGER messages_fts_update AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;

-- =========================================================================
-- quota_ledger — sliding window 5h (ARCHITECTURE §6.6)
-- =========================================================================
CREATE TABLE quota_ledger (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT    NOT NULL DEFAULT (datetime('now')),
  msgs_consumed   INTEGER NOT NULL DEFAULT 1,
  window_start    TEXT    NOT NULL,
  plan            TEXT    NOT NULL CHECK (plan IN ('pro', 'max5x', 'max20x')),
  peak_multiplier REAL    NOT NULL DEFAULT 1.0,
  task_run_id     INTEGER REFERENCES task_runs(id) ON DELETE SET NULL
);

CREATE INDEX idx_quota_window ON quota_ledger(window_start);

-- =========================================================================
-- events — audit append-only (BEST_PRACTICES §7.1)
-- =========================================================================
CREATE TABLE events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT    NOT NULL DEFAULT (datetime('now')),
  task_run_id  INTEGER REFERENCES task_runs(id) ON DELETE SET NULL,
  session_id   TEXT    REFERENCES sessions(session_id) ON DELETE SET NULL,
  trace_id     TEXT,
  span_id      TEXT,
  kind         TEXT    NOT NULL,
  payload      TEXT    NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_events_task_ts ON events(task_run_id, ts);
CREATE INDEX idx_events_trace ON events(trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX idx_events_kind_ts ON events(kind, ts);

-- Tabela de "grant" para o job de retenção poder DELETE.
-- Linha presente = autoriza próximo DELETE; consumida pelo trigger.
CREATE TABLE _retention_grant (
  id INTEGER PRIMARY KEY,
  granted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Append-only: bloqueia UPDATE e DELETE em events, exceto se _retention_grant tem linha.
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

-- =========================================================================
-- memory_observations — observations indexáveis (ADR 0009)
-- =========================================================================
CREATE TABLE memory_observations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id        TEXT    REFERENCES sessions(session_id) ON DELETE SET NULL,
  source_jsonl      TEXT,
  kind              TEXT    NOT NULL DEFAULT 'observation'
                    CHECK (kind IN ('observation', 'summary', 'decision', 'lesson')),
  content           TEXT    NOT NULL,
  importance        REAL    NOT NULL DEFAULT 0.5
                    CHECK (importance >= 0.0 AND importance <= 1.0),
  consolidated_into INTEGER REFERENCES memory_observations(id) ON DELETE SET NULL,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_memory_kind ON memory_observations(kind);
CREATE INDEX idx_memory_session ON memory_observations(session_id) WHERE session_id IS NOT NULL;

-- =========================================================================
-- memory_fts — busca full-text de observations (FTS5 trigram)
-- =========================================================================
CREATE VIRTUAL TABLE memory_fts USING fts5(
  content,
  content='memory_observations',
  content_rowid='id',
  tokenize='trigram'
);

CREATE TRIGGER memory_fts_insert AFTER INSERT ON memory_observations BEGIN
  INSERT INTO memory_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER memory_fts_delete AFTER DELETE ON memory_observations BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;
CREATE TRIGGER memory_fts_update AFTER UPDATE ON memory_observations BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO memory_fts(rowid, content) VALUES (new.id, new.content);
END;
