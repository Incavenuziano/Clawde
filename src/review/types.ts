/**
 * F9 — Two-stage review pipeline (ADR 0004 — extraído de
 * superpowers/skills/subagent-driven-development).
 *
 * Cada task passa por:
 *   1. implementer       → gera output (code/diff/answer)
 *   2. spec-reviewer     → verifica conformidade com a spec da task
 *   3. code-quality-reviewer → verifica qualidade (smell, dup, sec, perf)
 *
 * Cada reviewer retorna APPROVED ou REJECTED+feedback. Em REJECTED:
 *   - implementer é re-invocado com o feedback (até maxRetriesPerStage)
 *   - se ainda falhar, pipeline para com status="failed"
 *
 * Cada stage roda em **fresh context** (sem herdar histórico de outras
 * stages) — mantém reviewers imparciais.
 */

export const REVIEW_ROLES = ["implementer", "spec-reviewer", "code-quality-reviewer"] as const;
export type ReviewRole = (typeof REVIEW_ROLES)[number];

export const REVIEW_VERDICTS = ["APPROVED", "REJECTED"] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export interface StageInvocation {
  readonly role: ReviewRole;
  /** prompt operacional (task spec + envelope com output anterior). */
  readonly prompt: string;
  /** system prompt canônico do role (de prompts.ts). */
  readonly systemPrompt: string;
}

export interface StageResult {
  readonly role: ReviewRole;
  readonly attemptN: number;
  /** texto bruto retornado pelo subagent (output ou verdict report). */
  readonly output: string;
  /** apenas para reviewers: parsed APPROVED/REJECTED. */
  readonly verdict?: ReviewVerdict;
  /** apenas para REJECTED: comentário do reviewer pra implementer iterar. */
  readonly feedback?: string;
}

export interface PipelineConfig {
  readonly maxRetriesPerStage?: number; // default 2
  /** Lista de stages a rodar. Default: todas as 3. */
  readonly stages?: ReadonlyArray<ReviewRole>;
}

export interface PipelineResult {
  readonly status: "approved" | "rejected" | "exhausted_retries";
  readonly stages: ReadonlyArray<StageResult>;
  /** Output final do implementer (último accepted). */
  readonly finalOutput: string | null;
  readonly totalRoundsRun: number;
}

/**
 * Runner injetável: invoca um subagent (typicamente Claude Code via SDK).
 * Recebe role + prompts; retorna texto bruto. Hooks externos (sandbox,
 * memory, quota) são responsabilidade do runner.
 */
export type StageRunner = (invocation: StageInvocation) => Promise<string>;

export interface PipelineDeps {
  readonly runner: StageRunner;
  /** Hook opcional pra logar/persistir cada stage. */
  readonly onStage?: (result: StageResult) => void | Promise<void>;
}
