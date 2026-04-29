/**
 * HMAC verification para webhooks (BLUEPRINT §3.1, BEST_PRACTICES §2.4).
 *
 * - Telegram: header X-Telegram-Bot-Api-Secret-Token (string fixa, comparação direta).
 * - GitHub: header X-Hub-Signature-256 = "sha256=<hex>". HMAC-SHA256(secret, body).
 *
 * Comparação constant-time via crypto.timingSafeEqual para prevenir timing attacks.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface HmacResult {
  readonly ok: boolean;
  readonly reason?: string;
}

/**
 * Verifica X-Telegram-Bot-Api-Secret-Token. Telegram envia o secret literal;
 * comparamos com nosso secret esperado em constant time.
 */
export function verifyTelegramSecret(headerValue: string | null, expected: string): HmacResult {
  if (headerValue === null || headerValue.length === 0) {
    return { ok: false, reason: "missing X-Telegram-Bot-Api-Secret-Token header" };
  }
  if (expected.length === 0) {
    return { ok: false, reason: "no Telegram secret configured" };
  }
  const a = Buffer.from(headerValue, "utf-8");
  const b = Buffer.from(expected, "utf-8");
  if (a.length !== b.length) {
    return { ok: false, reason: "secret length mismatch" };
  }
  if (!timingSafeEqual(a, b)) {
    return { ok: false, reason: "secret mismatch" };
  }
  return { ok: true };
}

/**
 * Verifica X-Hub-Signature-256 contra HMAC-SHA256(secret, body).
 * Header esperado no formato "sha256=<hex>".
 */
export function verifyGitHubHmac(
  headerValue: string | null,
  body: string,
  secret: string,
): HmacResult {
  if (headerValue === null || headerValue.length === 0) {
    return { ok: false, reason: "missing X-Hub-Signature-256 header" };
  }
  if (!headerValue.startsWith("sha256=")) {
    return { ok: false, reason: "header must start with 'sha256='" };
  }
  if (secret.length === 0) {
    return { ok: false, reason: "no GitHub secret configured" };
  }
  const provided = headerValue.slice("sha256=".length);
  const computed = createHmac("sha256", secret).update(body).digest("hex");
  if (provided.length !== computed.length) {
    return { ok: false, reason: "signature length mismatch" };
  }
  const a = Buffer.from(provided, "utf-8");
  const b = Buffer.from(computed, "utf-8");
  if (!timingSafeEqual(a, b)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}

/**
 * Helper para gerar assinatura GitHub-compatível (útil em testes).
 */
export function signGitHub(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}
