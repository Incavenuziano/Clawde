/**
 * F6 — POST /webhook/telegram (BLUEPRINT §3.3, ADR 0011 + §10.6).
 *
 * Telegram envia POST com JSON Update payload + header
 * X-Telegram-Bot-Api-Secret-Token (configurado em setWebhook). Verificamos
 * secret em constant time, parseamos message texto, embrulhamos em
 * <external_input source="telegram:<user_id>"> e enfileiramos como task com
 * source="telegram".
 *
 * Allowlist de user_id pra evitar bot público — config telegram.allowed_user_ids.
 *
 * NÃO usamos lib grammy aqui — apenas HTTP raw, contrato Telegram é pequeno
 * e estável. Se virar bot interativo (responder mensagens), aí justifica grammy.
 */

import type { EventsRepo } from "@clawde/db/repositories/events";
import type { TasksRepo } from "@clawde/db/repositories/tasks";
import type { NewTask, Priority } from "@clawde/domain/task";
import type { Logger } from "@clawde/log";
import { newTraceId } from "@clawde/log";
import { wrapExternalInput } from "@clawde/sanitize";
import { z } from "zod";
import { verifyTelegramSecret } from "../auth/hmac.ts";
import type { TokenBucketRateLimiter } from "../auth/rate-limit.ts";
import { insertWithDedup } from "../dedup.ts";
import type { RouteHandler } from "../server.ts";

// Schema mínimo de Update que precisamos (Telegram tem dezenas de campos).
const TelegramFromSchema = z.object({
  id: z.number().int(),
  is_bot: z.boolean().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
});

const TelegramChatSchema = z.object({
  id: z.number().int(),
  type: z.enum(["private", "group", "supergroup", "channel"]).optional(),
});

const TelegramMessageSchema = z.object({
  message_id: z.number().int(),
  date: z.number().int(),
  text: z.string().min(1).max(4096), // Telegram limit
  from: TelegramFromSchema.optional(),
  chat: TelegramChatSchema,
});

const TelegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: TelegramMessageSchema.optional(),
  edited_message: TelegramMessageSchema.optional(),
});

export interface TelegramRouteConfig {
  readonly secret: string;
  readonly allowedUserIds: ReadonlyArray<number>;
  readonly defaultPriority?: Priority;
  readonly defaultAgent?: string;
}

export interface TelegramRouteDeps {
  readonly tasksRepo: TasksRepo;
  readonly eventsRepo: EventsRepo;
  readonly rateLimiter: TokenBucketRateLimiter;
  readonly logger: Logger;
  readonly config: TelegramRouteConfig;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function makeTelegramHandler(deps: TelegramRouteDeps): RouteHandler {
  return async (ctx) => {
    const traceId = newTraceId();

    // 1. HMAC secret check ANTES de qualquer parsing — não dá feedback útil
    // pra atacante.
    const secretHeader = ctx.request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    const verdict = verifyTelegramSecret(secretHeader, deps.config.secret);
    if (!verdict.ok) {
      deps.eventsRepo.insert({
        taskRunId: null,
        sessionId: null,
        traceId,
        spanId: null,
        kind: "auth.telegram_reject",
        payload: { reason: verdict.reason ?? "?" },
      });
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    // 2. Rate limit por origem (defesa secundária — secret deve bastar).
    const rate = deps.rateLimiter.check(ctx.remoteAddr);
    if (!rate.allow) {
      return jsonResponse({ error: rate.reason ?? "rate limited" }, 429);
    }

    // 3. Parse body.
    let body: unknown;
    try {
      body = await ctx.request.json();
    } catch (err) {
      return jsonResponse({ error: `invalid JSON: ${(err as Error).message}` }, 400);
    }

    const parsed = TelegramUpdateSchema.safeParse(body);
    if (!parsed.success) {
      // Telegram envia eventos sem message (ex: callback_query). Aceitamos OK.
      return jsonResponse({ ok: true, ignored: "unsupported update type" }, 200);
    }

    const message = parsed.data.message ?? parsed.data.edited_message;
    if (message === undefined) {
      // Update válido mas sem texto (foto, sticker, etc). Ignorado, 200 OK.
      return jsonResponse({ ok: true, ignored: "no text message" }, 200);
    }

    // 4. Allowlist de user_id.
    const fromId = message.from?.id;
    if (fromId === undefined || !deps.config.allowedUserIds.includes(fromId)) {
      deps.eventsRepo.insert({
        taskRunId: null,
        sessionId: null,
        traceId,
        spanId: null,
        kind: "auth.telegram_user_blocked",
        payload: {
          user_id: fromId ?? null,
          chat_id: message.chat.id,
          message_id: message.message_id,
        },
      });
      // Retornamos 200 pra Telegram não retentar, mas não enfileiramos.
      return jsonResponse({ ok: true, ignored: "user not allowed" }, 200);
    }

    // 5. Embrulhar conteúdo no envelope XML.
    const envelope = wrapExternalInput({
      source: `telegram:${fromId}`,
      content: message.text,
      metadata: {
        chat_id: message.chat.id,
        message_id: message.message_id,
        update_id: parsed.data.update_id,
      },
    });

    // 6. Dedup natural por update_id (Telegram retenta mesma update se 5xx).
    const dedupKey = `telegram:update:${parsed.data.update_id}`;

    const newTask: NewTask = {
      priority: deps.config.defaultPriority ?? "NORMAL",
      prompt: envelope,
      agent: deps.config.defaultAgent ?? "telegram-bot",
      sessionId: null,
      workingDir: null,
      dependsOn: [],
      source: "telegram",
      sourceMetadata: {
        update_id: parsed.data.update_id,
        chat_id: message.chat.id,
        chat_type: message.chat.type ?? "private",
        user_id: fromId,
        username: message.from?.username ?? null,
        language_code: message.from?.language_code ?? null,
        message_id: message.message_id,
        date: message.date,
        edited: parsed.data.edited_message !== undefined,
      },
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
        source: "telegram",
        update_id: parsed.data.update_id,
        user_id: fromId,
      },
    });

    // Telegram desliga retry quando recebe 200; mesmo em dedup, retornamos OK.
    return jsonResponse(
      { ok: true, taskId: result.task.id, deduped: result.deduped, traceId },
      200,
    );
  };
}
