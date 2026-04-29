DROP INDEX IF EXISTS idx_task_runs_pending_not_before;

ALTER TABLE task_runs
DROP COLUMN not_before;
