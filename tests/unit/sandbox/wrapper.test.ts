import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeSandboxedClaudeWrapper, resolveClaudeNativeBinary } from "@clawde/sandbox";

describe("sandbox/wrapper", () => {
  test("resolveClaudeNativeBinary prefere SDK binary no projectRoot", () => {
    const rootPath = mkdtempSync(join(tmpdir(), "clawde-wrapper-root-"));
    const homePath = mkdtempSync(join(tmpdir(), "clawde-wrapper-home-"));
    mkdirSync(join(rootPath, "node_modules/@anthropic-ai/claude-agent-sdk-linux-x64"), {
      recursive: true,
    });
    mkdirSync(join(homePath, ".clawde/bin"), { recursive: true });
    writeFileSync(
      join(rootPath, "node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude"),
      "",
    );
    writeFileSync(join(homePath, ".clawde/bin/claude"), "");

    try {
      const resolved = resolveClaudeNativeBinary(rootPath, homePath);
      expect(resolved).toBe(
        join(rootPath, "node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude"),
      );
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
      rmSync(homePath, { recursive: true, force: true });
    }
  });

  test("resolveClaudeNativeBinary usa ~/.clawde/bin/claude quando SDK não existe", () => {
    const rootPath = mkdtempSync(join(tmpdir(), "clawde-wrapper-root-"));
    const homePath = mkdtempSync(join(tmpdir(), "clawde-wrapper-home-"));
    mkdirSync(join(homePath, ".clawde/bin"), { recursive: true });
    writeFileSync(join(homePath, ".clawde/bin/claude"), "");

    try {
      const resolved = resolveClaudeNativeBinary(rootPath, homePath);
      expect(resolved).toBe(join(homePath, ".clawde/bin/claude"));
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
      rmSync(homePath, { recursive: true, force: true });
    }
  });

  test("resolveClaudeNativeBinary cai para /usr/local/bin/claude quando nada existe", () => {
    const rootPath = mkdtempSync(join(tmpdir(), "clawde-wrapper-root-"));
    const homePath = mkdtempSync(join(tmpdir(), "clawde-wrapper-home-"));
    try {
      const resolved = resolveClaudeNativeBinary(rootPath, homePath);
      expect(resolved).toBe("/usr/local/bin/claude");
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
      rmSync(homePath, { recursive: true, force: true });
    }
  });

  test("makeSandboxedClaudeWrapper respeita claudeBinaryOverride", () => {
    const wrapper = makeSandboxedClaudeWrapper(
      "agent-test",
      [],
      {},
      "/opt/custom/claude",
      process.cwd(),
    );
    try {
      const script = readFileSync(wrapper.wrapperPath, "utf-8");
      expect(script).toContain("/opt/custom/claude");
      expect(existsSync(wrapper.wrapperPath)).toBeTrue();
    } finally {
      wrapper.cleanup();
    }
  });
});
