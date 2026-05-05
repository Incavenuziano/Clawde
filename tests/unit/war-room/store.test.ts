import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WarRoomStore } from "@clawde/war-room";

describe("war-room store", () => {
  let dir: string;
  let store: WarRoomStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clawde-war-room-store-"));
    store = new WarRoomStore({ root: join(dir, "war-room") });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("open cria room ativa e timeline inicial", () => {
    const room = store.open({ kind: "hardening", title: "Round 1" });
    expect(room.id).toMatch(/^WR-\d{8}-001$/);
    expect(store.getActiveId()).toBe(room.id);
    expect(store.readTimeline(room.id)[0]?.type).toBe("open");
  });

  test("segunda open sem force falha quando há room ativa", () => {
    store.open({ kind: "ops", title: "first" });
    expect(() => store.open({ kind: "ops", title: "second" })).toThrow(/already active/);
  });

  test("gates podem ser aprovados com motivo auditável", () => {
    const room = store.open({ kind: "incident", title: "gate test" });
    const gate = store.addGate(room.id, { action: "systemctl restart clawde", reason: "guarded" });
    const approved = store.approveGate(room.id, gate.id, "operator window");
    expect(approved.status).toBe("approved");
    expect(store.readGates(room.id)[0]?.decisionReason).toBe("operator window");
  });

  test("close normal exige verification", () => {
    const room = store.open({ kind: "ops", title: "close" });
    expect(() => store.close(room.id, { outcome: "resolved" })).toThrow(/requires verification/);
    const closed = store.close(room.id, {
      outcome: "resolved",
      force: true,
      summary: "manual close",
    });
    expect(closed.status).toBe("closed");
    expect(store.getActiveId()).toBeNull();
  });
});
