import type { CommandRunner } from "./command-runner.ts";
import { BunCommandRunner } from "./command-runner.ts";
import type { WarRoomVerification } from "./domain.ts";

export interface VerifyWarRoomOptions {
  readonly cwd: string;
  readonly dbPath: string;
  readonly ci?: boolean;
  readonly smoke?: boolean;
  readonly diagnose?: boolean;
  readonly runner?: CommandRunner;
  readonly now?: Date;
}

const CI_COMMANDS: ReadonlyArray<{ name: string; argv: ReadonlyArray<string> }> = [
  { name: "typecheck", argv: ["bun", "run", "typecheck"] },
  { name: "lint", argv: ["bun", "run", "lint"] },
  { name: "test", argv: ["bun", "test"] },
];

export async function verifyWarRoom(options: VerifyWarRoomOptions): Promise<WarRoomVerification> {
  const runner = options.runner ?? new BunCommandRunner();
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

  const commands = [
    ...(options.ci === true ? CI_COMMANDS : []),
    ...(options.smoke === true
      ? [
          {
            name: "smoke-test",
            argv: ["bun", "run", "src/cli/main.ts", "smoke-test", "--db", options.dbPath],
          },
        ]
      : []),
    ...(options.diagnose === true
      ? [
          {
            name: "diagnose-all",
            argv: ["bun", "run", "src/cli/main.ts", "diagnose", "all", "--db", options.dbPath],
          },
        ]
      : []),
  ];

  for (const command of commands) {
    const result = await runner.run({ argv: command.argv, cwd: options.cwd, timeoutMs: 180_000 });
    checks.push({
      name: command.name,
      ok: result.exitCode === 0 && !result.timedOut,
      detail: `exit=${result.exitCode} timed_out=${result.timedOut}`,
    });
  }

  if (checks.length === 0) {
    checks.push({ name: "noop", ok: true, detail: "no verification flags selected" });
  }

  return {
    ts: (options.now ?? new Date()).toISOString(),
    ok: checks.every((check) => check.ok),
    checks,
  };
}
