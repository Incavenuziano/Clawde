import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClawdeConfig } from "@clawde/config/schema";
import type { Alert, AlertChannel } from "./types.ts";

function readCredential(name: string, env: Record<string, string | undefined>): string | null {
  const credDir = env.CREDENTIALS_DIRECTORY;
  if (credDir !== undefined && credDir.length > 0) {
    try {
      const v = readFileSync(join(credDir, name), "utf-8").trim();
      if (v.length > 0) return v;
    } catch {
      // fallback pro env
    }
  }
  const candidates = [name, name.toUpperCase().replace(/[^A-Z0-9]/g, "_")];
  for (const key of candidates) {
    const v = env[key];
    if (v !== undefined && v.length > 0) return v;
  }
  return null;
}

function renderMessage(alert: Alert): string {
  return `[${alert.severity.toUpperCase()}][${alert.trigger}] ${JSON.stringify(alert.payload)}`;
}

export class TelegramAlertChannel implements AlertChannel {
  constructor(
    private readonly token: string,
    private readonly chatId: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(alert: Alert): Promise<void> {
    const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.chatId,
        text: renderMessage(alert),
        disable_web_page_preview: true,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`telegram alert failed: HTTP ${response.status} ${body}`);
    }
  }
}

export function createTelegramAlertChannelFromConfig(
  config: ClawdeConfig,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): AlertChannel | null {
  const tg = config.telegram;
  if (tg === undefined) return null;
  const tokenCredential = tg.bot_token_credential;
  const chatCredential = tg.alert_chat_id_credential;
  if (tokenCredential === undefined || chatCredential === undefined) return null;

  const token = readCredential(tokenCredential, env);
  const chatId = readCredential(chatCredential, env);
  if (token === null || chatId === null) return null;
  return new TelegramAlertChannel(token, chatId);
}
