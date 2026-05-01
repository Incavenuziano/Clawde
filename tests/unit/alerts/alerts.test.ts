import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchAlert } from "@clawde/alerts";
import { createEmailAlertChannelFromConfig } from "@clawde/alerts/email";
import {
  TelegramAlertChannel,
  createTelegramAlertChannelFromConfig,
} from "@clawde/alerts/telegram";
import type { Alert, AlertChannel } from "@clawde/alerts/types";
import { type ClawdeConfig, ClawdeConfigSchema } from "@clawde/config";

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    severity: "high",
    trigger: "smoke_test_fail",
    cooldownKey: "smoke_test_fail",
    payload: { reason: "test" },
    ...overrides,
  };
}

describe("alerts/dispatch", () => {
  let tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    tempDirs = [];
  });

  test("respeita cooldown persistido por cooldownKey", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "clawde-alerts-"));
    tempDirs.push(stateDir);

    let sends = 0;
    const channel: AlertChannel = {
      send: async () => {
        sends += 1;
      },
    };

    const now = new Date("2026-05-01T12:00:00.000Z");
    const first = await dispatchAlert(makeAlert(), [channel], {
      stateDir,
      now: () => now,
      defaultCooldownMs: 60_000,
    });
    expect(first.sent).toBe(true);
    expect(first.skippedByCooldown).toBe(false);
    expect(sends).toBe(1);

    const second = await dispatchAlert(makeAlert(), [channel], {
      stateDir,
      now: () => new Date("2026-05-01T12:00:10.000Z"),
      defaultCooldownMs: 60_000,
    });
    expect(second.sent).toBe(false);
    expect(second.skippedByCooldown).toBe(true);
    expect(sends).toBe(1);

    const third = await dispatchAlert(makeAlert(), [channel], {
      stateDir,
      now: () => new Date("2026-05-01T12:01:10.000Z"),
      defaultCooldownMs: 60_000,
    });
    expect(third.sent).toBe(true);
    expect(third.skippedByCooldown).toBe(false);
    expect(sends).toBe(2);
  });

  test("retorna erros de canais sem impedir envio nos demais", async () => {
    const ok: AlertChannel = { send: async () => {} };
    const boom: AlertChannel = {
      send: async () => {
        throw new Error("channel down");
      },
    };
    const result = await dispatchAlert(makeAlert(), [boom, ok], {
      stateDir: mkdtempSync(join(tmpdir(), "clawde-alerts-")),
    });
    expect(result.sent).toBe(true);
    expect(result.channelErrors).toHaveLength(1);
    expect(result.channelErrors[0]).toContain("channel down");
  });
});

describe("alerts/telegram", () => {
  test("envia para Telegram API no formato esperado", async () => {
    let url = "";
    let body = "";
    const fetchMock = (async (u: string | URL | Request, init?: RequestInit) => {
      url = u.toString();
      body = String(init?.body ?? "");
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const channel = new TelegramAlertChannel("token-123", "456", fetchMock);
    await channel.send(makeAlert({ severity: "critical", trigger: "fatal_log" }));
    expect(url).toBe("https://api.telegram.org/bottoken-123/sendMessage");
    expect(body).toContain('"chat_id":"456"');
    expect(body).toContain("[CRITICAL][fatal_log]");
  });

  test("createTelegramAlertChannelFromConfig retorna null sem credenciais", () => {
    const config = ClawdeConfigSchema.parse({
      telegram: { secret: "abc", allowed_user_ids: [1] },
    }) as ClawdeConfig;
    const channel = createTelegramAlertChannelFromConfig(config, {});
    expect(channel).toBeNull();
  });
});

describe("alerts/email", () => {
  test("createEmailAlertChannelFromConfig retorna null sem seção", () => {
    const config = ClawdeConfigSchema.parse({});
    expect(createEmailAlertChannelFromConfig(config, {})).toBeNull();
  });

  test("createEmailAlertChannelFromConfig cria canal com creds no env", () => {
    const config = ClawdeConfigSchema.parse({
      alerts: {
        email: {
          smtp_host: "smtp.example.com",
          smtp_port: 587,
          smtp_username_credential: "smtp-user",
          smtp_password_credential: "smtp-pass",
          from: "clawde@example.com",
          to: "ops@example.com",
        },
      },
    });
    const channel = createEmailAlertChannelFromConfig(config, {
      "SMTP-USER": "ignored",
      SMTP_USER: "user",
      SMTP_PASS: "pass",
    });
    expect(channel).not.toBeNull();
  });
});
