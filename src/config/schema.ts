/**
 * zod schema do clawde.toml. Validação no boot — falha = abort com path/erro claros.
 * Subset essencial pra Fase 2; campos extras (telegram, github, etc) virão por fase.
 *
 * NOTA sobre defaults aninhados em zod 4: `.default({})` em sub-objects NÃO cascateia
 * defaults internos. Workaround: `.default(() => Sub.parse({}))` força reparse,
 * aplicando defaults dos filhos.
 */

import { z } from "zod";

export const PlanSchema = z.enum(["pro", "max5x", "max20x"]);

export const ClawdeBaseSchema = z.object({
  home: z.string().default("~/.clawde"),
  log_level: z.enum(["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"]).default("INFO"),
});

export const WorkerSchema = z.object({
  max_parallel: z.number().int().positive().default(1),
  cli_path: z.string().default("/usr/local/bin/claude"),
  cli_min_version: z.string().default("2.0.0"),
  default_max_turns: z.number().int().positive().default(15),
  default_timeout_seconds: z.number().int().positive().default(1800),
  lease_seconds: z.number().int().positive().default(600),
  heartbeat_seconds: z.number().int().positive().default(60),
});

export const ReceiverRateLimitSchema = z.object({
  per_ip_per_minute: z.number().int().positive().default(10),
  per_ip_per_hour: z.number().int().positive().default(100),
  health_per_minute: z.number().int().positive().default(60),
});

export const ReceiverSchema = z.object({
  listen_tcp: z.string().default("127.0.0.1:18790"),
  listen_unix: z.string().default("/run/clawde/receiver.sock"),
  unix_socket_mode: z.string().default("0660"),
  unix_socket_group: z.string().default("clawde"),
  rate_limit: ReceiverRateLimitSchema.default(() => ReceiverRateLimitSchema.parse({})),
});

export const QuotaThresholdsSchema = z.object({
  aviso: z.number().min(0).max(100).default(60),
  restrito: z.number().min(0).max(100).default(80),
  critico: z.number().min(0).max(100).default(95),
});

export const QuotaSchema = z.object({
  plan: PlanSchema.default("max5x"),
  window_hours: z.number().int().positive().default(5),
  reserve_urgent_pct: z.number().min(0).max(100).default(15),
  peak_hours_tz: z.string().default("America/Los_Angeles"),
  peak_start_local: z.string().default("05:00"),
  peak_end_local: z.string().default("11:00"),
  peak_multiplier: z.number().positive().default(1.7),
  thresholds: QuotaThresholdsSchema.default(() => QuotaThresholdsSchema.parse({})),
});

export const SandboxSchema = z.object({
  default_level: z.literal(1).or(z.literal(2)).or(z.literal(3)).default(1),
  bwrap_path: z.string().default("/usr/bin/bwrap"),
  allow_levels_per_agent: z.boolean().default(true),
  egress_allowlist_path: z.string().default("~/.clawde/config/egress_allowlist.txt"),
});

export const MemorySchema = z.object({
  backend: z.enum(["native", "claude-mem-deprecated"]).default("native"),
  jsonl_root: z.string().default("~/.claude/projects"),
  indexer_interval_minutes: z.number().int().positive().default(10),
  embeddings_enabled: z.boolean().default(false),
  embeddings_model: z.string().default("Xenova/multilingual-e5-small"),
});

export const AuthSchema = z.object({
  oauth_token_source: z.enum(["systemd-credential", "keychain", "env"]).default("env"),
  oauth_token_credential: z.string().default("clawde-oauth"),
  oauth_expiry_warn_days: z.number().int().positive().default(30),
  oauth_auto_refresh: z.boolean().default(true),
});

export const TelegramConfigSchema = z.object({
  secret: z.string().min(1),
  allowed_user_ids: z.array(z.number().int().positive()).default([]),
  default_priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  default_agent: z.string().default("telegram-bot"),
  bot_token_credential: z.string().default("clawde-telegram-bot-token"),
  alert_chat_id_credential: z.string().default("clawde-telegram-alert-chat-id"),
});

export const ReviewConfigSchema = z.object({
  review_required: z.boolean().default(false),
  stages: z.array(z.string()).default(["implementer", "spec-reviewer", "code-quality-reviewer"]),
  max_retries_per_stage: z.number().int().nonnegative().default(2),
});

export const ReplicaConfigSchema = z.object({
  expected_replicas: z.array(z.string()).default([]),
  max_age_minutes: z.number().int().positive().default(90),
});

export const AlertsEmailConfigSchema = z.object({
  smtp_host: z.string().min(1),
  smtp_port: z.number().int().positive().default(587),
  smtp_username_credential: z.string().min(1),
  smtp_password_credential: z.string().min(1),
  from: z.string().default("clawde@localhost"),
  to: z.string().default("root@localhost"),
});

export const AlertsConfigSchema = z.object({
  email: AlertsEmailConfigSchema.optional(),
});

export const ClawdeConfigSchema = z.object({
  clawde: ClawdeBaseSchema.default(() => ClawdeBaseSchema.parse({})),
  worker: WorkerSchema.default(() => WorkerSchema.parse({})),
  receiver: ReceiverSchema.default(() => ReceiverSchema.parse({})),
  quota: QuotaSchema.default(() => QuotaSchema.parse({})),
  sandbox: SandboxSchema.default(() => SandboxSchema.parse({})),
  memory: MemorySchema.default(() => MemorySchema.parse({})),
  auth: AuthSchema.default(() => AuthSchema.parse({})),
  telegram: TelegramConfigSchema.optional(),
  review: ReviewConfigSchema.optional(),
  replica: ReplicaConfigSchema.optional(),
  alerts: AlertsConfigSchema.optional(),
});

export type ClawdeConfig = z.infer<typeof ClawdeConfigSchema>;
