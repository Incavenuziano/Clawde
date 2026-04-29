/**
 * F7 — OAuth refresh proativo + auto-recovery em 401.
 *
 * Duas peças:
 *   1. `invokeWithAutoRefresh(fn, ctx)`: tenta operação; em HTTP 401 dispara
 *      refresh e re-tenta UMA vez. Sem loop infinito.
 *   2. `refreshOAuthToken(ctx)`: spawn `claude setup-token --headless`. Stub
 *      seguro por padrão (sem network, sem mexer no keychain) — host real
 *      injeta runner via `ctx.runSetupToken`.
 *
 * Detecção de 401: flexível. Aceita Response, error com `.status`, ou string
 * que contém "401"/"unauthorized" (case-insensitive). CLI bate em
 * api.anthropic.com com Authorization: Bearer <token>; 401 quando expira.
 */

import { spawn } from "node:child_process";
import { type OAuthToken, loadOAuthToken } from "./oauth.ts";

export type SetupTokenRunner = () => Promise<{ exitCode: number; stderr: string }>;

/**
 * Runner de produção: spawn `claude setup-token --headless`. Captura stderr
 * pra mensagens de erro úteis. Não captura stdout (o token vai pro keychain
 * gerenciado pelo CLI; nós relemos via loadOAuthToken).
 *
 * NÃO é o default em refreshOAuthToken pra evitar surprise side-effects em
 * testes. Use explicitamente: `refreshOAuthToken({ runSetupToken: spawnClaudeSetupToken })`.
 */
export const spawnClaudeSetupToken: SetupTokenRunner = () =>
  new Promise((resolve) => {
    const proc = spawn("claude", ["setup-token", "--headless"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    proc.on("error", (err) => {
      resolve({ exitCode: 127, stderr: `spawn failed: ${err.message}` });
    });
    proc.on("close", (code) => {
      resolve({ exitCode: code ?? -1, stderr });
    });
  });

export interface RefreshContext {
  /** Hook pra rodar `claude setup-token --headless`. Default: stub que falha. */
  readonly runSetupToken?: SetupTokenRunner;
  /** Reload pós-refresh. Default: loadOAuthToken sem options. */
  readonly reloadToken?: () => OAuthToken;
  /** Hook pra logging/eventos. */
  readonly onEvent?: (kind: RefreshEventKind, detail: string) => void;
}

export type RefreshEventKind =
  | "refresh.start"
  | "refresh.success"
  | "refresh.failure"
  | "retry.attempt";

export class RefreshError extends Error {
  public override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "RefreshError";
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Heurística pra detectar erro de auth (401). Aceita:
 *   - Response (fetch result)
 *   - Error com propriedade `status`/`statusCode` numérica
 *   - Error/string com texto contendo "401" ou "unauthorized"
 */
export function isAuthError(value: unknown): boolean {
  if (value === null || value === undefined) return false;

  // Response
  if (typeof value === "object" && "status" in value) {
    const s = (value as { status: unknown }).status;
    if (typeof s === "number" && s === 401) return true;
  }
  if (typeof value === "object" && "statusCode" in value) {
    const s = (value as { statusCode: unknown }).statusCode;
    if (typeof s === "number" && s === 401) return true;
  }

  const text =
    value instanceof Error ? value.message : typeof value === "string" ? value : String(value);
  const lower = text.toLowerCase();
  return lower.includes("401") || lower.includes("unauthorized");
}

/**
 * Roda `claude setup-token --headless`. Em prod, o host injeta runner que
 * spawn no CLI real. Default lança — comportamento seguro, evita disparar
 * setup-token automático sem consentimento.
 */
export async function refreshOAuthToken(ctx: RefreshContext = {}): Promise<OAuthToken> {
  ctx.onEvent?.("refresh.start", "spawning claude setup-token --headless");
  const runner = ctx.runSetupToken;
  if (runner === undefined) {
    ctx.onEvent?.("refresh.failure", "no runSetupToken configured");
    throw new RefreshError(
      "OAuth refresh requires explicit runSetupToken runner (no default to avoid surprise side-effects)",
    );
  }
  let result: Awaited<ReturnType<SetupTokenRunner>>;
  try {
    result = await runner();
  } catch (err) {
    ctx.onEvent?.("refresh.failure", (err as Error).message);
    throw new RefreshError(`setup-token spawn failed: ${(err as Error).message}`, err);
  }
  if (result.exitCode !== 0) {
    ctx.onEvent?.("refresh.failure", `exit=${result.exitCode}`);
    throw new RefreshError(
      `setup-token failed (exit ${result.exitCode}): ${result.stderr.trim() || "no stderr"}`,
    );
  }
  let token: OAuthToken;
  try {
    token = ctx.reloadToken !== undefined ? ctx.reloadToken() : loadOAuthToken();
  } catch (err) {
    ctx.onEvent?.("refresh.failure", `reload after setup-token: ${(err as Error).message}`);
    throw new RefreshError(`token reload failed after setup-token: ${(err as Error).message}`, err);
  }
  ctx.onEvent?.("refresh.success", `source=${token.source}`);
  return token;
}

/**
 * Wrapper genérico: tenta `fn()`. Se falhar com erro de auth, refresha e
 * retenta UMA vez. A função `fn` recebe a OAuthToken corrente; em retry,
 * recebe o novo token.
 *
 * NÃO retenta em outros erros (network, 500, etc).
 */
export async function invokeWithAutoRefresh<T>(
  initialToken: OAuthToken,
  fn: (token: OAuthToken) => Promise<T>,
  ctx: RefreshContext = {},
): Promise<T> {
  try {
    return await fn(initialToken);
  } catch (err) {
    if (!isAuthError(err)) throw err;
    ctx.onEvent?.("retry.attempt", "auth error detected, refreshing");
    const fresh = await refreshOAuthToken(ctx);
    return fn(fresh);
  }
}
