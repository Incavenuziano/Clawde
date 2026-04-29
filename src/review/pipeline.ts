/**
 * F9 — Orquestrador do pipeline de review.
 *
 * Loop:
 *   1. implementer → output
 *   2. spec-reviewer(output)
 *      REJECTED → retorna feedback pra implementer (retry)
 *      APPROVED → vai pra (3)
 *   3. code-quality-reviewer(output)
 *      REJECTED → retorna feedback pra implementer (retry)
 *      APPROVED → status="approved", retorna
 *
 * Limite de retries:
 *   - maxRetriesPerStage refere-se ao implementer (cada rejeição conta).
 *   - Default 2 retries → 3 tentativas totais do implementer.
 *   - Excedido → status="exhausted_retries".
 */

import { parseVerdict } from "./parse-verdict.ts";
import { ROLE_SYSTEM_PROMPTS, buildRetryPrompt, buildReviewerPrompt } from "./prompts.ts";
import type {
  PipelineConfig,
  PipelineDeps,
  PipelineResult,
  ReviewRole,
  StageResult,
} from "./types.ts";

const DEFAULT_STAGES: ReadonlyArray<ReviewRole> = [
  "implementer",
  "spec-reviewer",
  "code-quality-reviewer",
];

export class PipelineError extends Error {
  constructor(
    message: string,
    public readonly stages: ReadonlyArray<StageResult>,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

export async function runReviewPipeline(
  taskSpec: string,
  config: PipelineConfig,
  deps: PipelineDeps,
): Promise<PipelineResult> {
  const stages = config.stages ?? DEFAULT_STAGES;
  const maxRetries = config.maxRetriesPerStage ?? 2;

  // Stages de reviewer que rodaremos depois do implementer:
  const reviewerStages = stages.filter((r) => r !== "implementer");

  if (!stages.includes("implementer")) {
    throw new PipelineError("pipeline must include implementer stage", []);
  }

  const allStages: StageResult[] = [];
  let implementerAttempt = 0;
  let lastOutput: string | null = null;
  let pendingFeedback: { role: ReviewRole; text: string } | null = null;

  // Loop: implementer + reviewers; em REJECTED do reviewer, volta pro implementer.
  while (implementerAttempt <= maxRetries) {
    implementerAttempt += 1;

    const implementerPrompt =
      pendingFeedback === null
        ? `## Task spec\n${taskSpec}`
        : buildRetryPrompt({
            taskSpec,
            previousOutput: lastOutput ?? "(none)",
            feedback: pendingFeedback.text,
            fromRole: pendingFeedback.role,
          });

    const implOutput = await deps.runner({
      role: "implementer",
      systemPrompt: ROLE_SYSTEM_PROMPTS.implementer,
      prompt: implementerPrompt,
    });
    const implResult: StageResult = {
      role: "implementer",
      attemptN: implementerAttempt,
      output: implOutput,
    };
    allStages.push(implResult);
    if (deps.onStage !== undefined) await deps.onStage(implResult);
    lastOutput = implOutput;

    // Roda cada reviewer em sequência; primeiro REJECTED interrompe e dispara retry.
    let rejected = false;
    for (const role of reviewerStages) {
      const reviewerOutput = await deps.runner({
        role,
        systemPrompt: ROLE_SYSTEM_PROMPTS[role],
        prompt: buildReviewerPrompt(taskSpec, implOutput),
      });
      const parsed = parseVerdict(reviewerOutput);
      if (parsed === null) {
        const stage: StageResult = {
          role,
          attemptN: implementerAttempt,
          output: reviewerOutput,
        };
        allStages.push(stage);
        if (deps.onStage !== undefined) await deps.onStage(stage);
        throw new PipelineError(`reviewer ${role} produced no parseable VERDICT line`, allStages);
      }
      const stage: StageResult = {
        role,
        attemptN: implementerAttempt,
        output: reviewerOutput,
        verdict: parsed.verdict,
        ...(parsed.feedback.length > 0 && { feedback: parsed.feedback }),
      };
      allStages.push(stage);
      if (deps.onStage !== undefined) await deps.onStage(stage);

      if (parsed.verdict === "REJECTED") {
        pendingFeedback = { role, text: parsed.feedback };
        rejected = true;
        break;
      }
    }

    if (!rejected) {
      // Todos reviewers approvaram.
      return {
        status: "approved",
        stages: allStages,
        finalOutput: lastOutput,
        totalRoundsRun: implementerAttempt,
      };
    }
  }

  // Saiu do loop = excedeu retries.
  return {
    status: "exhausted_retries",
    stages: allStages,
    finalOutput: lastOutput,
    totalRoundsRun: implementerAttempt,
  };
}
