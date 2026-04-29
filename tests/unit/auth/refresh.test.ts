import { describe, expect, test } from "bun:test";
import {
  RefreshError,
  invokeWithAutoRefresh,
  isAuthError,
  refreshOAuthToken,
  spawnClaudeSetupToken,
} from "@clawde/auth";

const FAKE_TOKEN = { value: "tok-original", source: "env" } as const;
const FRESH_TOKEN = { value: "tok-fresh", source: "env" } as const;

describe("auth/refresh isAuthError", () => {
  test("detecta Response com status 401", () => {
    expect(isAuthError({ status: 401 })).toBe(true);
  });

  test("detecta erro com statusCode 401", () => {
    expect(isAuthError({ statusCode: 401 })).toBe(true);
  });

  test("detecta Error com mensagem contendo 'unauthorized'", () => {
    expect(isAuthError(new Error("HTTP 401 Unauthorized"))).toBe(true);
    expect(isAuthError(new Error("UNAUTHORIZED token expired"))).toBe(true);
  });

  test("detecta string contendo '401'", () => {
    expect(isAuthError("server returned 401")).toBe(true);
  });

  test("não detecta status diferente de 401", () => {
    expect(isAuthError({ status: 500 })).toBe(false);
    expect(isAuthError({ status: 403 })).toBe(false);
  });

  test("não detecta erro de network genérico", () => {
    expect(isAuthError(new Error("ECONNREFUSED"))).toBe(false);
  });

  test("null/undefined safe", () => {
    expect(isAuthError(null)).toBe(false);
    expect(isAuthError(undefined)).toBe(false);
  });
});

describe("auth/refresh spawnClaudeSetupToken", () => {
  test("retorna exitCode != 0 quando claude binary ausente do PATH", async () => {
    // Em test env sem `claude` no PATH, esperamos resposta clean (não throw).
    const origPath = process.env.PATH;
    process.env.PATH = "/nonexistent";
    try {
      const result = await spawnClaudeSetupToken();
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("spawn failed");
    } finally {
      process.env.PATH = origPath;
    }
  });
});

describe("auth/refresh refreshOAuthToken", () => {
  test("lança se runSetupToken não fornecido (default seguro)", async () => {
    await expect(refreshOAuthToken({})).rejects.toThrow(RefreshError);
  });

  test("emite eventos start/success quando runner ok", async () => {
    const events: Array<[string, string]> = [];
    const tok = await refreshOAuthToken({
      runSetupToken: async () => ({ exitCode: 0, stderr: "" }),
      reloadToken: () => ({ value: "renewed", source: "env" }),
      onEvent: (k, d) => events.push([k, d]),
    });
    expect(tok.value).toBe("renewed");
    expect(events.map(([k]) => k)).toEqual(["refresh.start", "refresh.success"]);
  });

  test("lança RefreshError quando runner exit != 0", async () => {
    await expect(
      refreshOAuthToken({
        runSetupToken: async () => ({ exitCode: 1, stderr: "auth code invalid" }),
      }),
    ).rejects.toThrow(/setup-token failed/);
  });

  test("lança RefreshError quando reload falha", async () => {
    await expect(
      refreshOAuthToken({
        runSetupToken: async () => ({ exitCode: 0, stderr: "" }),
        reloadToken: () => {
          throw new Error("token gone after setup-token");
        },
      }),
    ).rejects.toThrow(/token reload failed/);
  });

  test("propaga erro do runner spawn", async () => {
    await expect(
      refreshOAuthToken({
        runSetupToken: async () => {
          throw new Error("spawn ENOENT");
        },
      }),
    ).rejects.toThrow(/setup-token spawn failed/);
  });
});

describe("auth/refresh invokeWithAutoRefresh", () => {
  test("retorna resultado direto se não falhar", async () => {
    const result = await invokeWithAutoRefresh(FAKE_TOKEN, async (t) => `used:${t.value}`);
    expect(result).toBe("used:tok-original");
  });

  test("não retenta em erro não-auth", async () => {
    let calls = 0;
    await expect(
      invokeWithAutoRefresh(FAKE_TOKEN, async () => {
        calls += 1;
        throw new Error("ECONNREFUSED");
      }),
    ).rejects.toThrow(/ECONNREFUSED/);
    expect(calls).toBe(1);
  });

  test("retenta UMA vez com token novo em erro 401", async () => {
    const seenTokens: string[] = [];
    let calls = 0;
    const result = await invokeWithAutoRefresh(
      FAKE_TOKEN,
      async (t) => {
        seenTokens.push(t.value);
        calls += 1;
        if (calls === 1) {
          const err = new Error("HTTP 401 Unauthorized") as Error & { status?: number };
          err.status = 401;
          throw err;
        }
        return "ok";
      },
      {
        runSetupToken: async () => ({ exitCode: 0, stderr: "" }),
        reloadToken: () => FRESH_TOKEN,
      },
    );
    expect(result).toBe("ok");
    expect(seenTokens).toEqual(["tok-original", "tok-fresh"]);
    expect(calls).toBe(2);
  });

  test("não retenta mais que UMA vez (segunda 401 propaga)", async () => {
    let calls = 0;
    await expect(
      invokeWithAutoRefresh(
        FAKE_TOKEN,
        async () => {
          calls += 1;
          throw new Error("HTTP 401 Unauthorized");
        },
        {
          runSetupToken: async () => ({ exitCode: 0, stderr: "" }),
          reloadToken: () => FRESH_TOKEN,
        },
      ),
    ).rejects.toThrow(/401/);
    expect(calls).toBe(2);
  });

  test("propaga RefreshError se refresh falhar dentro do retry", async () => {
    await expect(
      invokeWithAutoRefresh(
        FAKE_TOKEN,
        async () => {
          throw new Error("HTTP 401");
        },
        {
          runSetupToken: async () => ({ exitCode: 1, stderr: "denied" }),
        },
      ),
    ).rejects.toThrow(RefreshError);
  });

  test("emite eventos retry.attempt antes de refrescar", async () => {
    const events: string[] = [];
    let calls = 0;
    await invokeWithAutoRefresh(
      FAKE_TOKEN,
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("401 unauth");
        return "ok";
      },
      {
        runSetupToken: async () => ({ exitCode: 0, stderr: "" }),
        reloadToken: () => FRESH_TOKEN,
        onEvent: (k) => events.push(k),
      },
    );
    expect(events[0]).toBe("retry.attempt");
    expect(events).toContain("refresh.success");
  });
});
