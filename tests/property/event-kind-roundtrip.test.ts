import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventsRepo } from "@clawde/db/repositories/events";
import { EVENT_KIND_VALUES } from "@clawde/domain/event";
import { type TestDb, makeTestDb } from "../helpers/db.ts";

describe("property: EventKind roundtrip", () => {
  let testDb: TestDb;
  let repo: EventsRepo;

  beforeEach(() => {
    testDb = makeTestDb();
    repo = new EventsRepo(testDb.db);
  });

  afterEach(() => {
    testDb.cleanup();
  });

  test("every EVENT_KIND_VALUE inserts and reads back", () => {
    for (const kind of EVENT_KIND_VALUES) {
      const inserted = repo.insert({
        taskRunId: null,
        sessionId: null,
        traceId: null,
        spanId: null,
        kind,
        payload: { probe: kind },
      });
      expect(inserted.kind).toBe(kind);
      expect(inserted.payload).toEqual({ probe: kind });
    }
  });
});
