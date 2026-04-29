import { describe, expect, test } from "bun:test";
import { extractQueryNames } from "@clawde/cli/commands/dashboard";

describe("dashboard extractQueryNames", () => {
  test("extrai nomes de queries simples", () => {
    const yaml = `
title: dash
databases:
  state:
    queries:
      tasks_pending:
        title: x
        sql: SELECT 1
      tasks_failed:
        sql: SELECT 2
`;
    expect(extractQueryNames(yaml)).toEqual(["tasks_pending", "tasks_failed"]);
  });

  test("ignora sub-keys (title, sql, description) e não as conta", () => {
    const yaml = `
queries:
  q1:
    title: hello
    description: world
    sql: |
      SELECT 1
      FROM t
  q2:
    sql: SELECT 2
`;
    expect(extractQueryNames(yaml)).toEqual(["q1", "q2"]);
  });

  test("retorna lista vazia quando não há bloco queries", () => {
    const yaml = `
title: foo
databases:
  state:
    description: nothing here
`;
    expect(extractQueryNames(yaml)).toEqual([]);
  });

  test("ignora linhas de comentário e em branco", () => {
    const yaml = `
queries:
  # primeiro
  alpha:
    sql: SELECT 1

  # segundo
  beta:
    sql: SELECT 2
`;
    expect(extractQueryNames(yaml)).toEqual(["alpha", "beta"]);
  });

  test("para de capturar quando bloco queries termina (volta pra indent menor)", () => {
    const yaml = `
databases:
  state:
    queries:
      alpha:
        sql: SELECT 1
      beta:
        sql: SELECT 2
    description: outside queries
`;
    expect(extractQueryNames(yaml)).toEqual(["alpha", "beta"]);
  });

  test("metadata.yaml real do projeto extrai todas as canned queries", () => {
    const yaml = require("node:fs").readFileSync(
      `${process.cwd()}/deploy/datasette/metadata.yaml`,
      "utf-8",
    );
    const names = extractQueryNames(yaml);
    expect(names).toContain("tasks_pending");
    expect(names).toContain("task_runs_active");
    expect(names).toContain("quota_recent_windows");
    expect(names).toContain("memory_top_importance");
    expect(names).toContain("events_kind_24h");
    expect(names.length).toBeGreaterThanOrEqual(10);
  });
});
