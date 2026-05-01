/**
 * Structured JSON logger (BEST_PRACTICES §6.1–§6.4).
 *
 * Output: 1 linha por evento, JSON UTF-8, terminada em \n, no stdout.
 * Campos obrigatórios: ts, level, msg.
 * Trace context (trace_id, span_id) injetado automaticamente via AsyncLocalStorage.
 * Payload é redacted antes de serializar.
 */

import { sendAlertBestEffort } from "@clawde/alerts";
import { redact } from "./redact.ts";
import { getTraceContext } from "./trace.ts";

export const LOG_LEVELS = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_RANK: Record<LogLevel, number> = {
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
  FATAL: 5,
};

export interface LoggerContext {
  readonly component?: string;
  readonly workerId?: string;
  readonly taskId?: number;
  readonly taskRunId?: number;
  readonly sessionId?: string;
  readonly [key: string]: unknown;
}

export interface Logger {
  trace(msg: string, fields?: Record<string, unknown>): void;
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  fatal(msg: string, fields?: Record<string, unknown>): void;
  child(extra: LoggerContext): Logger;
}

/**
 * Sink global. Default: process.stdout.write. Substituível em testes via setLogSink.
 */
export type LogSink = (line: string) => void;

let activeSink: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

export function setLogSink(sink: LogSink): void {
  activeSink = sink;
}

export function resetLogSink(): void {
  activeSink = (line) => {
    process.stdout.write(`${line}\n`);
  };
}

let activeMinLevel: LogLevel = "INFO";

export function setMinLevel(level: LogLevel): void {
  activeMinLevel = level;
}

export function getMinLevel(): LogLevel {
  return activeMinLevel;
}

interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  trace_id?: string;
  span_id?: string;
  [key: string]: unknown;
}

export function createLogger(ctx: LoggerContext = {}): Logger {
  const baseCtx = { ...ctx };

  function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[activeMinLevel]) return;

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...baseCtx,
    };

    const trace = getTraceContext();
    if (trace !== undefined) {
      entry.trace_id = trace.traceId;
      if (trace.spanId !== undefined) entry.span_id = trace.spanId;
    }

    if (fields !== undefined) {
      Object.assign(entry, redact(fields) as Record<string, unknown>);
    }

    // baseCtx pode conter secrets também; redact aplicado no entry inteiro.
    const safe = redact(entry) as LogEntry;
    activeSink(JSON.stringify(safe));

    if (level === "FATAL") {
      queueMicrotask(() => {
        void sendAlertBestEffort({
          severity: "critical",
          trigger: "fatal_log",
          cooldownKey: "fatal_log",
          payload: {
            msg,
            ...(fields !== undefined ? (redact(fields) as Record<string, unknown>) : {}),
          },
        });
      });
    }
  }

  return {
    trace: (m, f) => emit("TRACE", m, f),
    debug: (m, f) => emit("DEBUG", m, f),
    info: (m, f) => emit("INFO", m, f),
    warn: (m, f) => emit("WARN", m, f),
    error: (m, f) => emit("ERROR", m, f),
    fatal: (m, f) => emit("FATAL", m, f),
    child: (extra) => createLogger({ ...baseCtx, ...extra }),
  };
}
