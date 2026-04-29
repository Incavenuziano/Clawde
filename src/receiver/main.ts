import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@clawde/config";
import { openDb } from "@clawde/db/client";
import { applyPending, defaultMigrationsDir } from "@clawde/db/migrations";
import { createLogger, setMinLevel } from "@clawde/log";
import { type ReceiverHandle, createReceiver } from "./server.ts";

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") return p.replace(/^~/, homedir());
  return p;
}

export async function bootstrap(): Promise<ReceiverHandle> {
  const config = loadConfig();
  setMinLevel(config.clawde.log_level);
  const logger = createLogger({ service: "receiver" });
  const dbPath = join(expandHome(config.clawde.home), "state.db");
  const db = openDb(dbPath);
  applyPending(db, defaultMigrationsDir());
  const handle = createReceiver({
    listenTcp: config.receiver.listen_tcp,
    listenUnix: config.receiver.listen_unix,
    logger,
  });
  return handle;
}
