/**
 * F7 — OAuth token loader + JWT expiry parsing.
 *
 * Sources de token (em ordem de precedência):
 *   1. systemd-credential: $CREDENTIALS_DIRECTORY/<name>
 *   2. keychain (macOS): security find-generic-password
 *   3. env: CLAUDE_CODE_OAUTH_TOKEN
 *
 * JWT expiry: parse base64-decode payload, lê `exp` (unix seconds).
 * Token Anthropic OAuth tem prefixo "sk-ant-oat01-" mas internamente é JWT.
 * Sem assinatura — só lemos o payload pra checar exp; signature é validada
 * pelo servidor quando a request bate em api.anthropic.com.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type TokenSource = "systemd-credential" | "keychain" | "env";

export interface OAuthToken {
  readonly value: string;
  readonly source: TokenSource;
}

export class OAuthLoadError extends Error {
  constructor(
    message: string,
    public readonly attemptedSources: ReadonlyArray<TokenSource>,
  ) {
    super(message);
    this.name = "OAuthLoadError";
  }
}

export interface LoadOAuthOptions {
  /** Em ordem de precedência. Default: systemd-credential, env. */
  readonly sources?: ReadonlyArray<TokenSource>;
  /** Nome do credential no systemd. Default 'clawde-oauth'. */
  readonly credentialName?: string;
  /** Override env vars (testes). */
  readonly env?: Record<string, string | undefined>;
}

const DEFAULT_SOURCES: ReadonlyArray<TokenSource> = ["systemd-credential", "env"];

/**
 * Tenta carregar token na ordem das sources. Lança OAuthLoadError se nenhuma
 * funcionar.
 */
export function loadOAuthToken(options: LoadOAuthOptions = {}): OAuthToken {
  const sources = options.sources ?? DEFAULT_SOURCES;
  const credentialName = options.credentialName ?? "clawde-oauth";
  const env = options.env ?? (process.env as Record<string, string | undefined>);
  const attempted: TokenSource[] = [];

  for (const source of sources) {
    attempted.push(source);
    if (source === "systemd-credential") {
      const value = loadFromSystemdCredential(credentialName, env);
      if (value !== null) return { value, source };
    } else if (source === "env") {
      const value = env.CLAUDE_CODE_OAUTH_TOKEN;
      if (value !== undefined && value.length > 0) return { value, source };
    } else if (source === "keychain") {
      // macOS: stub. Real impl chamaria 'security find-generic-password'.
      // Pra Linux production, ignora.
    }
  }

  throw new OAuthLoadError(
    `OAuth token not found in any source: ${attempted.join(", ")}`,
    attempted,
  );
}

function loadFromSystemdCredential(
  name: string,
  env: Record<string, string | undefined>,
): string | null {
  const dir = env.CREDENTIALS_DIRECTORY;
  if (dir === undefined || dir.length === 0) return null;
  const path = join(dir, name);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf-8").trim();
  } catch {
    return null;
  }
}

/**
 * Parse JWT payload sem validar signature. Tokens Anthropic OAuth têm
 * formato `sk-ant-oat01-<base64url>.<base64url>.<base64url>` (header.payload.sig).
 *
 * Retorna null se o formato não for JWT-like (ex: token revogado/inválido).
 */
export function parseJwtPayload(token: string): Record<string, unknown> | null {
  // Strip prefixo Anthropic se existir.
  const stripped = token.startsWith("sk-ant-oat01-") ? token.slice("sk-ant-oat01-".length) : token;

  const parts = stripped.split(".");
  if (parts.length !== 3) return null;

  const payloadB64 = parts[1];
  if (payloadB64 === undefined || payloadB64.length === 0) return null;

  try {
    // base64url → base64 padding correção.
    const padded = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const padding = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const json = Buffer.from(padded + padding, "base64").toString("utf-8");
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return parsed;
  } catch {
    return null;
  }
}

export interface TokenExpiry {
  /** Unix seconds. null se token sem `exp` (não é JWT ou format desconhecido). */
  readonly exp: number | null;
  /** Date legível ou null. */
  readonly expiresAt: Date | null;
  /** Dias até expiry, ou null. Negativo se já expirou. */
  readonly daysUntilExpiry: number | null;
}

export function getTokenExpiry(token: string, now: Date = new Date()): TokenExpiry {
  const payload = parseJwtPayload(token);
  if (payload === null) {
    return { exp: null, expiresAt: null, daysUntilExpiry: null };
  }
  const exp = payload.exp;
  if (typeof exp !== "number") {
    return { exp: null, expiresAt: null, daysUntilExpiry: null };
  }
  const expiresAt = new Date(exp * 1000);
  const daysUntilExpiry = (expiresAt.getTime() - now.getTime()) / 86_400_000;
  return { exp, expiresAt, daysUntilExpiry };
}

/**
 * Helper: é hora de renovar? True se daysUntilExpiry < threshold.
 */
export function needsRenewal(token: string, thresholdDays = 30, now: Date = new Date()): boolean {
  const expiry = getTokenExpiry(token, now);
  if (expiry.daysUntilExpiry === null) return false; // não JWT, não dá pra saber
  return expiry.daysUntilExpiry < thresholdDays;
}
