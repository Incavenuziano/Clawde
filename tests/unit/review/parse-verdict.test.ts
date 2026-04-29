import { describe, expect, test } from "bun:test";
import { parseVerdict } from "@clawde/review";

describe("review/parse-verdict", () => {
  test("APPROVED simples", () => {
    const r = parseVerdict("VERDICT: APPROVED");
    expect(r?.verdict).toBe("APPROVED");
    expect(r?.feedback).toBe("");
  });

  test("REJECTED com feedback acima", () => {
    const out = `Some issues:
- missing edge case for empty array
- variable name 'x' is unclear

VERDICT: REJECTED`;
    const r = parseVerdict(out);
    expect(r?.verdict).toBe("REJECTED");
    expect(r?.feedback).toContain("missing edge case");
    expect(r?.feedback).toContain("variable name");
    // Trailing whitespace removido:
    expect(r?.feedback.endsWith("\n")).toBe(false);
  });

  test("ignora exemplos no preâmbulo: pega último VERDICT real", () => {
    const out = `Reminder example: VERDICT: APPROVED would mean OK, REJECTED would mean fix.

Issues:
- foo

VERDICT: REJECTED`;
    const r = parseVerdict(out);
    expect(r?.verdict).toBe("REJECTED");
  });

  test("retorna null se não há verdict", () => {
    expect(parseVerdict("just some thoughts, no verdict line")).toBeNull();
  });

  test("retorna null se verdict mal-formado (ex: VERDICT: MAYBE)", () => {
    expect(parseVerdict("VERDICT: MAYBE")).toBeNull();
  });

  test("aceita whitespace antes/depois do verdict", () => {
    expect(parseVerdict("VERDICT:    APPROVED   ")?.verdict).toBe("APPROVED");
  });

  test("case-insensitive no token VERDICT", () => {
    expect(parseVerdict("verdict: approved")?.verdict).toBe("APPROVED");
  });

  test("verdict no meio do texto não conta — só linha própria", () => {
    expect(parseVerdict("Some prose with VERDICT: APPROVED inline.")).toBeNull();
  });
});
