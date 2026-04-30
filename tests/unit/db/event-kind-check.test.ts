import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type TestDb, makeTestDb } from "../../helpers/db.ts";

describe("db/events kind CHECK constraint", () => {
  let testDb: TestDb;

  beforeEach(() => {
    testDb = makeTestDb();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  test("rejects invalid events.kind values", () => {
    expect(() =>
      testDb.db.exec(`
        INSERT INTO events (kind, payload)
        VALUES ('typo_kind', '{}')
      `),
    ).toThrow(/CHECK constraint failed/);
  });
});
