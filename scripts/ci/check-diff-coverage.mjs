import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const MIN_COVERAGE = Number(process.env.MIN_DIFF_COVERAGE ?? "80");
const BASE_SHA = process.env.BASE_SHA;
const HEAD_SHA = process.env.HEAD_SHA;
const LCOV_PATH = process.env.LCOV_PATH ?? "coverage/lcov.info";
const REPORT_PATH = process.env.DIFF_COVERAGE_REPORT ?? "coverage/diff-coverage.md";

if (!BASE_SHA || !HEAD_SHA) {
  console.error("Missing BASE_SHA or HEAD_SHA env vars.");
  process.exit(2);
}

function parseLcov(content) {
  const coverageByFile = new Map();
  const records = content.split("end_of_record");

  for (const record of records) {
    const lines = record.trim().split("\n").map((line) => line.trim());
    if (lines.length === 0 || lines[0] === "") {
      continue;
    }

    let currentFile = "";
    const lineHits = new Map();

    for (const line of lines) {
      if (line.startsWith("SF:")) {
        currentFile = normalizePath(line.slice(3));
        continue;
      }

      if (!line.startsWith("DA:")) {
        continue;
      }

      const [, lineNumberStr, hitsStr] = line.match(/^DA:(\d+),(\d+)/) ?? [];
      if (!lineNumberStr || !hitsStr) {
        continue;
      }

      const lineNumber = Number(lineNumberStr);
      const hits = Number(hitsStr);
      lineHits.set(lineNumber, hits > 0);
    }

    if (currentFile) {
      coverageByFile.set(currentFile, lineHits);
    }
  }

  return coverageByFile;
}

function normalizePath(path) {
  return path.replace(/\\/g, "/").replace(`${process.cwd().replace(/\\/g, "/")}/`, "");
}

function parseAddedLinesFromDiff(baseSha, headSha) {
  const diff = spawnSync(
    "git",
    ["diff", "--unified=0", `${baseSha}...${headSha}`, "--", "src", "tests"],
    { encoding: "utf8" },
  );

  if (diff.status !== 0) {
    console.error(diff.stderr);
    process.exit(diff.status ?? 1);
  }

  const addedByFile = new Map();
  const lines = diff.stdout.split("\n");
  let currentFile = "";
  let newLine = 0;
  let inHunk = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith("+++ b/")) {
      currentFile = line.slice("+++ b/".length);
      if (!addedByFile.has(currentFile)) {
        addedByFile.set(currentFile, new Set());
      }
      inHunk = false;
      continue;
    }

    if (line.startsWith("@@")) {
      const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (!match) {
        inHunk = false;
        continue;
      }
      newLine = Number(match[1]);
      inHunk = true;
      continue;
    }

    if (!inHunk || !currentFile) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      addedByFile.get(currentFile)?.add(newLine);
      newLine += 1;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      continue;
    }

    if (line.startsWith(" ")) {
      newLine += 1;
    }
  }

  return addedByFile;
}

function computeDiffCoverage(coverageByFile, addedByFile) {
  const files = [];
  let totalCoverable = 0;
  let totalCovered = 0;

  for (const [file, addedLines] of addedByFile.entries()) {
    const lineHits = coverageByFile.get(file) ?? new Map();
    let coverable = 0;
    let covered = 0;

    for (const lineNumber of addedLines) {
      const hasCoverageData = lineHits.has(lineNumber);
      if (!hasCoverageData) {
        continue;
      }

      coverable += 1;
      if (lineHits.get(lineNumber)) {
        covered += 1;
      }
    }

    totalCoverable += coverable;
    totalCovered += covered;
    const percent = coverable === 0 ? null : (covered / coverable) * 100;
    files.push({ file, coverable, covered, percent });
  }

  const totalPercent = totalCoverable === 0 ? null : (totalCovered / totalCoverable) * 100;
  return { files, totalCoverable, totalCovered, totalPercent };
}

function buildReport(result) {
  const lines = [];
  lines.push("<!-- clawde-diff-coverage -->");
  lines.push(`## Diff Coverage Report (threshold: ${MIN_COVERAGE.toFixed(0)}%)`);
  lines.push("");

  if (result.files.length === 0) {
    lines.push("No changed lines detected under `src/` or `tests/`.");
    return lines.join("\n");
  }

  if (result.totalCoverable === 0) {
    lines.push("No coverable changed lines detected (all changed lines are non-instrumented).");
    return lines.join("\n");
  }

  lines.push("| File | Covered | Coverable | Diff Coverage |");
  lines.push("|---|---:|---:|---:|");
  for (const file of result.files) {
    const pct = file.percent === null ? "n/a" : `${file.percent.toFixed(2)}%`;
    lines.push(`| \`${file.file}\` | ${file.covered} | ${file.coverable} | ${pct} |`);
  }

  lines.push("");
  lines.push(
    `Overall: **${result.totalCovered}/${result.totalCoverable}** = **${result.totalPercent?.toFixed(2) ?? "n/a"}%**`,
  );

  return lines.join("\n");
}

const lcovContent = readFileSync(LCOV_PATH, "utf8");
const coverageByFile = parseLcov(lcovContent);
const addedByFile = parseAddedLinesFromDiff(BASE_SHA, HEAD_SHA);
const result = computeDiffCoverage(coverageByFile, addedByFile);
const report = buildReport(result);
writeFileSync(REPORT_PATH, `${report}\n`, "utf8");

if (result.totalCoverable > 0 && (result.totalPercent ?? 0) < MIN_COVERAGE) {
  console.error(
    `Diff coverage ${result.totalPercent?.toFixed(2)}% is below required ${MIN_COVERAGE.toFixed(0)}%.`,
  );
  process.exit(1);
}
