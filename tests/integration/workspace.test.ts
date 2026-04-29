import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceError, createWorkspace, listWorktrees, removeWorkspace } from "@clawde/worker";

function initRepo(dir: string): void {
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  // Desliga gpg signing local (test envs podem ter signing global obrigatório).
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  execFileSync("git", ["config", "tag.gpgsign", "false"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "test repo\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "initial"], {
    cwd: dir,
  });
}

describe("worker/workspace integration", () => {
  let repoRoot: string;
  let tmpRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "clawde-ws-repo-"));
    tmpRoot = mkdtempSync(join(tmpdir(), "clawde-ws-tmp-"));
    initRepo(repoRoot);
  });
  afterEach(() => {
    // Cleanup worktrees pendentes antes de remover dirs.
    try {
      execFileSync("git", ["worktree", "prune"], { cwd: repoRoot });
    } catch {
      // ignore
    }
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("createWorkspace cria worktree com branch derivada", async () => {
    const ws = await createWorkspace({
      taskRunId: 42,
      taskId: 7,
      slug: "add-cool-feature",
      baseBranch: "main",
      repoRoot,
      tmpRoot,
    });
    expect(ws.path).toBe(join(tmpRoot, "clawde-42"));
    expect(ws.featureBranch).toBe("clawde/7-add-cool-feature");
    expect(existsSync(ws.path)).toBe(true);
    expect(existsSync(join(ws.path, "README.md"))).toBe(true);
  });

  test("slug é sanitizado (espaços, caracteres especiais)", async () => {
    const ws = await createWorkspace({
      taskRunId: 1,
      taskId: 5,
      slug: "Fix Bug! Em Português",
      baseBranch: "main",
      repoRoot,
      tmpRoot,
    });
    expect(ws.featureBranch).toBe("clawde/5-fix-bug-em-portugu-s");
  });

  test("slug vazio cai para 'task'", async () => {
    const ws = await createWorkspace({
      taskRunId: 2,
      taskId: 9,
      slug: "***",
      baseBranch: "main",
      repoRoot,
      tmpRoot,
    });
    expect(ws.featureBranch).toBe("clawde/9-task");
  });

  test("path existente lança WorkspaceError", async () => {
    await createWorkspace({
      taskRunId: 1,
      taskId: 1,
      slug: "x",
      baseBranch: "main",
      repoRoot,
      tmpRoot,
    });
    await expect(
      createWorkspace({
        taskRunId: 1,
        taskId: 1,
        slug: "x",
        baseBranch: "main",
        repoRoot,
        tmpRoot,
      }),
    ).rejects.toThrow(WorkspaceError);
  });

  test("removeWorkspace limpa diretório", async () => {
    const ws = await createWorkspace({
      taskRunId: 50,
      taskId: 1,
      slug: "x",
      baseBranch: "main",
      repoRoot,
      tmpRoot,
    });
    await removeWorkspace(ws, repoRoot);
    expect(existsSync(ws.path)).toBe(false);
  });

  test("listWorktrees inclui worktree criado", async () => {
    const ws = await createWorkspace({
      taskRunId: 99,
      taskId: 2,
      slug: "y",
      baseBranch: "main",
      repoRoot,
      tmpRoot,
    });
    const list = await listWorktrees(repoRoot);
    expect(list).toContain(ws.path);
    // Repo principal também aparece.
    expect(list.length).toBeGreaterThanOrEqual(2);
  });
});
