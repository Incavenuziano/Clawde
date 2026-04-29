/**
 * POST /enqueue (BLUEPRINT §3.1).
 *
 * Valida payload via zod; aplica dedup; INSERT em tasks; retorna 202 com {taskId,
 * traceId, deduped}.
 *
 * Trace ID: gerado se ausente no header X-Clawde-Trace-Id; ecoa em response.
 */

import { z } from "zod";
import type { EventsRepo } from "@clawde/db/repositories/events";
import type { TasksRepo } from "@clawde/db/repositories/tasks";
import type { NewTask } from "@clawde/domain/task";
import type { Logger } from "@clawde/log";
import { newTraceId } from "@clawde/log";
import type { TokenBucketRateLimiter } from "../auth/rate-limit.ts";
import { insertWithDedup } from "../dedup.ts";
import type { RouteHandler } from "../server.ts";

const PRIORITY = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL");

const EnqueueRequestSchema = z.object({
  prompt: z.string().min(1).max(16_000),
  priority: PRIORITY,
  agent: z.string().default("default"),
  sessionId: z.string().nullable().default(null),
  workingDir: z.string().nullable().default(null),
  dependsOn: z.array(z.number().int().nonnegative()).default([]),
  dedupKey: z.string().max(256).nullable().default(null),
  sourceMetadata: z.record(z.string(), z.unknown()).default({}),
  // source não vem do payload; é determinado pelo endpoint.
});

export interface EnqueueRouteDeps {
  readonly tasksRepo: TasksRepo;
  readonly eventsRepo: EventsRepo;
  readonly rateLimiter: TokenBucketRateLimiter;
  readonly logger: Logger;
}

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

export function makeEnqueueHandler(deps: EnqueueRouteDeps): RouteHandler {
  return async (ctx) => {
    // Trace ID propaga no response.
    const incomingTrace = ctx.request.headers.get("X-Clawde-Trace-Id");
    const traceId = incomingTrace !== null && incomingTrace.length > 0 ? incomingTrace : newTraceId();
    const traceHeaders = { "X-Clawde-Trace-Id": traceId };

    // Rate limit por origem.
    const rate = deps.rateLimiter.check(ctx.remoteAddr);
    if (!rate.allow) {
      deps.eventsRepo.insert({
        taskRunId: null,
        sessionId: null,
        traceId,
        spanId: null,
        kind: "rate_limit_hit",
        payload: { remote_addr: ctx.remoteAddr, reason: rate.reason ?? "" },
      });
      return jsonResponse(
        { error: rate.reason ?? "rate limited" },
        429,
        { ...traceHeaders, "Retry-After": String(rate.retryAfterSeconds) },
      );
    }

    let body: unknown;
    try {
      body = await ctx.request.json();
    } catch (err) {
      return jsonResponse(
        { error: `invalid JSON: ${(err as Error).message}` },
        400,
        traceHeaders,
      );
    }

    const parsed = EnqueueRequestSchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse(
        {
          error: "validation failed",
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        400,
        traceHeaders,
      );
    }

    // Header X-Idempotency-Key como alternativa a body.dedupKey.
    const headerKey = ctx.request.headers.get("X-Idempotency-Key");
    const dedupKey = parsed.data.dedupKey ?? (headerKey !== null && headerKey.length > 0 ? headerKey : null);

    // source determinado pelo endpoint — /enqueue assume CLI.
    const newTask: NewTask = {
      priority: parsed.data.priority,
      prompt: parsed.data.prompt,
      agent: parsed.data.agent,
      sessionId: parsed.data.sessionId,
      workingDir: parsed.data.workingDir,
      dependsOn: parsed.data.dependsOn,
      source: "cli",
      sourceMetadata: parsed.data.sourceMetadata,
      dedupKey,
    };

    const result = insertWithDedup(deps.tasksRepo, newTask);
    deps.eventsRepo.insert({
      taskRunId: null,
      sessionId: null,
      traceId,
      spanId: null,
      kind: result.deduped ? "dedup_skip" : "enqueue",
      payload: {
        task_id: result.task.id,
        priority: result.task.priority,
        source: "cli",
        dedup_key: dedupKey,
      },
    });

    if (result.deduped) {
      return jsonResponse(
        { taskId: result.task.id, traceId, deduped: true },
        409,
        traceHeaders,
      );
    }

    return jsonResponse(
      { taskId: result.task.id, traceId, deduped: false },
      202,
      traceHeaders,
    );
  };
}
