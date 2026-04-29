/**
 * `clawde auth status|check` — inspeciona OAuth token (source, expiry).
 *
 * `status`: relata source + dias até expirar + se precisa renovar.
 *           Exit 0 se ok. Exit 4 (auth) se falta token. Exit 1 se precisa
 *           renovar dentro do threshold.
 * `check`:  alias usado pelo systemd timer semanal. Exit 0 sempre exceto em
 *           erro fatal — sinaliza renovação via journal apenas.
 *
 * NÃO dispara setup-token automaticamente. Refresh é manual ou via wrapper
 * em runtime (invokeWithAutoRefresh).
 */

import { OAuthLoadError, getTokenExpiry, loadOAuthToken, needsRenewal } from "@clawde/auth";
import { type OutputFormat, emit, emitErr } from "../output.ts";

export interface AuthCmdOptions {
  readonly format: OutputFormat;
  readonly action: "status" | "check";
  readonly thresholdDays?: number;
  readonly credentialName?: string;
}

interface AuthStatusReport {
  readonly hasToken: boolean;
  readonly source: string | null;
  readonly exp: number | null;
  readonly expiresAt: string | null;
  readonly daysUntilExpiry: number | null;
  readonly needsRenewal: boolean;
  readonly thresholdDays: number;
  readonly error?: string;
}

export function runAuth(options: AuthCmdOptions): number {
  const thresholdDays = options.thresholdDays ?? 30;

  let token: string;
  let source: string;
  try {
    const loadOpts: Parameters<typeof loadOAuthToken>[0] = {};
    if (options.credentialName !== undefined) {
      Object.assign(loadOpts, { credentialName: options.credentialName });
    }
    const loaded = loadOAuthToken(loadOpts);
    token = loaded.value;
    source = loaded.source;
  } catch (err) {
    const message = err instanceof OAuthLoadError ? err.message : (err as Error).message;
    const report: AuthStatusReport = {
      hasToken: false,
      source: null,
      exp: null,
      expiresAt: null,
      daysUntilExpiry: null,
      needsRenewal: true,
      thresholdDays,
      error: message,
    };
    emit(options.format, report, (d) => {
      const r = d as AuthStatusReport;
      return [
        "token:        (none)",
        `error:        ${r.error ?? "?"}`,
        "",
        "run 'claude setup-token' to authenticate",
      ].join("\n");
    });
    return options.action === "check" ? 0 : 4;
  }

  const expiry = getTokenExpiry(token);
  const renew = needsRenewal(token, thresholdDays);

  const report: AuthStatusReport = {
    hasToken: true,
    source,
    exp: expiry.exp,
    expiresAt: expiry.expiresAt !== null ? expiry.expiresAt.toISOString() : null,
    daysUntilExpiry:
      expiry.daysUntilExpiry !== null ? Math.round(expiry.daysUntilExpiry * 10) / 10 : null,
    needsRenewal: renew,
    thresholdDays,
  };

  emit(options.format, report, (d) => {
    const r = d as AuthStatusReport;
    const lines = [
      `token:           present (source=${r.source ?? "?"})`,
      `expires_at:      ${r.expiresAt ?? "(unknown — not a JWT or no exp)"}`,
      `days_until:      ${r.daysUntilExpiry !== null ? r.daysUntilExpiry.toString() : "(unknown)"}`,
      `needs_renewal:   ${r.needsRenewal ? "YES" : "no"} (threshold=${r.thresholdDays}d)`,
    ];
    if (r.needsRenewal && r.daysUntilExpiry !== null) {
      lines.push("");
      lines.push("warn: token expires soon — run 'claude setup-token' to refresh");
    }
    return lines.join("\n");
  });

  if (options.action === "check") {
    if (renew) emitErr(`warn: OAuth token within ${thresholdDays}d of expiry — renew soon`);
    return 0;
  }
  return renew ? 1 : 0;
}
