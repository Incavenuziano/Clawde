/**
 * Redact: mascarar secrets em payloads antes de logar.
 *
 * Estratégia em 2 níveis:
 *   1. Por chave: se o nome do campo casa com SECRET_KEY_PATTERNS (case-insensitive),
 *      o valor é substituído por "[REDACTED]".
 *   2. Por valor: substitui patterns conhecidos (sk-ant-*, ghp_*, etc) em strings
 *      mesmo se a chave parece inocente.
 */

import { REDACTED_PLACEHOLDER, SECRET_KEY_PATTERNS, SECRET_VALUE_PATTERNS } from "./secrets.ts";

const KEY_LOWER_SET = new Set(SECRET_KEY_PATTERNS.map((p) => p.toLowerCase()));

function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (KEY_LOWER_SET.has(lower)) return true;
  for (const pattern of KEY_LOWER_SET) {
    if (lower.includes(pattern)) return true;
  }
  return false;
}

function redactValue(value: string): string {
  let out = value;
  for (const re of SECRET_VALUE_PATTERNS) {
    out = out.replace(re, REDACTED_PLACEHOLDER);
  }
  return out;
}

/**
 * Redact aplicado recursivamente em qualquer estrutura JSON-serializable.
 * - Strings: redact por padrão de valor.
 * - Objetos: redact por chave + recursão.
 * - Arrays: recursão por elemento.
 * - Outros: passa.
 */
export function redact(input: unknown): unknown {
  if (input === null || input === undefined) return input;

  if (typeof input === "string") {
    return redactValue(input);
  }

  if (Array.isArray(input)) {
    return input.map((item) => redact(item));
  }

  if (typeof input === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (isSecretKey(key)) {
        result[key] = REDACTED_PLACEHOLDER;
      } else {
        result[key] = redact(value);
      }
    }
    return result;
  }

  return input;
}
