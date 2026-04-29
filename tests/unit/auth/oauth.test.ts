import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OAuthLoadError,
  getTokenExpiry,
  loadOAuthToken,
  needsRenewal,
  parseJwtPayload,
} from "@clawde/auth";

function makeJwt(payload: Record<string, unknown>, prefix = "sk-ant-oat01-"): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = Buffer.from("fake").toString("base64url");
  return `${prefix}${header}.${body}.${sig}`;
}

describe("auth/oauth loadOAuthToken", () => {
  test("carrega de systemd-credential quando CREDENTIALS_DIRECTORY presente", () => {
    const dir = mkdtempSync(join(tmpdir(), "clawde-creds-"));
    try {
      writeFileSync(join(dir, "clawde-oauth"), "sk-ant-oat01-fake.payload.sig\n");
      const tok = loadOAuthToken({
        env: { CREDENTIALS_DIRECTORY: dir },
      });
      expect(tok.source).toBe("systemd-credential");
      expect(tok.value).toBe("sk-ant-oat01-fake.payload.sig");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("respeita credentialName custom", () => {
    const dir = mkdtempSync(join(tmpdir(), "clawde-creds-"));
    try {
      writeFileSync(join(dir, "my-token"), "abc");
      const tok = loadOAuthToken({
        env: { CREDENTIALS_DIRECTORY: dir },
        credentialName: "my-token",
      });
      expect(tok.value).toBe("abc");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("cai pra env CLAUDE_CODE_OAUTH_TOKEN se systemd-credential ausente", () => {
    const tok = loadOAuthToken({
      env: { CLAUDE_CODE_OAUTH_TOKEN: "from-env-token" },
    });
    expect(tok.source).toBe("env");
    expect(tok.value).toBe("from-env-token");
  });

  test("ordem: systemd-credential ganha sobre env quando ambas presentes", () => {
    const dir = mkdtempSync(join(tmpdir(), "clawde-creds-"));
    try {
      writeFileSync(join(dir, "clawde-oauth"), "from-cred");
      const tok = loadOAuthToken({
        env: {
          CREDENTIALS_DIRECTORY: dir,
          CLAUDE_CODE_OAUTH_TOKEN: "from-env",
        },
      });
      expect(tok.source).toBe("systemd-credential");
      expect(tok.value).toBe("from-cred");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("respeita ordem custom de sources", () => {
    const dir = mkdtempSync(join(tmpdir(), "clawde-creds-"));
    try {
      writeFileSync(join(dir, "clawde-oauth"), "from-cred");
      const tok = loadOAuthToken({
        sources: ["env", "systemd-credential"],
        env: {
          CREDENTIALS_DIRECTORY: dir,
          CLAUDE_CODE_OAUTH_TOKEN: "from-env",
        },
      });
      expect(tok.source).toBe("env");
      expect(tok.value).toBe("from-env");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("env vazio ou ausente é tratado como miss", () => {
    expect(() =>
      loadOAuthToken({
        env: { CLAUDE_CODE_OAUTH_TOKEN: "" },
      }),
    ).toThrow(OAuthLoadError);
  });

  test("OAuthLoadError lista sources tentadas", () => {
    try {
      loadOAuthToken({ env: {} });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(OAuthLoadError);
      const e = err as OAuthLoadError;
      expect(e.attemptedSources).toContain("systemd-credential");
      expect(e.attemptedSources).toContain("env");
    }
  });

  test("file inexistente em CREDENTIALS_DIRECTORY não é fatal — passa pra próxima source", () => {
    const dir = mkdtempSync(join(tmpdir(), "clawde-creds-empty-"));
    try {
      const tok = loadOAuthToken({
        env: {
          CREDENTIALS_DIRECTORY: dir,
          CLAUDE_CODE_OAUTH_TOKEN: "fallback-token",
        },
      });
      expect(tok.source).toBe("env");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("auth/oauth parseJwtPayload", () => {
  test("decodifica payload válido com prefix Anthropic", () => {
    const tok = makeJwt({ exp: 1234567890, sub: "user-123" });
    const payload = parseJwtPayload(tok);
    expect(payload).not.toBeNull();
    expect(payload?.exp).toBe(1234567890);
    expect(payload?.sub).toBe("user-123");
  });

  test("decodifica payload sem prefix Anthropic (JWT puro)", () => {
    const tok = makeJwt({ foo: "bar" }, "");
    const payload = parseJwtPayload(tok);
    expect(payload?.foo).toBe("bar");
  });

  test("retorna null pra string que não é JWT (sem 3 partes)", () => {
    expect(parseJwtPayload("nao-eh-jwt")).toBeNull();
    expect(parseJwtPayload("a.b")).toBeNull();
    expect(parseJwtPayload("a.b.c.d")).toBeNull();
  });

  test("retorna null pra payload que não é JSON válido", () => {
    expect(parseJwtPayload("sk-ant-oat01-aaa.@@@invalido@@@.sig")).toBeNull();
  });

  test("retorna null pra payload vazio", () => {
    expect(parseJwtPayload("aaa..ccc")).toBeNull();
  });

  test("payload com base64url unpadded decodifica corretamente", () => {
    const payload = { exp: 9999999999, claim: "value-with-padding-issues" };
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const trimmed = body.replace(/=+$/, "");
    const tok = `aaa.${trimmed}.sig`;
    const decoded = parseJwtPayload(tok);
    expect(decoded?.exp).toBe(9999999999);
  });
});

describe("auth/oauth getTokenExpiry", () => {
  test("retorna campos populados pra JWT válido com exp", () => {
    const futureExp = Math.floor(Date.now() / 1000) + 60 * 86400;
    const tok = makeJwt({ exp: futureExp });
    const now = new Date();
    const result = getTokenExpiry(tok, now);
    expect(result.exp).toBe(futureExp);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.daysUntilExpiry).not.toBeNull();
    if (result.daysUntilExpiry !== null) {
      expect(result.daysUntilExpiry).toBeGreaterThan(59);
      expect(result.daysUntilExpiry).toBeLessThan(61);
    }
  });

  test("daysUntilExpiry negativo se expirado", () => {
    const pastExp = Math.floor(Date.now() / 1000) - 86400; // ontem
    const tok = makeJwt({ exp: pastExp });
    const result = getTokenExpiry(tok);
    expect(result.daysUntilExpiry).not.toBeNull();
    if (result.daysUntilExpiry !== null) {
      expect(result.daysUntilExpiry).toBeLessThan(0);
    }
  });

  test("retorna nulls pra token sem formato JWT", () => {
    const result = getTokenExpiry("token-opaco-sem-formato");
    expect(result.exp).toBeNull();
    expect(result.expiresAt).toBeNull();
    expect(result.daysUntilExpiry).toBeNull();
  });

  test("retorna nulls pra JWT sem campo exp", () => {
    const tok = makeJwt({ sub: "no-exp" });
    const result = getTokenExpiry(tok);
    expect(result.exp).toBeNull();
  });

  test("retorna nulls se exp não é número (defesa contra payload malformado)", () => {
    const tok = makeJwt({ exp: "not-a-number" });
    const result = getTokenExpiry(tok);
    expect(result.exp).toBeNull();
  });
});

describe("auth/oauth needsRenewal", () => {
  test("true se daysUntilExpiry < threshold default (30d)", () => {
    const exp = Math.floor(Date.now() / 1000) + 10 * 86400; // 10 dias
    const tok = makeJwt({ exp });
    expect(needsRenewal(tok)).toBe(true);
  });

  test("false se daysUntilExpiry > threshold", () => {
    const exp = Math.floor(Date.now() / 1000) + 60 * 86400; // 60 dias
    const tok = makeJwt({ exp });
    expect(needsRenewal(tok)).toBe(false);
  });

  test("respeita thresholdDays custom", () => {
    const exp = Math.floor(Date.now() / 1000) + 45 * 86400; // 45 dias
    const tok = makeJwt({ exp });
    expect(needsRenewal(tok, 30)).toBe(false);
    expect(needsRenewal(tok, 60)).toBe(true);
  });

  test("false (conservador) se token não é JWT", () => {
    expect(needsRenewal("opaco-sem-jwt")).toBe(false);
  });

  test("true se já expirou", () => {
    const exp = Math.floor(Date.now() / 1000) - 86400;
    const tok = makeJwt({ exp });
    expect(needsRenewal(tok)).toBe(true);
  });
});
