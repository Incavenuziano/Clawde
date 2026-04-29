/**
 * Workspace = git worktree ephemeral por task_run (ARCHITECTURE §9.9, ADR 0007).
 * Path determinístico: /tmp/clawde-<task_run_id>; branch: clawde/<task_id>-<slug>.
 */

export interface Workspace {
  readonly path: string;
  readonly baseBranch: string;
  readonly featureBranch: string;
  readonly taskRunId: number;
  readonly createdAt: string;
}
