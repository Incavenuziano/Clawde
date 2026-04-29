import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SessionsRepo } from "@clawde/db/repositories/sessions";
import { deriveSessionId } from "@clawde/domain/session";
import { InvalidTransitionError } from "@clawde/state";
import { makeTestDb, type TestDb } from "../../helpers/db.ts";

describe("repositories/sessions", () => {
  let testDb: TestDb;
  let repo: SessionsRepo;

  beforeEach(() => {
    testDb = makeTestDb();
    repo = new SessionsRepo(testDb.db);
  });
  afterEach(() => testDb.cleanup());

  test("upsert cria sessão em state=created", () => {
    const id = deriveSessionId({ agent: "default", workingDir: "/tmp" });
    const s = repo.upsert({ sessionId: id, agent: "default" });
    expect(s.sessionId).toBe(id);
    expect(s.state).toBe("created");
    expect(s.msgCount).toBe(0);
  });

  test("upsert idempotente: 2x não muda nada", () => {
    const id = deriveSessionId({ agent: "default", workingDir: "/tmp" });
    repo.upsert({ sessionId: id, agent: "default" });
    repo.transitionState(id, "active"); // muda manualmente
    const s = repo.upsert({ sessionId: id, agent: "default" });
    expect(s.state).toBe("active"); // não voltou pra created
  });

  test("findById retorna null para id inexistente", () => {
    expect(repo.findById("nonexistent")).toBeNull();
  });

  test("transitionState created → active válido", () => {
    const id = deriveSessionId({ agent: "default", workingDir: "/tmp" });
    repo.upsert({ sessionId: id, agent: "default" });
    const after = repo.transitionState(id, "active");
    expect(after.state).toBe("active");
  });

  test("transitionState created → idle inválido lança erro", () => {
    const id = deriveSessionId({ agent: "default", workingDir: "/tmp" });
    repo.upsert({ sessionId: id, agent: "default" });
    expect(() => repo.transitionState(id, "idle")).toThrow(InvalidTransitionError);
  });

  test("ciclo created → active → idle → stale → archived", () => {
    const id = deriveSessionId({ agent: "default", workingDir: "/tmp" });
    repo.upsert({ sessionId: id, agent: "default" });
    repo.transitionState(id, "active");
    repo.transitionState(id, "idle");
    repo.transitionState(id, "stale");
    const final = repo.transitionState(id, "archived");
    expect(final.state).toBe("archived");
  });

  test("listByState filtra corretamente", () => {
    const a = deriveSessionId({ agent: "default", workingDir: "/a" });
    const b = deriveSessionId({ agent: "default", workingDir: "/b" });
    const c = deriveSessionId({ agent: "default", workingDir: "/c" });
    repo.upsert({ sessionId: a, agent: "default" });
    repo.upsert({ sessionId: b, agent: "default" });
    repo.upsert({ sessionId: c, agent: "default" });
    repo.transitionState(b, "active");

    expect(repo.listByState("created")).toHaveLength(2);
    expect(repo.listByState("active")).toHaveLength(1);
    expect(repo.listByState("active")[0]?.sessionId).toBe(b);
  });

  test("markUsed incrementa msg_count + atualiza last_used_at", () => {
    const id = deriveSessionId({ agent: "default", workingDir: "/tmp" });
    repo.upsert({ sessionId: id, agent: "default" });
    expect(repo.findById(id)?.lastUsedAt).toBeNull();

    const used = repo.markUsed(id, 3, 500);
    expect(used.msgCount).toBe(3);
    expect(used.tokenEstimate).toBe(500);
    expect(used.lastUsedAt).not.toBeNull();
  });

  test("markUsed acumula em múltiplas chamadas", () => {
    const id = deriveSessionId({ agent: "default", workingDir: "/tmp" });
    repo.upsert({ sessionId: id, agent: "default" });
    repo.markUsed(id, 1, 100);
    repo.markUsed(id, 2, 200);
    const final = repo.findById(id);
    expect(final?.msgCount).toBe(3);
    expect(final?.tokenEstimate).toBe(300);
  });

  test("archived é terminal: archived → active inválido", () => {
    const id = deriveSessionId({ agent: "default", workingDir: "/tmp" });
    repo.upsert({ sessionId: id, agent: "default" });
    repo.transitionState(id, "active");
    repo.transitionState(id, "idle");
    repo.transitionState(id, "stale");
    repo.transitionState(id, "archived");
    expect(() => repo.transitionState(id, "active")).toThrow(InvalidTransitionError);
  });
});
