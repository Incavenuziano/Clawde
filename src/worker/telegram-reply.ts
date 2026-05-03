import type { Task } from "@clawde/domain/task";
import type { Logger } from "@clawde/log";
import type { AgentRunResult } from "@clawde/sdk";

const MAX_TELEGRAM_LEN = 4096;

function readBotToken(): string | null {
  const env = process.env as Record<string, string | undefined>;
  return (
    env["CLAWDE_TELEGRAM_BOT_TOKEN"] ??
    env["clawde-telegram-bot-token"] ??
    null
  );
}

export async function sendTelegramReply(
  task: Task,
  agentResult: AgentRunResult,
  logger: Logger,
): Promise<void> {
  if (task.source !== "telegram") return;

  const token = readBotToken();
  if (token === null) {
    logger.warn("telegram reply skipped: no bot token", { taskId: task.id });
    return;
  }

  const chatId = task.sourceMetadata["chat_id"];
  if (typeof chatId !== "number") {
    logger.warn("telegram reply skipped: no chat_id in metadata", { taskId: task.id });
    return;
  }

  const text = agentResult.finalText.trim();
  if (text.length === 0) {
    logger.warn("telegram reply skipped: empty result", { taskId: task.id });
    return;
  }

  const truncated =
    text.length > MAX_TELEGRAM_LEN ? text.slice(0, MAX_TELEGRAM_LEN - 3) + "..." : text;

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: truncated }),
    });
    if (!response.ok) {
      const body = await response.text();
      logger.warn("telegram reply failed", {
        taskId: task.id,
        status: response.status,
        body,
      });
    } else {
      logger.info("telegram reply sent", { taskId: task.id, chat_id: chatId });
    }
  } catch (err) {
    logger.warn("telegram reply error", {
      taskId: task.id,
      error: (err as Error).message,
    });
  }
}