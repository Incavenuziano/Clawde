import { redact } from "@clawde/log";
import type { WarRoomStore } from "./store.ts";

function mdEscape(value: unknown): string {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function buildWarRoomReport(store: WarRoomStore, roomId: string): string {
  const room = store.getRoom(roomId);
  const timeline = store.readTimeline(roomId);
  const evidence = store.readEvidence(roomId);
  const gates = store.readGates(roomId);
  const plan = store.readPlan(roomId);
  const verification = store.readVerification(roomId);

  const lines: string[] = [];
  lines.push(`# War Room ${room.id}`);
  lines.push("");
  lines.push(`**Title:** ${room.title}`);
  lines.push(`**Kind:** ${room.kind}`);
  lines.push(`**Status:** ${room.status}`);
  lines.push(`**Created:** ${room.createdAt}`);
  if (room.closedAt !== undefined) lines.push(`**Closed:** ${room.closedAt}`);
  if (room.outcome !== undefined) lines.push(`**Outcome:** ${room.outcome}`);
  lines.push("");

  lines.push("## Verification");
  lines.push("");
  if (verification === null) {
    lines.push("No verification recorded.");
  } else {
    lines.push(`Overall: ${verification.ok ? "OK" : "FAIL"} (${verification.ts})`);
    lines.push("");
    lines.push("| Check | Result | Detail |");
    lines.push("|---|---|---|");
    for (const check of verification.checks) {
      lines.push(
        `| ${mdEscape(check.name)} | ${check.ok ? "OK" : "FAIL"} | ${mdEscape(check.detail ?? "")} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Plan");
  lines.push("");
  if (plan === null) {
    lines.push("No plan recorded.");
  } else {
    lines.push(`Source: \`${plan.sourcePath}\``);
    lines.push("");
    lines.push("| Wave | Title | Commands | Checks |");
    lines.push("|---|---|---:|---:|");
    for (const wave of plan.waves) {
      lines.push(
        `| ${mdEscape(wave.id)} | ${mdEscape(wave.title)} | ${wave.commands.length} | ${wave.checks.length} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Gates");
  lines.push("");
  if (gates.length === 0) {
    lines.push("No gates recorded.");
  } else {
    lines.push("| Gate | Status | Action | Reason |");
    lines.push("|---|---|---|---|");
    for (const gate of gates) {
      lines.push(
        `| ${mdEscape(gate.id)} | ${mdEscape(gate.status)} | ${mdEscape(gate.action)} | ${mdEscape(gate.reason)} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Evidence");
  lines.push("");
  if (evidence.length === 0) {
    lines.push("No evidence recorded.");
  } else {
    lines.push("| Name | Status | Path | Detail |");
    lines.push("|---|---|---|---|");
    for (const item of evidence) {
      lines.push(
        `| ${mdEscape(item.name)} | ${mdEscape(item.status)} | \`${mdEscape(item.path)}\` | ${mdEscape(item.detail ?? "")} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Timeline");
  lines.push("");
  lines.push("| Time | Type | Message |");
  lines.push("|---|---|---|");
  for (const entry of timeline) {
    lines.push(`| ${mdEscape(entry.ts)} | ${mdEscape(entry.type)} | ${mdEscape(entry.message)} |`);
  }
  lines.push("");

  return `${String(redact(lines.join("\n")))}\n`;
}
