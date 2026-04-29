import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventsRepo } from "@clawde/db/repositories/events";
import { QuotaLedgerRepo } from "@clawde/db/repositories/quota-ledger";
import { TaskRunsRepo } from "@clawde/db/repositories/task-runs";
import { TasksRepo } from "@clawde/db/repositories/tasks";
import { createLogger } from "@clawde/log";
import { DEFAULT_TRACKER_CONFIG, QuotaTracker, makeQuotaPolicy } from "@clawde/quota";
import type { AgentClient, ParsedMessage, RunAgentOptions } from "@clawde/sdk";
import { LeaseManager, createWorkspace, makeReconciler, processTask } from "@clawde/worker";
import { type TestDb, makeTestDb } from "../helpers/db.ts";

function initRepo(dir: string): void {
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "base\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: dir });
}

class WritingClient implements AgentClient {
  async *stream(options: RunAgentOptions): AsyncIterable<ParsedMessage> {
    if (options.workingDirectory !== undefined) {
      writeFileSync(join(options.workingDirectory, "workspace-output.txt"), "ok\n");
    }
    yield { role: "assistant", blocks: [{ type: "text", text: "ok" }] };
  }
  async run(): Promise<never> {
    throw new Error("not used");
  }
}

describe("workspace isolation", () => {
  let testDb: TestDb;
  let repoRoot: string;
  let tmpRoot: string;
  let tasksRepo: TasksRepo;
  let runsRepo: TaskRunsRepo;
  let eventsRepo: EventsRepo;

  beforeEach(() => {
    testDb = makeTestDb();
    repoRoot = mkdtempSync(join(tmpdir(), "clawde-repo-"));
    tmpRoot = mkdtempSync(join(tmpdir(), "clawde-ws-"));
    initRepo(repoRoot);
    tasksRepo = new TasksRepo(testDb.db);
    runsRepo = new TaskRunsRepo(testDb.db);
    eventsRepo = new EventsRepo(testDb.db);
  });

  afterEach(() => {
    testDb.cleanup();
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("task escreve no worktree, não no repo principal", async () => {
    const task = tasksRepo.insert({
      priority: "NORMAL",
      prompt: "workspace write",
      agent: "implementer",
      sessionId: null,
      workingDir: repoRoot,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });

    const result = await processTask(
      {
        tasksRepo,
        runsRepo,
        eventsRepo,
        leaseManager: new LeaseManager(runsRepo, eventsRepo, {
          leaseSeconds: 60,
          heartbeatSeconds: 999,
        }),
        quotaTracker: new QuotaTracker(new QuotaLedgerRepo(testDb.db), DEFAULT_TRACKER_CONFIG),
        quotaPolicy: makeQuotaPolicy(),
        agentClient: new WritingClient(),
        logger: createLogger({ component: "workspace-isolation-test" }),
        workerId: "w1",
        workspaceConfig: { tmpRoot, baseBranch: "main" },
        resolveAgentDefinition: async () => ({ frontmatter: { requiresWorkspace: true } }),
      },
      task,
    );

    expect(result.run.status).toBe("succeeded");
    expect(existsSync(join(repoRoot, "workspace-output.txt"))).toBe(false);
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot })
      .toString("utf-8")
      .trim();
    expect(status).toBe("");
  });

  test("reconcile remove worktree órfã de run expirado", async () => {
    const task = tasksRepo.insert({
      priority: "NORMAL",
      prompt: "orphan",
      agent: "implementer",
      sessionId: null,
      workingDir: repoRoot,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });
    const run = runsRepo.insert(task.id, "w-old");
    runsRepo.acquireLease(run.id, 60);
    testDb.db.exec(
      `UPDATE task_runs SET lease_until = datetime('now', '-10 seconds') WHERE id = ${run.id}`,
    );
    const ws = await createWorkspace({
      taskRunId: run.id,
      taskId: task.id,
      slug: "orphan",
      baseBranch: "main",
      repoRoot,
      tmpRoot,
    });
    expect(existsSync(ws.path)).toBe(true);

    const rec = makeReconciler(runsRepo, eventsRepo, {
      tasksRepo,
      workspaceTmpRoot: tmpRoot,
    }).reconcile("w-new");
    expect(rec.cleanedOrphans).toBeGreaterThanOrEqual(1);
    expect(existsSync(ws.path)).toBe(false);
  });
});
