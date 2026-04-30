/**
 * T-056: integration test verifying that the SDK receives
 * `appendSystemPrompt` containing `EXTERNAL_INPUT_SYSTEM_PROMPT` for
 * external task sources (telegram, webhook-*, cron) and NOT for
 * trusted sources (cli, subagent).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventsRepo } from "@clawde/db/repositories/events";
import { QuotaLedgerRepo } from "@clawde/db/repositories/quota-ledger";
import { TaskRunsRepo } from "@clawde/db/repositories/task-runs";
import { TasksRepo } from "@clawde/db/repositories/tasks";
import type { TaskSource } from "@clawde/domain/task";
import { createLogger, resetLogSink, setLogSink } from "@clawde/log";
import { DEFAULT_TRACKER_CONFIG, QuotaTracker, makeQuotaPolicy } from "@clawde/quota";
import { EXTERNAL_INPUT_SYSTEM_PROMPT } from "@clawde/sanitize";
import { LeaseManager, type RunnerDeps, processTask } from "@clawde/worker";
import { type TestDb, makeTestDb } from "../helpers/db.ts";
import { MockAgentClient, assistantText } from "../mocks/sdk-mock.ts";

describe("external input safety prompt (T-054 + T-056)", () => {
  let testDb: TestDb;
  let mockClient: MockAgentClient;
  let deps: RunnerDeps;

  beforeEach(() => {
    testDb = makeTestDb();
    setLogSink(() => {});
    mockClient = new MockAgentClient();
    const tasksRepo = new TasksRepo(testDb.db);
    const runsRepo = new TaskRunsRepo(testDb.db);
    const eventsRepo = new EventsRepo(testDb.db);
    deps = {
      tasksRepo,
      runsRepo,
      eventsRepo,
      leaseManager: new LeaseManager(runsRepo, eventsRepo, {
        leaseSeconds: 60,
        heartbeatSeconds: 999,
      }),
      quotaTracker: new QuotaTracker(new QuotaLedgerRepo(testDb.db), DEFAULT_TRACKER_CONFIG),
      quotaPolicy: makeQuotaPolicy(),
      agentClient: mockClient,
      logger: createLogger({ component: "ext-input-test" }),
      workerId: "w-ei",
    };
  });
  afterEach(() => {
    testDb.cleanup();
    resetLogSink();
  });

  function insertWithSource(source: TaskSource): number {
    const t = deps.tasksRepo.insert({
      priority: "NORMAL",
      prompt: "operator prompt",
      agent: "default",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source,
      sourceMetadata: {},
      dedupKey: null,
    });
    mockClient.enqueueResponse({ messages: [assistantText("ok")] });
    return t.id;
  }

  test("source=telegram → appendSystemPrompt contém EXTERNAL_INPUT_SYSTEM_PROMPT", async () => {
    const t = deps.tasksRepo.findById(insertWithSource("telegram"));
    if (t === null) throw new Error("task missing");
    await processTask(deps, t);

    expect(mockClient.invocations.length).toBe(1);
    const append = mockClient.invocations[0]?.appendSystemPrompt ?? "";
    expect(append).toContain(EXTERNAL_INPUT_SYSTEM_PROMPT);
  });

  test("source=webhook-github → appendSystemPrompt contém o boilerplate", async () => {
    const t = deps.tasksRepo.findById(insertWithSource("webhook-github"));
    if (t === null) throw new Error("task missing");
    await processTask(deps, t);

    const append = mockClient.invocations[0]?.appendSystemPrompt ?? "";
    expect(append).toContain(EXTERNAL_INPUT_SYSTEM_PROMPT);
  });

  test("source=webhook-generic → appendSystemPrompt contém o boilerplate", async () => {
    const t = deps.tasksRepo.findById(insertWithSource("webhook-generic"));
    if (t === null) throw new Error("task missing");
    await processTask(deps, t);

    const append = mockClient.invocations[0]?.appendSystemPrompt ?? "";
    expect(append).toContain(EXTERNAL_INPUT_SYSTEM_PROMPT);
  });

  test("source=cron → appendSystemPrompt contém o boilerplate", async () => {
    const t = deps.tasksRepo.findById(insertWithSource("cron"));
    if (t === null) throw new Error("task missing");
    await processTask(deps, t);

    const append = mockClient.invocations[0]?.appendSystemPrompt ?? "";
    expect(append).toContain(EXTERNAL_INPUT_SYSTEM_PROMPT);
  });

  test("source=cli → appendSystemPrompt NÃO contém o boilerplate", async () => {
    const t = deps.tasksRepo.findById(insertWithSource("cli"));
    if (t === null) throw new Error("task missing");
    await processTask(deps, t);

    const append = mockClient.invocations[0]?.appendSystemPrompt;
    expect(append === undefined || !append.includes(EXTERNAL_INPUT_SYSTEM_PROMPT)).toBe(true);
  });

  test("source=subagent → appendSystemPrompt NÃO contém o boilerplate", async () => {
    const t = deps.tasksRepo.findById(insertWithSource("subagent"));
    if (t === null) throw new Error("task missing");
    await processTask(deps, t);

    const append = mockClient.invocations[0]?.appendSystemPrompt;
    expect(append === undefined || !append.includes(EXTERNAL_INPUT_SYSTEM_PROMPT)).toBe(true);
  });
});
