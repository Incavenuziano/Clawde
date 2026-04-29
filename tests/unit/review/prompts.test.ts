import { describe, expect, test } from "bun:test";
import {
  CODE_QUALITY_REVIEWER_SYSTEM_PROMPT,
  IMPLEMENTER_SYSTEM_PROMPT,
  ROLE_SYSTEM_PROMPTS,
  SPEC_REVIEWER_SYSTEM_PROMPT,
  buildRetryPrompt,
  buildReviewerPrompt,
} from "@clawde/review";

describe("review/prompts canonical content", () => {
  test("ROLE_SYSTEM_PROMPTS mapeia todos os roles", () => {
    expect(ROLE_SYSTEM_PROMPTS.implementer).toBe(IMPLEMENTER_SYSTEM_PROMPT);
    expect(ROLE_SYSTEM_PROMPTS["spec-reviewer"]).toBe(SPEC_REVIEWER_SYSTEM_PROMPT);
    expect(ROLE_SYSTEM_PROMPTS["code-quality-reviewer"]).toBe(CODE_QUALITY_REVIEWER_SYSTEM_PROMPT);
  });

  test("reviewers exigem token VERDICT explicitamente no prompt", () => {
    expect(SPEC_REVIEWER_SYSTEM_PROMPT).toContain("VERDICT: APPROVED");
    expect(SPEC_REVIEWER_SYSTEM_PROMPT).toContain("VERDICT: REJECTED");
    expect(CODE_QUALITY_REVIEWER_SYSTEM_PROMPT).toContain("VERDICT: APPROVED");
    expect(CODE_QUALITY_REVIEWER_SYSTEM_PROMPT).toContain("VERDICT: REJECTED");
  });

  test("implementer prompt não menciona VERDICT (não é seu papel)", () => {
    expect(IMPLEMENTER_SYSTEM_PROMPT).not.toContain("VERDICT:");
  });

  test("spec-reviewer instrui foco em spec, não em estilo", () => {
    expect(SPEC_REVIEWER_SYSTEM_PROMPT.toLowerCase()).toContain("spec");
    expect(SPEC_REVIEWER_SYSTEM_PROMPT.toLowerCase()).toMatch(/not.*style|style.*not/);
  });

  test("code-quality instrui não rejudgar spec correctness", () => {
    expect(CODE_QUALITY_REVIEWER_SYSTEM_PROMPT.toLowerCase()).toMatch(
      /assume.*approved|already.*approved|do not.*re-judge.*spec/,
    );
  });
});

describe("review/prompts buildReviewerPrompt", () => {
  test("inclui task spec + envelope com output do implementer", () => {
    const out = buildReviewerPrompt("Adicione função sum.", "function sum(a, b) { return a + b; }");
    expect(out).toContain("Task spec");
    expect(out).toContain("Adicione função sum.");
    expect(out).toContain("Implementer output");
    expect(out).toContain("function sum");
  });

  test("envelope usa cerca de fenced code block", () => {
    const out = buildReviewerPrompt("x", "code");
    expect(out).toContain("```");
    expect((out.match(/```/g) ?? []).length).toBe(2);
  });
});

describe("review/prompts buildRetryPrompt", () => {
  test("inclui spec + feedback + previous output identificando role do reviewer", () => {
    const out = buildRetryPrompt({
      taskSpec: "Adicione função sum.",
      previousOutput: "function sum() {}",
      feedback: "- Missing parameters",
      fromRole: "spec-reviewer",
    });
    expect(out).toContain("Adicione função sum.");
    expect(out).toContain("Missing parameters");
    expect(out).toContain("function sum() {}");
    expect(out).toContain("from spec-reviewer");
  });
});
