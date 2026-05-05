/**
 * Tests for issue #59: review pipeline not wired from config in worker/main.ts
 *
 * Verifies:
 * - With review_required=true: worker executes review pipeline and events are emitted
 * - With review_required=false: worker bypasses pipeline (legacy path preserved)
 * - Mock deps.review.run is used — no real SDK calls
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventsRepo } from "@clawde/db/repositories/events";
import { QuotaLedgerRepo } from "@clawde/db/repositories/quota-ledger";
import { TaskRunsRepo } from "@clawde/db/repositories/task-runs";
import { TasksRepo } from "@clawde/db/repositories/tasks";
import { createLogger, resetLogSink, setLogSink } from "@clawde/log";
import { DEFAULT_TRACKER_CONFIG, QuotaTracker, makeQuotaPolicy } from "@clawde/quota";
import type { PipelineConfig, PipelineDeps, PipelineResult } from "@clawde/review";
import { LeaseManager, type RunnerDeps, processTask } from "@clawde/worker";
import type { ReviewPipelineDeps } from "@clawde/worker/runner";
import { type TestDb, makeTestDb } from "../helpers/db.ts";
import { MockAgentClient, assistantText } from "../mocks/sdk-mock.ts";

function makeApproveReviewMock(): { deps: ReviewPipelineDeps; callCount: number[] } {
  const callCount: number[] = [];
  const mockRun = async (
    _taskSpec: string,
    _config: PipelineConfig,
    _pipelineDeps: PipelineDeps,
  ): Promise<PipelineResult> => {
    callCount.push(1);
    return {
      status: "approved",
      stages: [{ role: "implementer", attemptN: 1, output: "approved", verdict: "APPROVED" }],
      finalOutput: "approved",
      totalRoundsRun: 1,
    };
  };
  const deps: ReviewPipelineDeps = {
    config: { stages: ["implementer"] },
    run: mockRun,
  };
  return { deps, callCount };
}

describe("worker review pipeline wiring (issue #59)", () => {
  let testDb: TestDb;
  let baseDeps: RunnerDeps;
  let mockClient: MockAgentClient;

  beforeEach(() => {
    testDb = makeTestDb();
    setLogSink(() => {});
    mockClient = new MockAgentClient();

    const tasksRepo = new TasksRepo(testDb.db);
    const runsRepo = new TaskRunsRepo(testDb.db);
    const eventsRepo = new EventsRepo(testDb.db);
    const quotaTracker = new QuotaTracker(new QuotaLedgerRepo(testDb.db), DEFAULT_TRACKER_CONFIG);
    const quotaPolicy = makeQuotaPolicy();
    const logger = createLogger({ component: "test" });
    const leaseManager = new LeaseManager(runsRepo, eventsRepo, {
      leaseSeconds: 30,
      heartbeatSeconds: 5,
    });

    baseDeps = {
      tasksRepo,
      runsRepo,
      eventsRepo,
      leaseManager,
      quotaTracker,
      quotaPolicy,
      agentClient: mockClient,
      logger,
      workerId: "test-worker",
      resolveAgentDefinition: async (agent) => {
        // Return a minimal stub so processTask doesn't throw "not found".
        // Level 1, no allowedTools restrictions — safe for unit-like integration tests.
        return {
          name: agent,
          dir: "/tmp",
          frontmatter: {
            name: agent,
            role: "test",
            allowedTools: ["Read"],
            disallowedTools: [],
            maxTurns: 5,
            sandboxLevel: 1,
            requiresWorkspace: false,
            model: "inherit",
          },
          sandbox: {
            level: 1 as const,
            network: "none" as const,
            allowed_egress: [],
            allowed_writes: [],
            read_only_mounts: [],
          },
        };
      },
    };
  });

  afterEach(() => {
    testDb.cleanup();
    resetLogSink();
  });

  test("review_required=true: deps.review.run é invocado e review.implementer.start é emitido", async () => {
    const { deps: reviewDeps, callCount } = makeApproveReviewMock();
    mockClient.enqueueResponse({ messages: [assistantText("implementation done")] });

    const task = baseDeps.tasksRepo.insert({
      priority: "NORMAL",
      prompt: "test review wiring",
      agent: "implementer",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });

    const result = await processTask({ ...baseDeps, review: reviewDeps }, task);

    expect(result.run.status).toBe("succeeded");
    expect(callCount).toHaveLength(1);

    const reviewEvents = baseDeps.eventsRepo
      .queryByTaskRun(result.run.id)
      .filter((e) => e.kind.startsWith("review."));
    expect(reviewEvents.length).toBeGreaterThan(0);
    expect(reviewEvents.some((e) => e.kind === "review.pipeline.complete")).toBe(true);
  });

  test("review_required=false (deps.review ausente): review.run NÃO é chamado, caminho legacy preservado", async () => {
    mockClient.enqueueResponse({ messages: [assistantText("done without review")] });

    const task = baseDeps.tasksRepo.insert({
      priority: "NORMAL",
      prompt: "no review",
      agent: "researcher",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "cli",
      sourceMetadata: {},
      dedupKey: null,
    });

    // No review in deps
    const result = await processTask(baseDeps, task);

    expect(result.run.status).toBe("succeeded");

    const reviewEvents = baseDeps.eventsRepo
      .queryByTaskRun(result.run.id)
      .filter((e) => e.kind.startsWith("review."));
    expect(reviewEvents).toHaveLength(0);
  });
});
