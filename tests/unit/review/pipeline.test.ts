import { describe, expect, test } from "bun:test";
import {
  PipelineError,
  type StageInvocation,
  type StageResult,
  type StageRunner,
  runReviewPipeline,
} from "@clawde/review";

interface ScriptedResponse {
  readonly role: StageInvocation["role"];
  readonly output: string;
}

function scriptedRunner(script: ReadonlyArray<ScriptedResponse>): {
  runner: StageRunner;
  calls: StageInvocation[];
} {
  const calls: StageInvocation[] = [];
  let i = 0;
  const runner: StageRunner = async (inv) => {
    calls.push(inv);
    const next = script[i++];
    if (next === undefined) {
      throw new Error(`scripted runner exhausted at call ${i}, role=${inv.role}`);
    }
    if (next.role !== inv.role) {
      throw new Error(`scripted runner mismatch: expected role=${next.role}, got role=${inv.role}`);
    }
    return next.output;
  };
  return { runner, calls };
}

describe("review/pipeline runReviewPipeline", () => {
  test("happy path: implementer ok + ambos reviewers APPROVED", async () => {
    const { runner, calls } = scriptedRunner([
      { role: "implementer", output: "function sum(a,b){return a+b}" },
      { role: "spec-reviewer", output: "VERDICT: APPROVED" },
      { role: "code-quality-reviewer", output: "VERDICT: APPROVED" },
    ]);
    const result = await runReviewPipeline("Adicione sum(a,b)", {}, { runner });
    expect(result.status).toBe("approved");
    expect(result.stages.length).toBe(3);
    expect(result.totalRoundsRun).toBe(1);
    expect(result.finalOutput).toBe("function sum(a,b){return a+b}");
    expect(calls.map((c) => c.role)).toEqual([
      "implementer",
      "spec-reviewer",
      "code-quality-reviewer",
    ]);
  });

  test("spec-reviewer REJECTED → retry implementer com feedback → APPROVED", async () => {
    const { runner, calls } = scriptedRunner([
      { role: "implementer", output: "function sum(){}" },
      {
        role: "spec-reviewer",
        output: "Missing parameters.\n\nVERDICT: REJECTED",
      },
      { role: "implementer", output: "function sum(a,b){return a+b}" },
      { role: "spec-reviewer", output: "VERDICT: APPROVED" },
      { role: "code-quality-reviewer", output: "VERDICT: APPROVED" },
    ]);
    const result = await runReviewPipeline("Add sum(a,b)", {}, { runner });
    expect(result.status).toBe("approved");
    expect(result.totalRoundsRun).toBe(2);

    // 2º implementer call deve ter recebido feedback no prompt:
    const secondImpl = calls[2];
    expect(secondImpl?.role).toBe("implementer");
    expect(secondImpl?.prompt).toContain("Missing parameters");
    expect(secondImpl?.prompt).toContain("from spec-reviewer");
  });

  test("quality-reviewer REJECTED após spec APPROVED → retry todo", async () => {
    const { runner } = scriptedRunner([
      { role: "implementer", output: "v1" },
      { role: "spec-reviewer", output: "VERDICT: APPROVED" },
      {
        role: "code-quality-reviewer",
        output: "Variable names too short.\n\nVERDICT: REJECTED",
      },
      { role: "implementer", output: "v2" },
      { role: "spec-reviewer", output: "VERDICT: APPROVED" },
      { role: "code-quality-reviewer", output: "VERDICT: APPROVED" },
    ]);
    const result = await runReviewPipeline("...", {}, { runner });
    expect(result.status).toBe("approved");
    expect(result.totalRoundsRun).toBe(2);
    expect(result.finalOutput).toBe("v2");
  });

  test("excede maxRetriesPerStage → status='exhausted_retries'", async () => {
    const { runner } = scriptedRunner([
      { role: "implementer", output: "v1" },
      { role: "spec-reviewer", output: "fail.\nVERDICT: REJECTED" },
      { role: "implementer", output: "v2" },
      { role: "spec-reviewer", output: "fail.\nVERDICT: REJECTED" },
      { role: "implementer", output: "v3" },
      { role: "spec-reviewer", output: "fail.\nVERDICT: REJECTED" },
    ]);
    const result = await runReviewPipeline("...", { maxRetriesPerStage: 2 }, { runner });
    expect(result.status).toBe("exhausted_retries");
    expect(result.totalRoundsRun).toBe(3);
    expect(result.finalOutput).toBe("v3");
  });

  test("reviewer sem VERDICT line → lança PipelineError", async () => {
    const { runner } = scriptedRunner([
      { role: "implementer", output: "v1" },
      { role: "spec-reviewer", output: "great work" }, // sem VERDICT
    ]);
    await expect(runReviewPipeline("...", {}, { runner })).rejects.toThrow(PipelineError);
  });

  test("respeita config.stages custom (apenas spec, sem quality)", async () => {
    const { runner, calls } = scriptedRunner([
      { role: "implementer", output: "v1" },
      { role: "spec-reviewer", output: "VERDICT: APPROVED" },
    ]);
    const result = await runReviewPipeline(
      "...",
      { stages: ["implementer", "spec-reviewer"] },
      { runner },
    );
    expect(result.status).toBe("approved");
    expect(calls.length).toBe(2);
    expect(calls[1]?.role).toBe("spec-reviewer");
  });

  test("config.stages sem implementer → throw", async () => {
    const { runner } = scriptedRunner([]);
    await expect(
      runReviewPipeline("...", { stages: ["spec-reviewer"] }, { runner }),
    ).rejects.toThrow(PipelineError);
  });

  test("onStage hook invocado pra cada stage", async () => {
    const { runner } = scriptedRunner([
      { role: "implementer", output: "v1" },
      { role: "spec-reviewer", output: "VERDICT: APPROVED" },
      { role: "code-quality-reviewer", output: "VERDICT: APPROVED" },
    ]);
    const observed: StageResult[] = [];
    await runReviewPipeline(
      "...",
      {},
      {
        runner,
        onStage: (s) => {
          observed.push(s);
        },
      },
    );
    expect(observed.length).toBe(3);
    expect(observed.map((s) => s.role)).toEqual([
      "implementer",
      "spec-reviewer",
      "code-quality-reviewer",
    ]);
    expect(observed[1]?.verdict).toBe("APPROVED");
  });

  test("system prompts injetados no invocation correspondem ao role", async () => {
    const { runner, calls } = scriptedRunner([
      { role: "implementer", output: "v1" },
      { role: "spec-reviewer", output: "VERDICT: APPROVED" },
      { role: "code-quality-reviewer", output: "VERDICT: APPROVED" },
    ]);
    await runReviewPipeline("spec", {}, { runner });
    expect(calls[0]?.systemPrompt).toContain("IMPLEMENTER");
    expect(calls[1]?.systemPrompt).toContain("SPEC REVIEWER");
    expect(calls[2]?.systemPrompt).toContain("CODE QUALITY REVIEWER");
  });

  test("feedback do reviewer fica acessível em StageResult.feedback", async () => {
    const { runner } = scriptedRunner([
      { role: "implementer", output: "v1" },
      {
        role: "spec-reviewer",
        output: "- Missing return statement\n- Missing error handling\n\nVERDICT: REJECTED",
      },
      { role: "implementer", output: "v2" },
      { role: "spec-reviewer", output: "VERDICT: APPROVED" },
      { role: "code-quality-reviewer", output: "VERDICT: APPROVED" },
    ]);
    const result = await runReviewPipeline("...", {}, { runner });
    const rejection = result.stages.find(
      (s) => s.role === "spec-reviewer" && s.verdict === "REJECTED",
    );
    expect(rejection?.feedback).toContain("Missing return statement");
    expect(rejection?.feedback).toContain("Missing error handling");
  });
});
