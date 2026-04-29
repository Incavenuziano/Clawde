import { describe, expect, test } from "bun:test";
import { LitestreamError, listSnapshots, parseSnapshots } from "@clawde/replica";

const SAMPLE_OUTPUT = `replica  generation       index  size      created
b2       fa7d2c19a8e4b1c2 42     12345678  2026-04-29T10:15:32Z
b2       fa7d2c19a8e4b1c2 41     12200000  2026-04-29T09:15:32Z
local    aa11bb22cc33dd44 7      9000000   2026-04-29T08:00:00Z
`;

describe("replica/litestream parseSnapshots", () => {
  test("parsa output tabular padrão", () => {
    const snaps = parseSnapshots(SAMPLE_OUTPUT);
    expect(snaps.length).toBe(3);
    expect(snaps[0]).toEqual({
      replica: "b2",
      generation: "fa7d2c19a8e4b1c2",
      index: 42,
      size: 12345678,
      createdAt: "2026-04-29T10:15:32Z",
    });
    expect(snaps[2]?.replica).toBe("local");
  });

  test("retorna lista vazia quando só header presente", () => {
    expect(parseSnapshots("replica generation index size created\n")).toEqual([]);
  });

  test("retorna lista vazia quando output completamente vazio", () => {
    expect(parseSnapshots("")).toEqual([]);
  });

  test("retorna lista vazia quando header não tem colunas esperadas", () => {
    expect(parseSnapshots("foo bar\nx y\n")).toEqual([]);
  });

  test("ignora linha com index/size não-numéricos (defesa)", () => {
    const bad = `replica generation index size created
b2 abc xx yy 2026-01-01T00:00:00Z
b2 def 1 100 2026-01-01T00:00:00Z
`;
    const snaps = parseSnapshots(bad);
    expect(snaps.length).toBe(1);
    expect(snaps[0]?.generation).toBe("def");
  });

  test("aceita whitespace múltiplo entre colunas", () => {
    const padded = `replica       generation         index   size       created
b2            abcd1234           5       1000       2026-01-01T00:00:00Z
`;
    const snaps = parseSnapshots(padded);
    expect(snaps.length).toBe(1);
    expect(snaps[0]?.replica).toBe("b2");
  });

  test("case-insensitive em header", () => {
    const upper = `Replica Generation Index Size Created
b2 g 1 100 2026-01-01T00:00:00Z
`;
    const snaps = parseSnapshots(upper);
    expect(snaps.length).toBe(1);
  });
});

describe("replica/litestream listSnapshots (com runner mockado)", () => {
  test("retorna parsed snapshots no happy path", async () => {
    const snaps = await listSnapshots("/path/db.sqlite", async () => ({
      stdout: SAMPLE_OUTPUT,
      stderr: "",
      exitCode: 0,
    }));
    expect(snaps.length).toBe(3);
  });

  test("lança LitestreamError em exit != 0", async () => {
    await expect(
      listSnapshots("/nope.db", async () => ({
        stdout: "",
        stderr: "no such file",
        exitCode: 1,
      })),
    ).rejects.toThrow(LitestreamError);
  });

  test("propaga stderr no error.stderr", async () => {
    try {
      await listSnapshots("/x", async () => ({
        stdout: "",
        stderr: "permission denied",
        exitCode: 2,
      }));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LitestreamError);
      expect((err as LitestreamError).stderr).toBe("permission denied");
    }
  });

  test("envolve spawn errors em LitestreamError", async () => {
    await expect(
      listSnapshots("/x", async () => {
        throw new Error("ENOENT");
      }),
    ).rejects.toThrow(/failed to spawn litestream/);
  });

  test("passa argv ['snapshots', dbPath] pro runner", async () => {
    let capturedArgs: ReadonlyArray<string> = [];
    await listSnapshots("/var/clawde/state.db", async (args) => {
      capturedArgs = args;
      return { stdout: "replica generation index size created\n", stderr: "", exitCode: 0 };
    });
    expect(capturedArgs).toEqual(["snapshots", "/var/clawde/state.db"]);
  });
});
