import { describe, expect, test } from "bun:test";
import { fakeSystemdController } from "@clawde/cli/commands/panic";

describe("cli/commands/panic fakeSystemdController", () => {
  test("stop registra call e marca unit como inativa", async () => {
    const sd = fakeSystemdController();
    sd.setActive("clawde-receiver", true);
    expect(await sd.isActive("clawde-receiver")).toBe(true);

    const r = await sd.stop("clawde-receiver");
    expect(r.ok).toBe(true);
    expect(await sd.isActive("clawde-receiver")).toBe(false);
    expect(sd.calls.map((c) => `${c.op}:${c.unit}`)).toEqual([
      "isActive:clawde-receiver",
      "stop:clawde-receiver",
      "isActive:clawde-receiver",
    ]);
  });

  test("start marca unit como ativa", async () => {
    const sd = fakeSystemdController();
    expect(await sd.isActive("clawde-worker")).toBe(false);
    const r = await sd.start("clawde-worker");
    expect(r.ok).toBe(true);
    expect(await sd.isActive("clawde-worker")).toBe(true);
  });

  test("failOn faz operação retornar ok:false com detail opcional", async () => {
    const sd = fakeSystemdController();
    sd.failOn("stop", "clawde-receiver", "Failed: unit not found.");
    const r = await sd.stop("clawde-receiver");
    expect(r.ok).toBe(false);
    expect(r.detail).toBe("Failed: unit not found.");
  });

  test("failOn sem detail retorna ok:false sem detail", async () => {
    const sd = fakeSystemdController();
    sd.failOn("start", "clawde-receiver");
    const r = await sd.start("clawde-receiver");
    expect(r.ok).toBe(false);
    expect(r.detail).toBeUndefined();
  });

  test("isActive default = false pra unit não setada", async () => {
    const sd = fakeSystemdController();
    expect(await sd.isActive("never-set")).toBe(false);
  });

  test("calls acumula em ordem cronológica", async () => {
    const sd = fakeSystemdController();
    await sd.start("a.service");
    await sd.stop("a.service");
    await sd.isActive("a.service");
    expect(sd.calls).toEqual([
      { op: "start", unit: "a.service" },
      { op: "stop", unit: "a.service" },
      { op: "isActive", unit: "a.service" },
    ]);
  });
});
