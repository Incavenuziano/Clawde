import { readFileSync } from "node:fs";
import { type Socket, connect as netConnect } from "node:net";
import { join } from "node:path";
import { connect as tlsConnect } from "node:tls";
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

function renderSubject(alert: Alert): string {
  return `[clawde][${alert.severity.toUpperCase()}] ${alert.trigger}`;
}

function renderBody(alert: Alert): string {
  return [
    `severity: ${alert.severity}`,
    `trigger: ${alert.trigger}`,
    `cooldown_key: ${alert.cooldownKey}`,
    "",
    JSON.stringify(alert.payload, null, 2),
    "",
  ].join("\n");
}

async function readSmtpResponse(socket: Socket): Promise<string> {
  return await new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk: Buffer): void => {
      buf += chunk.toString("utf-8");
      if (buf.includes("\r\n")) {
        cleanup();
        resolve(buf);
      }
    };
    const onErr = (err: Error): void => {
      cleanup();
      reject(err);
    };
    const cleanup = (): void => {
      socket.off("data", onData);
      socket.off("error", onErr);
    };
    socket.on("data", onData);
    socket.on("error", onErr);
  });
}

async function smtpCommand(socket: Socket, command: string, expectPrefix: string): Promise<void> {
  socket.write(`${command}\r\n`);
  const line = await readSmtpResponse(socket);
  if (!line.startsWith(expectPrefix)) {
    throw new Error(`SMTP expected ${expectPrefix} for '${command}', got: ${line.trim()}`);
  }
}

async function upgradeToStartTls(socket: Socket, host: string): Promise<Socket> {
  return await new Promise((resolve, reject) => {
    const tls = tlsConnect({ socket, servername: host }, () => resolve(tls));
    tls.once("error", reject);
  });
}

export interface EmailAlertConfig {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
  readonly from: string;
  readonly to: string;
}

export class EmailAlertChannel implements AlertChannel {
  constructor(
    private readonly cfg: EmailAlertConfig,
    private readonly connectImpl: typeof netConnect = netConnect,
  ) {}

  async send(alert: Alert): Promise<void> {
    const socket = this.connectImpl(this.cfg.port, this.cfg.host);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("error", reject);
    });
    try {
      const greeting = await readSmtpResponse(socket);
      if (!greeting.startsWith("220")) {
        throw new Error(`SMTP greeting invalid: ${greeting.trim()}`);
      }

      await smtpCommand(socket, "EHLO clawde", "250");
      await smtpCommand(socket, "STARTTLS", "220");
      const tlsSocket = await upgradeToStartTls(socket, this.cfg.host);
      await smtpCommand(tlsSocket, "EHLO clawde", "250");
      await smtpCommand(tlsSocket, "AUTH LOGIN", "334");
      await smtpCommand(tlsSocket, Buffer.from(this.cfg.username).toString("base64"), "334");
      await smtpCommand(tlsSocket, Buffer.from(this.cfg.password).toString("base64"), "235");

      await smtpCommand(tlsSocket, `MAIL FROM:<${this.cfg.from}>`, "250");
      await smtpCommand(tlsSocket, `RCPT TO:<${this.cfg.to}>`, "250");
      await smtpCommand(tlsSocket, "DATA", "354");

      const body = renderBody(alert).replace(/\n/g, "\r\n");
      const data = [
        `From: ${this.cfg.from}`,
        `To: ${this.cfg.to}`,
        `Subject: ${renderSubject(alert)}`,
        "MIME-Version: 1.0",
        'Content-Type: multipart/alternative; boundary="clawde-boundary"',
        "",
        "--clawde-boundary",
        'Content-Type: text/plain; charset="utf-8"',
        "",
        body,
        "--clawde-boundary--",
        ".",
      ].join("\r\n");
      tlsSocket.write(`${data}\r\n`);
      const accepted = await readSmtpResponse(tlsSocket);
      if (!accepted.startsWith("250")) {
        throw new Error(`SMTP DATA failed: ${accepted.trim()}`);
      }
      await smtpCommand(tlsSocket, "QUIT", "221");
      tlsSocket.end();
    } catch (err) {
      socket.destroy();
      throw err;
    }
  }
}

export function createEmailAlertChannelFromConfig(
  config: ClawdeConfig,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): AlertChannel | null {
  const c = config.alerts?.email;
  if (c === undefined) return null;
  const username = readCredential(c.smtp_username_credential, env);
  const password = readCredential(c.smtp_password_credential, env);
  if (username === null || password === null) return null;
  return new EmailAlertChannel({
    host: c.smtp_host,
    port: c.smtp_port,
    username,
    password,
    from: c.from,
    to: c.to,
  });
}
