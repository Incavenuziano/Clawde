/**
 * `clawde diagnose db|quota|oauth|sandbox|agents|all` — encapsula checks
 * de saúde por subsistema. Cada subject retorna exit 0 (ok) / 1 (warn) /
 * 2 (error). `all` agrega: exit é o pior status entre todos.
 *
 * Sub-fase P3.2 (T-106). Spec em EXECUTION_BACKLOG.md §P3.2 + BLUEPRINT
 * §6.1.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadAllAgentDefinitions } from "@clawde/agents";
import { OAuthLoadError, getTokenExpiry, loadOAuthToken } from "@clawde/auth";
import { closeDb, openDb } from "@clawde/db/client";
import { QuotaLedgerRepo } from "@clawde/db/repositories/quota-ledger";
import { DEFAULT_TRACKER_CONFIG, QuotaTracker } from "@clawde/quota";
import { type OutputFormat, emit } from "../output.ts";

export type DiagnoseSubject = "db" | "quota" | "oauth" | "sandbox" | "agents" | "all";

export const DIAGNOSE_SUBJECTS: ReadonlyArray<DiagnoseSubject> = [
  "db",
  "quota",
  "oauth",
  "sandbox",
  "agents",
  "all",
];

export type DiagnoseStatus = "ok" | "warn" | "error";

export interface DiagnoseCheck {
  readonly name: string;
  readonly status: DiagnoseStatus;
  readonly detail?: string;
}

export interface DiagnoseReport {
  readonly subject: DiagnoseSubject;
  readonly status: DiagnoseStatus;
  readonly checks: ReadonlyArray<DiagnoseCheck>;
}

export interface DiagnoseOptions {
  readonly dbPath: string;
  readonly format: OutputFormat;
  readonly subject: DiagnoseSubject;
  readonly agentsRoot?: string;
}

export async function runDiagnose(options: DiagnoseOptions): Promise<number> {
  const subjects: ReadonlyArray<Exclude<DiagnoseSubject, "all">> =
    options.subject === "all" ? ["db", "quota", "oauth", "sandbox", "agents"] : [options.subject];

  const checks: DiagnoseCheck[] = [];
  for (const s of subjects) {
    checks.push(await runOneCheck(s, options));
  }

  const status = aggregateStatus(checks);
  const report: DiagnoseReport = { subject: options.subject, status, checks };

  emit(options.format, report, (d) => {
    const r = d as DiagnoseReport;
    const lines = r.checks.map(
      (c) => `[${statusBadge(c.status)}] ${c.name}: ${c.detail ?? ""}`,
    );
    lines.push(`overall: ${statusBadge(r.status)}`);
    return lines.join("\n");
  });

  return statusToExit(status);
}

async function runOneCheck(
  subject: Exclude<DiagnoseSubject, "all">,
  options: DiagnoseOptions,
): Promise<DiagnoseCheck> {
  switch (subject) {
    case "db":
      return checkDb(options.dbPath);
    case "quota":
      return checkQuota(options.dbPath);
    case "oauth":
      return checkOAuth();
    case "sandbox":
      return checkSandbox(resolveAgentsRoot(options));
    case "agents":
      return checkAgents(resolveAgentsRoot(options));
  }
}

function checkDb(dbPath: string): DiagnoseCheck {
  try {
    const db = openDb(dbPath);
    try {
      const row = db.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get();
      if (row?.integrity_check === "ok") {
        return { name: "db.integrity", status: "ok", detail: "PRAGMA integrity_check ok" };
      }
      return {
        name: "db.integrity",
        status: "error",
        detail: row?.integrity_check ?? "unknown",
      };
    } finally {
      closeDb(db);
    }
  } catch (err) {
    return { name: "db.integrity", status: "error", detail: (err as Error).message };
  }
}

function checkQuota(dbPath: string): DiagnoseCheck {
  try {
    const db = openDb(dbPath);
    try {
      const repo = new QuotaLedgerRepo(db);
      const tracker = new QuotaTracker(repo, DEFAULT_TRACKER_CONFIG);
      const window = tracker.currentWindow();
      const baseDetail = `${window.state} (${window.msgsConsumed} msgs, plan ${window.plan}, resets ${window.resetsAt})`;
      switch (window.state) {
        case "normal":
          return { name: "quota.window", status: "ok", detail: baseDetail };
        case "aviso":
        case "restrito":
          return { name: "quota.window", status: "warn", detail: baseDetail };
        case "critico":
        case "esgotado":
          return { name: "quota.window", status: "error", detail: baseDetail };
      }
    } finally {
      closeDb(db);
    }
  } catch (err) {
    return { name: "quota.window", status: "error", detail: (err as Error).message };
  }
}

function checkOAuth(): DiagnoseCheck {
  try {
    const token = loadOAuthToken();
    const expiry = getTokenExpiry(token.value);
    if (expiry.daysUntilExpiry === null) {
      return {
        name: "oauth.expiry",
        status: "ok",
        detail: "token loaded; expiry unknown (non-JWT)",
      };
    }
    const days = Math.round(expiry.daysUntilExpiry * 10) / 10;
    if (days < 7) {
      return { name: "oauth.expiry", status: "error", detail: `expires in ${days}d (<7d)` };
    }
    if (days < 30) {
      return { name: "oauth.expiry", status: "warn", detail: `expires in ${days}d (<30d)` };
    }
    return { name: "oauth.expiry", status: "ok", detail: `expires in ${days}d` };
  } catch (err) {
    if (err instanceof OAuthLoadError) {
      return {
        name: "oauth.expiry",
        status: "warn",
        detail: "token not found; auth not configured",
      };
    }
    return { name: "oauth.expiry", status: "error", detail: (err as Error).message };
  }
}

function checkSandbox(agentsRoot: string): DiagnoseCheck {
  try {
    const defs = loadAllAgentDefinitions(agentsRoot);
    const needsBwrap = defs.some((d) => d.sandbox.level >= 2);
    const bwrapPath = "/usr/bin/bwrap";
    if (!needsBwrap) {
      return { name: "sandbox.bwrap", status: "ok", detail: "no level>=2 agents loaded" };
    }
    if (existsSync(bwrapPath)) {
      return { name: "sandbox.bwrap", status: "ok", detail: `${bwrapPath} present` };
    }
    return {
      name: "sandbox.bwrap",
      status: "error",
      detail: `${bwrapPath} missing (level>=2 agents present)`,
    };
  } catch (err) {
    return { name: "sandbox.bwrap", status: "error", detail: (err as Error).message };
  }
}

function checkAgents(agentsRoot: string): DiagnoseCheck {
  try {
    if (!existsSync(agentsRoot)) {
      return {
        name: "agents.load",
        status: "warn",
        detail: `agents root ${agentsRoot} not found`,
      };
    }
    const defs = loadAllAgentDefinitions(agentsRoot);
    if (defs.length === 0) {
      return { name: "agents.load", status: "warn", detail: "0 agents defined" };
    }
    const summary = defs.map((d) => `${d.name}=L${d.sandbox.level}`).join(", ");
    return {
      name: "agents.load",
      status: "ok",
      detail: `${defs.length} agent(s): ${summary}`,
    };
  } catch (err) {
    return { name: "agents.load", status: "error", detail: (err as Error).message };
  }
}

function resolveAgentsRoot(options: DiagnoseOptions): string {
  if (options.agentsRoot !== undefined && options.agentsRoot.length > 0) {
    return options.agentsRoot;
  }
  if (process.env.CLAWDE_HOME !== undefined && process.env.CLAWDE_HOME.length > 0) {
    return join(process.env.CLAWDE_HOME, "agents");
  }
  return join(dirname(options.dbPath), "agents");
}

function aggregateStatus(checks: ReadonlyArray<DiagnoseCheck>): DiagnoseStatus {
  if (checks.some((c) => c.status === "error")) return "error";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "ok";
}

function statusBadge(status: DiagnoseStatus): string {
  switch (status) {
    case "ok":
      return "OK  ";
    case "warn":
      return "WARN";
    case "error":
      return "FAIL";
  }
}

function statusToExit(status: DiagnoseStatus): number {
  switch (status) {
    case "ok":
      return 0;
    case "warn":
      return 1;
    case "error":
      return 2;
  }
}
