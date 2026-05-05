import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import type { WarRoomCommand, WarRoomPlan, WarRoomWave } from "./domain.ts";
import { classifyCommand } from "./gates.ts";
import {
  extractChecklistItems,
  extractMarkdownTables,
  stripMarkdownFormatting,
} from "./markdown.ts";

export interface BuildPlanOptions {
  readonly sourcePath: string;
  readonly now?: Date;
}

const DEFAULT_VERIFICATION_COMMANDS: ReadonlyArray<ReadonlyArray<string>> = [
  ["bun", "run", "typecheck"],
  ["bun", "run", "lint"],
  ["bun", "test"],
];

function command(id: string, argv: ReadonlyArray<string>, description?: string): WarRoomCommand {
  return {
    id,
    argv,
    lane: classifyCommand(argv),
    ...(description !== undefined ? { description } : {}),
    timeoutMs: 120_000,
  };
}

function inferCommandsFromText(text: string): ReadonlyArray<WarRoomCommand> {
  const commands: WarRoomCommand[] = [];
  const commandPatterns: Array<{ pattern: RegExp; argv: ReadonlyArray<string>; desc: string }> = [
    { pattern: /\bbun run typecheck\b/, argv: ["bun", "run", "typecheck"], desc: "typecheck" },
    { pattern: /\bbun run lint\b/, argv: ["bun", "run", "lint"], desc: "lint" },
    { pattern: /\bbun test\b/, argv: ["bun", "test"], desc: "test suite" },
    {
      pattern: /\bbun run build:worker\b/,
      argv: ["bun", "run", "build:worker"],
      desc: "worker build",
    },
    {
      pattern: /\bclawde diagnose all\b/,
      argv: ["clawde", "diagnose", "all"],
      desc: "diagnose all",
    },
    { pattern: /\bclawde smoke-test\b/, argv: ["clawde", "smoke-test"], desc: "smoke-test" },
  ];
  for (const item of commandPatterns) {
    if (item.pattern.test(text)) {
      commands.push(command(`cmd-${commands.length + 1}`, item.argv, item.desc));
    }
  }
  for (const line of text.split(/\r?\n/)) {
    const clean = line.trim().replace(/^\$\s*/, "");
    if (!/^(bun|clawde|git|gh|systemctl)\b/.test(clean)) continue;
    const argv = clean.split(/\s+/);
    const key = argv.join(" ");
    if (commands.some((existing) => existing.argv.join(" ") === key)) continue;
    commands.push(command(`cmd-${commands.length + 1}`, argv, clean));
  }
  if (commands.length === 0) {
    DEFAULT_VERIFICATION_COMMANDS.forEach((argv, index) => {
      commands.push(command(`cmd-${index + 1}`, argv, argv.join(" ")));
    });
  }
  return commands;
}

function inferFilesFromTables(markdown: string): ReadonlyArray<string> {
  const files = new Set<string>();
  for (const table of extractMarkdownTables(markdown)) {
    for (const row of table.rows) {
      for (const [key, value] of Object.entries(row)) {
        if (!/file|arquivo|target/i.test(key)) continue;
        for (const part of value.split(/[,;]/)) {
          const clean = stripMarkdownFormatting(part);
          if (clean.includes("/") || clean.includes(".")) files.add(clean);
        }
      }
    }
  }
  return [...files].sort();
}

function buildChecklistWave(markdown: string, sourcePath: string): WarRoomWave {
  const checklist = extractChecklistItems(markdown);
  const pending = checklist.filter((item) => !item.checked).slice(0, 20);
  const checks = pending.length > 0 ? pending.map((item) => item.text) : [`review ${sourcePath}`];
  return {
    id: "wave-1",
    title: `Execute ${basename(sourcePath)}`,
    commands: inferCommandsFromText(markdown),
    checks,
    files: inferFilesFromTables(markdown),
  };
}

export function buildWarRoomPlan(options: BuildPlanOptions): WarRoomPlan {
  if (!existsSync(options.sourcePath)) {
    throw new Error(`plan source not found: ${options.sourcePath}`);
  }
  const markdown = readFileSync(options.sourcePath, "utf-8");
  const wave = buildChecklistWave(markdown, options.sourcePath);
  const notes = [
    "Generated automatically from Markdown. Review dry-run output before executing.",
    "Guarded commands require explicit gate approval.",
  ];
  return {
    sourcePath: options.sourcePath,
    createdAt: (options.now ?? new Date()).toISOString(),
    waves: [wave],
    notes,
  };
}
