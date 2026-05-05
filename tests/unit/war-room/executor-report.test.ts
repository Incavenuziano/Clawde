import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeCommandRunner, WarRoomStore, buildWarRoomReport, executeWave } from "@clawde/war-room";

describe("war-room executor + report", () => {
  let dir: string;
  let store: WarRoomStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clawde-war-room-exec-"));
    store = new WarRoomStore({ root: join(dir, "war-room") });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("dry-run lista comandos sem executar", async () => {
    const room = store.open({ kind: "ops", title: "dry" });
    store.writePlan(room.id, {
      sourcePath: "fixture",
      createdAt: "2026-05-05T00:00:00Z",
      notes: [],
      waves: [
        {
          id: "wave-1",
          title: "wave",
          checks: [],
          files: [],
          commands: [{ id: "cmd-1", argv: ["git", "status"], lane: "green" }],
        },
      ],
    });
    const runner = new FakeCommandRunner();
    const result = await executeWave({
      roomId: room.id,
      waveId: "wave-1",
      dryRun: true,
      confirm: false,
      cwd: dir,
      store,
      runner,
    });
    expect(result.ok).toBe(true);
    expect(runner.calls).toHaveLength(0);
  });

  test("guarded command cria gate e report redige segredo", async () => {
    const room = store.open({ kind: "incident", title: "guarded" });
    store.writePlan(room.id, {
      sourcePath: "fixture",
      createdAt: "2026-05-05T00:00:00Z",
      notes: [],
      waves: [
        {
          id: "wave-1",
          title: "wave",
          checks: [],
          files: [],
          commands: [
            {
              id: "cmd-1",
              argv: ["clawde", "events", "purge", "--confirm", "sk-ant-secret"],
              lane: "guarded",
            },
          ],
        },
      ],
    });
    const result = await executeWave({
      roomId: room.id,
      waveId: "wave-1",
      dryRun: false,
      confirm: true,
      cwd: dir,
      store,
    });
    expect(result.ok).toBe(false);
    expect(store.readGates(room.id)).toHaveLength(1);
    expect(buildWarRoomReport(store, room.id)).toContain("[REDACTED]");
  });

  test("guarded command aprovado executa com confirm", async () => {
    const room = store.open({ kind: "incident", title: "approved" });
    const action = "clawde events purge --confirm";
    const gate = store.addGate(room.id, { action, reason: "manual approval required" });
    store.approveGate(room.id, gate.id, "operator present");
    store.writePlan(room.id, {
      sourcePath: "fixture",
      createdAt: "2026-05-05T00:00:00Z",
      notes: [],
      waves: [
        {
          id: "wave-1",
          title: "wave",
          checks: [],
          files: [],
          commands: [{ id: "cmd-1", argv: action.split(" "), lane: "guarded" }],
        },
      ],
    });
    const runner = new FakeCommandRunner();
    runner.enqueue({ exitCode: 0, stdout: "ok" });
    const result = await executeWave({
      roomId: room.id,
      waveId: "wave-1",
      dryRun: false,
      confirm: true,
      cwd: dir,
      store,
      runner,
    });
    expect(result.ok).toBe(true);
    expect(runner.calls).toHaveLength(1);
  });
});
