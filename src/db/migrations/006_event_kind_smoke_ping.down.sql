-- Migration 006 (DOWN) — remove smoke SDK ping event kinds.

CREATE TABLE events_old (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT    NOT NULL DEFAULT (datetime('now')),
  task_run_id  INTEGER REFERENCES task_runs(id) ON DELETE SET NULL,
  session_id   TEXT    REFERENCES sessions(session_id) ON DELETE SET NULL,
  trace_id     TEXT,
  span_id      TEXT,
  kind         TEXT    NOT NULL
               CHECK (kind IN (
                 'enqueue',
                 'auth_fail',
                 'rate_limit_hit',
                 'dedup_skip',
                 'task_deferred',
                 'task_start',
                 'task_finish',
                 'task_fail',
                 'lease_expired',
                 'quarantine_enter',
                 'quarantine_exit',
                 'claude_invocation_start',
                 'claude_invocation_end',
                 'tool_use',
                 'tool_result',
                 'tool_blocked',
                 'compact_triggered',
                 'quota_threshold_crossed',
                 'quota_reset',
                 'peak_multiplier_applied',
                 'quota_429_observed',
                 'oauth_refresh_attempt',
                 'oauth_refresh_success',
                 'oauth_expiry_warning',
                 'auth.telegram_reject',
                 'auth.telegram_user_blocked',
                 'sandbox_init',
                 'sandbox_violation',
                 'migration_start',
                 'migration_end',
                 'migration_fail',
                 'maintenance_start',
                 'maintenance_end',
                 'prompt_guard_alert',
                 'panic_stop',
                 'hook_error',
                 'hook_timeout',
                 'lesson',
                 'reflection_start',
                 'reflection_end',
                 'review.implementer.start',
                 'review.implementer.end',
                 'review.spec.start',
                 'review.spec.verdict',
                 'review.quality.start',
                 'review.quality.verdict',
                 'review.pipeline.complete',
                 'review.pipeline.exhausted',
                 'agent_invalid',
                 'sdk_auth_error',
                 'sdk_network_error'
               )),
  payload      TEXT    NOT NULL DEFAULT '{}'
               CHECK (json_valid(payload))
);

INSERT INTO events_old
SELECT *
FROM events
WHERE kind NOT IN ('smoke.sdk_real_ping_ok', 'smoke.sdk_real_ping_fail');

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
