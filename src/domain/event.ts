/**
 * Event = audit trail append-only.
 * Triggers SQLite reforçam imutabilidade (BEST_PRACTICES §7.1).
 * Lista canônica de kinds em BEST_PRACTICES §6.3 + ADR 0009 (lesson).
 */

export const EVENT_KIND_VALUES = [
  // receiver
  "enqueue",
  "auth_fail",
  "rate_limit_hit",
  "dedup_skip",
  // worker lifecycle
  "task_start",
  "task_finish",
  "task_fail",
  "lease_expired",
  "quarantine_enter",
  "quarantine_exit",
  // claude SDK
  "claude_invocation_start",
  "claude_invocation_end",
  "tool_use",
  "tool_result",
  "tool_blocked",
  "compact_triggered",
  // quota
  "quota_threshold_crossed",
  "quota_reset",
  "peak_multiplier_applied",
  // auth
  "oauth_refresh_attempt",
  "oauth_refresh_success",
  "oauth_expiry_warning",
  "auth.telegram_reject",
  "auth.telegram_user_blocked",
  // sandbox
  "sandbox_init",
  "sandbox_violation",
  // migrations / maintenance
  "migration_start",
  "migration_end",
  "migration_fail",
  "maintenance_start",
  "maintenance_end",
  // security
  "prompt_guard_alert",
  "panic_stop",
  // hooks (BLUEPRINT §4.5)
  "hook_error",
  "hook_timeout",
  // memory / learning (ADR 0009)
  "lesson",
  "reflection_start",
  "reflection_end",
  // agent validation
  "agent_invalid",
] as const;
export type EventKind = (typeof EVENT_KIND_VALUES)[number];

export interface Event {
  readonly id: number;
  readonly ts: string;
  readonly taskRunId: number | null;
  readonly sessionId: string | null;
  readonly traceId: string | null;
  readonly spanId: string | null;
  readonly kind: EventKind;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type NewEvent = Omit<Event, "id" | "ts">;
