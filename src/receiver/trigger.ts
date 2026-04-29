import { spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface WorkerTrigger {
  trigger(traceId: string): Promise<void>;
}

export interface SystemdWorkerTriggerOptions {
  readonly unit?: string;
  readonly signalPath?: string;
}

/**
 * Trigger padrão: dispara worker via systemd user-unit.
 * Opcionalmente toca um arquivo-sinal pra fallback via .path.
 */
export class SystemdWorkerTrigger implements WorkerTrigger {
  private readonly unit: string;
  private readonly signalPath: string | null;

  constructor(options: SystemdWorkerTriggerOptions = {}) {
    this.unit = options.unit ?? "clawde-worker.service";
    this.signalPath = options.signalPath ?? null;
  }

  async trigger(traceId: string): Promise<void> {
    if (this.signalPath !== null) {
      await mkdir(dirname(this.signalPath), { recursive: true });
      await appendFile(this.signalPath, `${Date.now()} ${traceId}\n`, "utf-8");
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn("systemctl", ["--user", "start", this.unit], {
        stdio: "ignore",
        detached: true,
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
  }
}

export class NoopWorkerTrigger implements WorkerTrigger {
  async trigger(_traceId: string): Promise<void> {}
}
