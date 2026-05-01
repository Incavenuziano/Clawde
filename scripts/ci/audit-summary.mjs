import { readFileSync, writeFileSync } from "node:fs";

function usage() {
  console.error("Usage: node scripts/ci/audit-summary.mjs <audit-json> <summary-md>");
}

function parseAudit(payload) {
  const data = JSON.parse(payload);
  const findings = [];

  for (const [pkgName, advisories] of Object.entries(data)) {
    if (!Array.isArray(advisories)) {
      continue;
    }

    for (const advisory of advisories) {
      findings.push({
        packageName: pkgName,
        severity: String(advisory.severity ?? "unknown").toLowerCase(),
        id: advisory.id ?? "n/a",
        title: advisory.title ?? "Untitled advisory",
        url: advisory.url ?? "",
        vulnerableVersions: advisory.vulnerable_versions ?? "n/a",
      });
    }
  }

  return findings;
}

function severityCounts(findings) {
  const counts = { low: 0, moderate: 0, high: 0, critical: 0, unknown: 0 };

  for (const finding of findings) {
    if (finding.severity in counts) {
      counts[finding.severity] += 1;
    } else {
      counts.unknown += 1;
    }
  }

  return counts;
}

function buildSummary(counts, findings) {
  const lines = [];
  lines.push("<!-- clawde-bun-audit -->");
  lines.push("## Security Audit (`bun audit`)");
  lines.push("");
  lines.push(`- low: **${counts.low}**`);
  lines.push(`- moderate: **${counts.moderate}**`);
  lines.push(`- high: **${counts.high}**`);
  lines.push(`- critical: **${counts.critical}**`);
  lines.push(`- unknown: **${counts.unknown}**`);
  lines.push("");

  if (findings.length === 0) {
    lines.push("No vulnerabilities reported.");
    return lines.join("\n");
  }

  lines.push("| Severity | Package | ID | Vulnerable Versions | Advisory |");
  lines.push("|---|---|---|---|---|");

  for (const finding of findings) {
    const advisory = finding.url ? `[${finding.title}](${finding.url})` : finding.title;
    lines.push(
      `| ${finding.severity} | \`${finding.packageName}\` | ${finding.id} | \`${finding.vulnerableVersions}\` | ${advisory} |`,
    );
  }

  return lines.join("\n");
}

const [, , auditFile, summaryFile] = process.argv;
if (!auditFile || !summaryFile) {
  usage();
  process.exit(2);
}

const payload = readFileSync(auditFile, "utf8");
const findings = parseAudit(payload);
const counts = severityCounts(findings);
const summary = buildSummary(counts, findings);

writeFileSync(summaryFile, `${summary}\n`, "utf8");

const blockingFindings = counts.high + counts.critical;
if (blockingFindings > 0) {
  process.exit(1);
}
