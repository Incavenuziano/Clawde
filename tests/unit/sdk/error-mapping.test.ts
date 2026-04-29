import { describe, expect, test } from "bun:test";
import { SdkAuthError, SdkNetworkError, SdkRateLimitError, mapSdkError } from "@clawde/sdk";

describe("sdk/client mapSdkError", () => {
  test("401/unauthorized mapeia para SdkAuthError", () => {
    const mapped = mapSdkError(new Error("HTTP 401 unauthorized"));
    expect(mapped).toBeInstanceOf(SdkAuthError);
  });

  test("429/rate_limit/quota mapeia para SdkRateLimitError", () => {
    const mapped = mapSdkError(new Error("rate_limit exceeded (429 quota)"));
    expect(mapped).toBeInstanceOf(SdkRateLimitError);
    expect((mapped as SdkRateLimitError).retryAfterSeconds).toBeNull();
  });

  test("falhas de rede mapeiam para SdkNetworkError", () => {
    const mapped = mapSdkError(new Error("connect ECONNREFUSED 127.0.0.1:443"));
    expect(mapped).toBeInstanceOf(SdkNetworkError);
  });

  test("mensagens desconhecidas propagam erro base", () => {
    const original = new Error("something unexpected");
    const mapped = mapSdkError(original);
    expect(mapped).toBe(original);
  });
});
