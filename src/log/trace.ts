/**
 * Correlation IDs: ULID para trace_id, propagado via AsyncLocalStorage.
 *
 * ULID = 26 chars, sortable por timestamp (Crockford base32).
 * Implementação intencionalmente sem dep externa.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32 (no I, L, O, U)
const ENCODING_LEN = ENCODING.length; // 32

/**
 * Gera ULID. Formato: TTTTTTTTTTRRRRRRRRRRRRRRRR (10 ts + 16 rand chars).
 */
export function newTraceId(): string {
  const now = Date.now();
  return encodeTime(now, 10) + encodeRandom(16);
}

function encodeTime(ms: number, length: number): string {
  let remaining = ms;
  let out = "";
  for (let i = length - 1; i >= 0; i--) {
    const mod = remaining % ENCODING_LEN;
    out = ENCODING[mod] + out;
    remaining = (remaining - mod) / ENCODING_LEN;
  }
  return out;
}

function encodeRandom(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    const byte = bytes[i] ?? 0;
    out += ENCODING[byte % ENCODING_LEN];
  }
  return out;
}

/**
 * Span ID: 16 chars de aleatoriedade. Não precisa ser ULID (não ordena por tempo).
 */
export function newSpanId(): string {
  return encodeRandom(16);
}

/**
 * Contexto de trace (trace_id + opcional span_id) propagado via AsyncLocalStorage.
 * Usado pelo logger para anexar IDs em toda linha sem que cada call site precise passar.
 */
export interface TraceContext {
  readonly traceId: string;
  readonly spanId?: string;
}

const traceStorage = new AsyncLocalStorage<TraceContext>();

export function getTraceContext(): TraceContext | undefined {
  return traceStorage.getStore();
}

/**
 * Roda `fn` em um contexto novo. Útil pra criar boundary por task_run.
 */
export function withTrace<T>(ctx: TraceContext, fn: () => T): T {
  return traceStorage.run(ctx, fn);
}
