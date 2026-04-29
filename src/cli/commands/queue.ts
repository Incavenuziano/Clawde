/**
 * `clawde queue [opts] <prompt>` — POST /enqueue no receiver.
 *
 * Por enquanto via HTTP TCP (unix socket virá quando o setup definitivo for
 * scripted). Erros: receiver indisponível → exit 2; auth → exit 4.
 */

import type { OutputFormat } from "../output.ts";
import { emit, emitErr } from "../output.ts";

export interface QueueOptions {
  readonly prompt: string;
  readonly priority: string;
  readonly agent: string;
  readonly sessionId?: string;
  readonly workingDir?: string;
  readonly dedupKey?: string;
  readonly receiverUrl: string;
  readonly format: OutputFormat;
}

interface EnqueueResponseOk {
  taskId: number;
  traceId: string;
  deduped: boolean;
}

interface EnqueueResponseErr {
  error: string;
  issues?: Array<{ path: string; message: string }>;
}

export async function runQueue(options: QueueOptions): Promise<number> {
  const body: Record<string, unknown> = {
    prompt: options.prompt,
    priority: options.priority,
    agent: options.agent,
  };
  if (options.sessionId !== undefined) body.sessionId = options.sessionId;
  if (options.workingDir !== undefined) body.workingDir = options.workingDir;
  if (options.dedupKey !== undefined) body.dedupKey = options.dedupKey;

  let response: Response;
  try {
    response = await fetch(`${options.receiverUrl}/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    emitErr(
      `error: receiver unreachable at ${options.receiverUrl} (${(err as Error).message})`,
    );
    return 2;
  }

  if (response.status === 401 || response.status === 403) {
    const text = await response.text();
    emitErr(`auth error (${response.status}): ${text}`);
    return 4;
  }

  if (response.status === 429) {
    emitErr("rate limited; retry later");
    return 3;
  }

  if (response.status >= 500) {
    const text = await response.text();
    emitErr(`receiver error (${response.status}): ${text}`);
    return 2;
  }

  const json = (await response.json()) as EnqueueResponseOk | EnqueueResponseErr;

  if (response.status === 400) {
    emitErr(`validation error: ${(json as EnqueueResponseErr).error}`);
    const issues = (json as EnqueueResponseErr).issues;
    if (issues !== undefined) {
      for (const i of issues) {
        emitErr(`  ${i.path}: ${i.message}`);
      }
    }
    return 1;
  }

  // 202 ou 409 (deduped) — sucesso lógico em ambos.
  const ok = json as EnqueueResponseOk;
  emit(options.format, ok, (d) => {
    const data = d as EnqueueResponseOk;
    const dedupNote = data.deduped ? " (deduped)" : "";
    return `taskId=${data.taskId} traceId=${data.traceId}${dedupNote}`;
  });
  return 0;
}
