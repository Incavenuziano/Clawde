/**
 * Workspace ephemeral via git worktree (ARCHITECTURE §9.9, ADR 0007).
 *
 * Cada task_run opera em /tmp/clawde-<id> isolado, criando branch
 * clawde/<task_id>-<slug>. Cleanup remove worktree ao final.
 *
 * Reusa execFile (não exec) — não passa por shell, mais seguro.
 */

import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import type { Task } from "@clawde/domain/task";
import type { Workspace } from "@clawde/domain/workspace";

const exec = promisify(execFile);

export interface CreateWorkspaceInput {
  readonly taskRunId: number;
  readonly taskId: number;
  readonly slug: string;
  readonly baseBranch: string;
  readonly repoRoot: string;
  readonly tmpRoot?: string; // override pra testes
}

export interface AgentDefinitionLike {
  readonly frontmatter?: {
    readonly requiresWorkspace?: boolean;
  };
}

function workspacePath(taskRunId: number, tmpRoot = "/tmp"): string {
  return `${tmpRoot}/clawde-${taskRunId}`;
}

function featureBranch(taskId: number, slug: string): string {
  // sanitize slug: só [a-zA-Z0-9-_]
  const safe = slug
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `clawde/${taskId}-${safe || "task"}`;
}

export class WorkspaceError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "WorkspaceError";
    if (cause !== undefined) this.cause = cause;
  }
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
  const path = workspacePath(input.taskRunId, input.tmpRoot);
  const branch = featureBranch(input.taskId, input.slug);

  if (existsSync(path)) {
    throw new WorkspaceError(`workspace path already exists: ${path}`);
  }

  try {
    // Cria branch nova e worktree em path. -b cria a branch a partir de baseBranch.
    await exec("git", ["worktree", "add", "-b", branch, path, input.baseBranch], {
      cwd: input.repoRoot,
    });
  } catch (err) {
    throw new WorkspaceError(`git worktree add failed: ${(err as Error).message}`, err);
  }

  return {
    path,
    baseBranch: input.baseBranch,
    featureBranch: branch,
    taskRunId: input.taskRunId,
    createdAt: new Date().toISOString(),
  };
}

export async function removeWorkspace(workspace: Workspace, repoRoot: string): Promise<void> {
  try {
    await exec("git", ["worktree", "remove", "--force", workspace.path], { cwd: repoRoot });
  } catch (err) {
    throw new WorkspaceError(`git worktree remove failed: ${(err as Error).message}`, err);
  }
}

/**
 * Lista worktrees ativas. Útil para reconcile (detectar órfãs).
 */
export async function listWorktrees(repoRoot: string): Promise<ReadonlyArray<string>> {
  const { stdout } = await exec("git", ["worktree", "list", "--porcelain"], {
    cwd: repoRoot,
  });
  const paths: string[] = [];
  for (const line of stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      paths.push(line.slice("worktree ".length).trim());
    }
  }
  return paths;
}

export function shouldUseEphemeralWorkspace(
  _task: Task,
  agentDef: AgentDefinitionLike | null,
): boolean {
  return agentDef?.frontmatter?.requiresWorkspace ?? false;
}

export function cleanupOrphanWorkspaceSync(
  repoRoot: string,
  taskRunId: number,
  tmpRoot?: string,
): boolean {
  const path = workspacePath(taskRunId, tmpRoot);
  if (!existsSync(path)) return false;
  execFileSync("git", ["worktree", "remove", "--force", path], { cwd: repoRoot });
  return true;
}

export { workspacePath as _workspacePathForTests, featureBranch as _featureBranchForTests };
