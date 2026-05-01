import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { loadConfig } from "@clawde/config";
import { createEmailAlertChannelFromConfig } from "./email.ts";
import { createTelegramAlertChannelFromConfig } from "./telegram.ts";
import type { Alert, AlertChannel, DispatchResult } from "./types.ts";

export type { Alert, AlertChannel, AlertSeverity, DispatchResult } from "./types.ts";

const DEFAULT_COOLDOWN_MS = 60 * 60 * 1000;

export interface DispatcherOptions {
  readonly stateDir?: string;
  readonly defaultCooldownMs?: number;
  readonly now?: () => Date;
}

function expandHome(path: string): string {
  if (path === "~" || path.startsWith("~/")) {
    return path.replace(/^~/, homedir());
  }
  return path;
}

function resolveStateDir(
  stateDir: string | undefined,
  env: Record<string, string | undefined>,
): string {
  if (stateDir !== undefined && stateDir.length > 0) return stateDir;
  const home = env.CLAWDE_HOME;
  if (home !== undefined && home.length > 0) {
    return join(expandHome(home), "state", "alerts");
  }
  return join(homedir(), ".clawde", "state", "alerts");
}

function lockFilePath(stateDir: string, cooldownKey: string): string {
  const safe = cooldownKey.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(stateDir, `${safe}.lock`);
}

function withinCooldown(path: string, nowMs: number, cooldownMs: number): boolean {
  if (!existsSync(path)) return false;
  try {
    const raw = readFileSync(path, "utf-8").trim();
    const ts = Number.parseInt(raw, 10);
    if (!Number.isFinite(ts)) return false;
    return nowMs - ts < cooldownMs;
  } catch {
    return false;
  }
}

function markSent(path: string, nowMs: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, String(nowMs), "utf-8");
}

export async function dispatchAlert(
  alert: Alert,
  channels: ReadonlyArray<AlertChannel>,
  options: DispatcherOptions = {},
): Promise<DispatchResult> {
  if (channels.length === 0) {
    return { sent: false, skippedByCooldown: false, channelErrors: [] };
  }

  const env = process.env as Record<string, string | undefined>;
  const stateDir = resolveStateDir(options.stateDir, env);
  mkdirSync(stateDir, { recursive: true });

  const now = options.now ?? (() => new Date());
  const nowMs = now().getTime();
  const cooldownMs = alert.cooldownMs ?? options.defaultCooldownMs ?? DEFAULT_COOLDOWN_MS;
  const lockPath = lockFilePath(stateDir, alert.cooldownKey);
  if (withinCooldown(lockPath, nowMs, cooldownMs)) {
    return { sent: false, skippedByCooldown: true, channelErrors: [] };
  }

  const errors: string[] = [];
  let sentCount = 0;
  for (const channel of channels) {
    try {
      await channel.send(alert);
      sentCount += 1;
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  if (sentCount > 0) {
    markSent(lockPath, nowMs);
  }
  return {
    sent: sentCount > 0,
    skippedByCooldown: false,
    channelErrors: errors,
  };
}

let cachedChannels: ReadonlyArray<AlertChannel> | null = null;
let cachedStateDir: string | null = null;

function defaultChannelsFromConfig(): ReadonlyArray<AlertChannel> {
  if (cachedChannels !== null) return cachedChannels;
  try {
    const config = loadConfig();
    cachedChannels = [
      createTelegramAlertChannelFromConfig(config),
      createEmailAlertChannelFromConfig(config),
    ].filter((c): c is AlertChannel => c !== null);
    cachedStateDir = join(expandHome(config.clawde.home), "state", "alerts");
    return cachedChannels;
  } catch {
    cachedChannels = [];
    cachedStateDir = null;
    return cachedChannels;
  }
}

export function resetAlertRuntimeForTests(): void {
  cachedChannels = null;
  cachedStateDir = null;
}

export async function sendAlertBestEffort(alert: Alert): Promise<void> {
  try {
    const channels = defaultChannelsFromConfig();
    await dispatchAlert(alert, channels, {
      ...(cachedStateDir !== null ? { stateDir: cachedStateDir } : {}),
    });
  } catch {
    // Alerting não pode derrubar fluxo principal.
  }
}
