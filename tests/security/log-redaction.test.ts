import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventsRepo } from "@clawde/db/repositories/events";
import { REDACTED_PLACEHOLDER } from "@clawde/log";
import { type TestDb, makeTestDb } from "../helpers/db.ts";

describe("security/event payload redaction", () => {
  let testDb: TestDb;
  let repo: EventsRepo;

  beforeEach(() => {
    testDb = makeTestDb();
    repo = new EventsRepo(testDb.db);
  });

  afterEach(() => {
    testDb.cleanup();
  });

  test("tool_use com token em Bash command persiste payload redigido", () => {
    const event = repo.insert({
      taskRunId: null,
      sessionId: null,
      traceId: "trace-redact",
      spanId: null,
      kind: "tool_use",
      payload: {
        tool_name: "Bash",
        command_summary: "echo sk-ant-fake-token-123",
      },
    });

    expect(event.payload.command_summary).toContain(REDACTED_PLACEHOLDER);
    expect(event.payload.command_summary).not.toContain("sk-ant-fake-token-123");
  });
});
