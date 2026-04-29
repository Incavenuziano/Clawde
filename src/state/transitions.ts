/**
 * Validação central de transições de estado.
 * Reusada por src/db/repositories/{task-runs,sessions}.ts.
 *
 * Mapas canônicos: TASK_RUN_TRANSITIONS (domain/task) e SESSION_TRANSITIONS
 * (domain/session).
 */

import { SESSION_TRANSITIONS, type SessionState } from "@clawde/domain/session";
import { TASK_RUN_TRANSITIONS, type TaskRunStatus } from "@clawde/domain/task";

export class InvalidTransitionError extends Error {
  constructor(
    public readonly entity: "task_run" | "session",
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`invalid ${entity} transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function validateTaskRunTransition(from: TaskRunStatus, to: TaskRunStatus): void {
  const allowed = TASK_RUN_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new InvalidTransitionError("task_run", from, to);
  }
}

export function validateSessionTransition(from: SessionState, to: SessionState): void {
  const allowed = SESSION_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new InvalidTransitionError("session", from, to);
  }
}

export function canTaskRunTransition(from: TaskRunStatus, to: TaskRunStatus): boolean {
  return TASK_RUN_TRANSITIONS[from].includes(to);
}

export function canSessionTransition(from: SessionState, to: SessionState): boolean {
  return SESSION_TRANSITIONS[from].includes(to);
}
