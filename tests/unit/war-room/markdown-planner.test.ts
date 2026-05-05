import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWarRoomPlan } from "@clawde/war-room";
import { extractChecklistItems, extractMarkdownTables } from "@clawde/war-room/markdown";

describe("war-room markdown parser + planner", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clawde-war-room-plan-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("extrai checklist e tabelas markdown", () => {
    const md = `
- [ ] first
- [x] done

| ID | Files |
|---|---|
| A | src/foo.ts, tests/foo.test.ts |
`;
    expect(extractChecklistItems(md)).toEqual([
      { checked: false, text: "first" },
      { checked: true, text: "done" },
    ]);
    expect(extractMarkdownTables(md)[0]?.rows[0]?.Files).toContain("src/foo.ts");
  });

  test("gera plano com wave e comandos inferidos", () => {
    const planPath = join(dir, "PLAN.md");
    writeFileSync(
      planPath,
      `
# Plan

- [ ] run checks

\`\`\`bash
bun run typecheck
bun run lint
bun test
\`\`\`
`,
    );
    const plan = buildWarRoomPlan({ sourcePath: planPath, now: new Date("2026-05-05T00:00:00Z") });
    expect(plan.waves).toHaveLength(1);
    expect(plan.waves[0]?.commands.map((cmd) => cmd.argv.join(" "))).toContain("bun run typecheck");
  });
});
