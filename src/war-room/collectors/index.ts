import { closeDb, openDb } from "@clawde/db/client";
import { defaultMigrationsDir, status as migrationStatus } from "@clawde/db/migrations";
import { redact } from "@clawde/log";
import { BunCommandRunner, type CommandRunner } from "../command-runner.ts";
import type {
  EvidenceCollectionResult,
  EvidenceCollector,
  EvidenceCollectorContext,
} from "./types.ts";

function writeJsonEvidence(
  context: EvidenceCollectorContext,
  name: string,
  value: unknown,
): EvidenceCollectionResult {
  const path = context.store.writeEvidenceText(
    context.roomId,
    `${name}.json`,
    `${JSON.stringify(redact(value), null, 2)}\n`,
  );
  context.store.addEvidence(context.roomId, { name, path, status: "ok" });
  return { name, status: "ok", path };
}

function writeTextEvidence(
  context: EvidenceCollectorContext,
  name: string,
  body: string,
  status: "ok" | "warn" | "error" = "ok",
  detail?: string,
): EvidenceCollectionResult {
  const path = context.store.writeEvidenceText(context.roomId, `${name}.txt`, String(redact(body)));
  context.store.addEvidence(context.roomId, {
    name,
    path,
    status,
    ...(detail !== undefined ? { detail } : {}),
  });
  return { name, status, path, ...(detail !== undefined ? { detail } : {}) };
}

async function runForEvidence(
  runner: CommandRunner,
  argv: ReadonlyArray<string>,
  cwd: string,
  timeoutMs = 20_000,
): Promise<string> {
  const result = await runner.run({ argv, cwd, timeoutMs });
  return [
    `$ ${argv.join(" ")}`,
    `exit=${result.exitCode} timed_out=${result.timedOut} duration_ms=${result.durationMs}`,
    "--- stdout ---",
    result.stdout,
    "--- stderr ---",
    result.stderr,
  ].join("\n");
}

export function makeGitCollector(
  runner: CommandRunner = new BunCommandRunner(),
): EvidenceCollector {
  return {
    name: "git",
    async collect(context) {
      const parts = await Promise.all([
        runForEvidence(runner, ["git", "branch", "--show-current"], context.cwd),
        runForEvidence(runner, ["git", "status", "--short", "--branch"], context.cwd),
        runForEvidence(runner, ["git", "log", "--oneline", "-n", "12"], context.cwd),
        runForEvidence(runner, ["git", "diff", "--stat"], context.cwd),
      ]);
      return writeTextEvidence(context, "git", parts.join("\n\n"));
    },
  };
}

export function makeDbCollector(): EvidenceCollector {
  return {
    name: "db",
    async collect(context) {
      try {
        const db = openDb(context.dbPath);
        try {
          const integrity = db
            .query<{ integrity_check: string }, []>("PRAGMA integrity_check")
            .get()?.integrity_check;
          const migrations = migrationStatus(db, defaultMigrationsDir());
          const counts: Record<string, number> = {};
          for (const table of ["tasks", "task_runs", "sessions", "events", "_migrations"]) {
            try {
              counts[table] =
                db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0;
            } catch {
              counts[table] = -1;
            }
          }
          return writeJsonEvidence(context, "db", { integrity, migrations, counts });
        } finally {
          closeDb(db);
        }
      } catch (err) {
        return writeTextEvidence(context, "db", (err as Error).message, "error");
      }
    },
  };
}

export function makeDiagnoseCollector(
  runner: CommandRunner = new BunCommandRunner(),
): EvidenceCollector {
  return {
    name: "diagnose",
    async collect(context) {
      const body = await runForEvidence(
        runner,
        [
          "bun",
          "run",
          "src/cli/main.ts",
          "diagnose",
          "all",
          "--db",
          context.dbPath,
          "--output",
          "json",
        ],
        context.cwd,
      );
      return writeTextEvidence(context, "diagnose-all", body);
    },
  };
}

export function makeSystemdCollector(
  runner: CommandRunner = new BunCommandRunner(),
): EvidenceCollector {
  return {
    name: "systemd",
    async collect(context) {
      const units = [
        "clawde-receiver.service",
        "clawde-worker.path",
        "clawde-deferred-check.timer",
        "clawde-integrity.timer",
      ];
      const parts: string[] = [];
      for (const unit of units) {
        parts.push(
          await runForEvidence(
            runner,
            ["systemctl", "--user", "status", unit, "--no-pager"],
            context.cwd,
          ),
        );
      }
      return writeTextEvidence(context, "systemd", parts.join("\n\n"));
    },
  };
}

export function makeGithubCollector(
  runner: CommandRunner = new BunCommandRunner(),
): EvidenceCollector {
  return {
    name: "github",
    async collect(context) {
      const body = await runForEvidence(
        runner,
        ["gh", "issue", "list", "--limit", "30", "--json", "number,title,state,labels,updatedAt"],
        context.cwd,
      );
      return writeTextEvidence(context, "github-issues", body);
    },
  };
}

export function makeLogsCollector(
  runner: CommandRunner = new BunCommandRunner(),
): EvidenceCollector {
  return {
    name: "logs",
    async collect(context) {
      const body = await runForEvidence(
        runner,
        ["bun", "run", "src/cli/main.ts", "logs", "--db", context.dbPath, "--limit", "50"],
        context.cwd,
      );
      return writeTextEvidence(context, "logs", body);
    },
  };
}

export function defaultCollectors(): ReadonlyArray<EvidenceCollector> {
  return [
    makeGitCollector(),
    makeDbCollector(),
    makeDiagnoseCollector(),
    makeSystemdCollector(),
    makeGithubCollector(),
    makeLogsCollector(),
  ];
}
