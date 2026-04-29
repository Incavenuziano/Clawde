/**
 * Task = intenção, IMUTÁVEL após INSERT.
 * TaskRun = cada tentativa de execução; transições governadas por TASK_RUN_TRANSITIONS.
 * Ver ADR 0007.
 */

export const PRIORITY_VALUES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type Priority = (typeof PRIORITY_VALUES)[number];

export const TASK_RUN_STATUS_VALUES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "abandoned",
] as const;
export type TaskRunStatus = (typeof TASK_RUN_STATUS_VALUES)[number];

export const TASK_SOURCE_VALUES = [
  "cli",
  "telegram",
  "webhook-github",
  "webhook-generic",
  "cron",
  "subagent",
] as const;
export type TaskSource = (typeof TASK_SOURCE_VALUES)[number];

export interface Task {
  readonly id: number;
  readonly priority: Priority;
  readonly prompt: string;
  readonly agent: string;
  readonly sessionId: string | null;
  readonly workingDir: string | null;
  readonly dependsOn: ReadonlyArray<number>;
  readonly source: TaskSource;
  readonly sourceMetadata: Readonly<Record<string, unknown>>;
  readonly dedupKey: string | null;
  readonly createdAt: string;
}

export type NewTask = Omit<Task, "id" | "createdAt">;

export interface TaskRun {
  readonly id: number;
  readonly taskId: number;
  readonly attemptN: number;
  readonly workerId: string;
  readonly status: TaskRunStatus;
  readonly notBefore: string | null;
  readonly leaseUntil: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly result: string | null;
  readonly error: string | null;
  readonly msgsConsumed: number;
}

/**
 * Transições válidas para TaskRun.status.
 * Validação real em src/state/transitions.ts (F1.T18).
 */
export const TASK_RUN_TRANSITIONS: Readonly<Record<TaskRunStatus, ReadonlyArray<TaskRunStatus>>> = {
  pending: ["running", "abandoned"],
  running: ["succeeded", "failed", "abandoned"],
  succeeded: [],
  failed: [],
  abandoned: ["pending"],
};
