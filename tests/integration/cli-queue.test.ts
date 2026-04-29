import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, runMain } from "@clawde/cli/main";
import { type ClawdeDatabase, closeDb, openDb } from "@clawde/db/client";
import { applyPending, defaultMigrationsDir } from "@clawde/db/migrations";
import { EventsRepo } from "@clawde/db/repositories/events";
import { TasksRepo } from "@clawde/db/repositories/tasks";
import { createLogger, resetLogSink, setLogSink } from "@clawde/log";
import { type ReceiverHandle, TokenBucketRateLimiter, createReceiver } from "@clawde/receiver";
import { makeEnqueueHandler } from "@clawde/receiver/routes/enqueue";

function captureOutput(fn: () => Promise<number> | number): Promise<{
  exit: number;
  stdout: string;
  stderr: string;
}> {
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  let stdout = "";
  let stderr = "";
  process.stdout.write = ((chunk: unknown): boolean => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown): boolean => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  return Promise.resolve(fn())
    .then((exit) => ({ exit, stdout, stderr }))
    .finally(() => {
      process.stdout.write = origStdout;
      process.stderr.write = origStderr;
    });
}

let portCounter = 28891;
function nextPort(): number {
  return portCounter++;
}

interface Setup {
  readonly db: ClawdeDatabase;
  readonly receiver: ReceiverHandle;
  readonly baseUrl: string;
  readonly dbPath: string;
  readonly cleanup: () => void;
}

async function startReceiver(): Promise<Setup> {
  const dir = mkdtempSync(join(tmpdir(), "clawde-cli-"));
  const dbPath = join(dir, "state.db");
  const db = openDb(dbPath);
  applyPending(db, defaultMigrationsDir());

  setLogSink(() => {});
  const logger = createLogger({ component: "test-cli" });
  const port = nextPort();
  const receiver = createReceiver({ listenTcp: `127.0.0.1:${port}`, logger });

  receiver.registerRoute(
    { method: "POST", path: "/enqueue" },
    makeEnqueueHandler({
      tasksRepo: new TasksRepo(db),
      eventsRepo: new EventsRepo(db),
      rateLimiter: new TokenBucketRateLimiter({ perMinute: 100, perHour: 1000 }),
      logger,
    }),
  );

  return {
    db,
    receiver,
    baseUrl: `http://127.0.0.1:${port}`,
    dbPath,
    cleanup: () => {
      receiver.stop();
      closeDb(db);
      rmSync(dir, { recursive: true, force: true });
      resetLogSink();
    },
  };
}

describe("cli/main parseArgs", () => {
  test("comando + posicionais", () => {
    const p = parseArgs(["queue", "implement", "feature", "X"]);
    expect(p.command).toBe("queue");
    expect(p.positional).toEqual(["implement", "feature", "X"]);
  });

  test("flags com valor", () => {
    const p = parseArgs(["queue", "task", "--priority", "URGENT", "--agent", "implementer"]);
    expect(p.flags.priority).toBe("URGENT");
    expect(p.flags.agent).toBe("implementer");
  });

  test("flag=value", () => {
    const p = parseArgs(["migrate", "--target=0", "--confirm"]);
    expect(p.flags.target).toBe("0");
    expect(p.flags.confirm).toBe(true);
  });

  test("flag boolean (sem valor)", () => {
    const p = parseArgs(["smoke-test", "--output", "json"]);
    expect(p.flags.output).toBe("json");
  });

  test("default command=help quando vazio", () => {
    const p = parseArgs([]);
    expect(p.command).toBe("help");
  });
});

describe("cli/main runMain comandos básicos", () => {
  test("help retorna 0 com texto de uso em stdout", async () => {
    const { exit, stdout } = await captureOutput(() => runMain(["help"]));
    expect(exit).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("queue");
  });

  test("comando desconhecido retorna 1 + erro em stderr", async () => {
    const { exit, stderr } = await captureOutput(() => runMain(["frobnicate"]));
    expect(exit).toBe(1);
    expect(stderr).toContain("unknown command");
  });

  test("version retorna semver", async () => {
    const { exit, stdout } = await captureOutput(() => runMain(["version"]));
    expect(exit).toBe(0);
    expect(stdout).toContain("0.0.1");
  });

  test("queue sem prompt retorna 1", async () => {
    const { exit, stderr } = await captureOutput(() => runMain(["queue"]));
    expect(exit).toBe(1);
    expect(stderr).toContain("prompt required");
  });
});

describe("cli queue → receiver E2E", () => {
  let setup: Setup;
  beforeEach(async () => {
    setup = await startReceiver();
  });
  afterEach(() => setup.cleanup());

  test("clawde queue 'test prompt' enfileira via receiver", async () => {
    const { exit, stdout } = await captureOutput(() =>
      runMain(["queue", "test", "prompt", "--receiver-url", setup.baseUrl, "--db", setup.dbPath]),
    );
    expect(exit).toBe(0);
    expect(stdout).toContain("taskId=");
    expect(stdout).toContain("traceId=");

    // Verifica row inserida.
    const rows = setup.db.query("SELECT id, prompt FROM tasks").all() as Array<{
      id: number;
      prompt: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.prompt).toBe("test prompt");
  });

  test("--priority URGENT respeitado", async () => {
    await captureOutput(() =>
      runMain(["queue", "p", "--priority", "URGENT", "--receiver-url", setup.baseUrl]),
    );
    const row = setup.db.query("SELECT priority FROM tasks LIMIT 1").get() as {
      priority: string;
    };
    expect(row.priority).toBe("URGENT");
  });

  test("dedupKey duplicada exit 0 com (deduped) em output", async () => {
    await captureOutput(() =>
      runMain(["queue", "p", "--dedup-key", "k1", "--receiver-url", setup.baseUrl]),
    );
    const { exit, stdout } = await captureOutput(() =>
      runMain(["queue", "p", "--dedup-key", "k1", "--receiver-url", setup.baseUrl]),
    );
    expect(exit).toBe(0);
    expect(stdout).toContain("(deduped)");
  });

  test("--output json produz JSON parseável", async () => {
    const { exit, stdout } = await captureOutput(() =>
      runMain(["queue", "p", "--output", "json", "--receiver-url", setup.baseUrl]),
    );
    expect(exit).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.taskId).toBeGreaterThan(0);
    expect(parsed.deduped).toBe(false);
  });

  test("receiver indisponível retorna exit 2", async () => {
    const { exit, stderr } = await captureOutput(() =>
      runMain([
        "queue",
        "p",
        "--receiver-url",
        "http://127.0.0.1:1", // porta sem receiver
      ]),
    );
    expect(exit).toBe(2);
    expect(stderr).toContain("unreachable");
  });

  test("validation error (prompt vazio via receiver) → exit 1", async () => {
    // CLI bloqueia prompt vazio antes de chegar no receiver — validamos isso.
    const { exit, stderr } = await captureOutput(() =>
      runMain(["queue", "--receiver-url", setup.baseUrl]),
    );
    expect(exit).toBe(1);
    expect(stderr).toContain("prompt required");
  });
});
