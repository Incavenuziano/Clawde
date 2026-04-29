ALTER TABLE task_runs
ADD COLUMN not_before TEXT;

CREATE INDEX IF NOT EXISTS idx_task_runs_pending_not_before
ON task_runs(status, not_before)
WHERE status = 'pending';
