/**
 * GET /health (BLUEPRINT §3.1).
 *
 * Sem auth. Retorna 200 ok ou 503 degraded com reason.
 */

import type { ClawdeDatabase } from "@clawde/db/client";
import type { QuotaTracker } from "@clawde/quota";
import type { ReceiverHandle, RouteHandler } from "../server.ts";

export interface HealthRouteDeps {
  readonly db: ClawdeDatabase;
  readonly quotaTracker: QuotaTracker;
  readonly receiver: ReceiverHandle;
  readonly version: string;
}

interface HealthOk {
  ok: true;
  db: "ok";
  quota: string;
  version: string;
}

interface HealthDegraded {
  ok: false;
  reason: "db_corrupted" | "quota_exhausted" | "draining" | "maintenance";
  details?: string;
}

export function makeHealthHandler(deps: HealthRouteDeps): RouteHandler {
  return () => {
    if (deps.receiver.isDraining()) {
      const body: HealthDegraded = { ok: false, reason: "draining" };
      return new Response(JSON.stringify(body), {
        status: 503,
        headers: { "Content-Type": "application/json", "Retry-After": "30" },
      });
    }

    let integrityOk = true;
    let integrityDetail: string | null = null;
    try {
      const row = deps.db
        .query<{ integrity_check: string }, []>("PRAGMA integrity_check")
        .get();
      integrityDetail = row?.integrity_check ?? "unknown";
      integrityOk = integrityDetail === "ok";
    } catch (err) {
      integrityOk = false;
      integrityDetail = (err as Error).message;
    }

    if (!integrityOk) {
      const body: HealthDegraded = {
        ok: false,
        reason: "db_corrupted",
        ...(integrityDetail !== null && { details: integrityDetail }),
      };
      return new Response(JSON.stringify(body), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    const window = deps.quotaTracker.currentWindow();
    if (window.state === "esgotado") {
      const body: HealthDegraded = {
        ok: false,
        reason: "quota_exhausted",
        details: `window resets at ${window.resetsAt}`,
      };
      return new Response(JSON.stringify(body), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body: HealthOk = {
      ok: true,
      db: "ok",
      quota: window.state,
      version: deps.version,
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}
