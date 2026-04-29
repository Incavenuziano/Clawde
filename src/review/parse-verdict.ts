/**
 * F9 — Parser do output de reviewer.
 *
 * Reviewers terminam com `VERDICT: APPROVED` ou `VERDICT: REJECTED`
 * (último ocorrência ganha). Tudo acima é feedback (em REJECTED).
 *
 * Tolerante: se o reviewer falhou em incluir verdict, retorna null e o
 * pipeline trata como erro operacional.
 */

import type { ReviewVerdict } from "./types.ts";

const VERDICT_RE = /^VERDICT:\s*(APPROVED|REJECTED)\s*$/im;

export interface ParsedVerdict {
  readonly verdict: ReviewVerdict;
  /** Texto antes da linha VERDICT (vazio se nada). */
  readonly feedback: string;
}

export function parseVerdict(output: string): ParsedVerdict | null {
  // Última ocorrência ganha — varremos de trás pra evitar pegar exemplo
  // no system prompt que possa ter vazado pro output (defesa).
  const lines = output.split(/\r?\n/);
  let verdictIdx = -1;
  let verdict: ReviewVerdict | null = null;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === undefined) continue;
    const m = VERDICT_RE.exec(line);
    if (m !== null && m[1] !== undefined) {
      verdict = m[1].toUpperCase() as ReviewVerdict;
      verdictIdx = i;
      break;
    }
  }

  if (verdict === null || verdictIdx < 0) return null;

  const feedback = lines.slice(0, verdictIdx).join("\n").trim();
  return { verdict, feedback };
}
