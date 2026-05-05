export interface CommandRunInput {
  readonly argv: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly timeoutMs?: number;
}

export interface CommandRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly durationMs: number;
}

export interface CommandRunner {
  run(input: CommandRunInput): Promise<CommandRunResult>;
}

export class BunCommandRunner implements CommandRunner {
  async run(input: CommandRunInput): Promise<CommandRunResult> {
    if (input.argv.length === 0) {
      throw new Error("command argv cannot be empty");
    }
    const started = Date.now();
    const spawnOptions = {
      stdout: "pipe" as const,
      stderr: "pipe" as const,
      ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
      ...(input.env !== undefined ? { env: input.env } : {}),
    };
    const proc = Bun.spawn([...input.argv], spawnOptions);

    let timedOut = false;
    const timer =
      input.timeoutMs !== undefined && input.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            proc.kill();
          }, input.timeoutMs)
        : null;

    try {
      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      return {
        exitCode,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - started,
      };
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }
}

export class FakeCommandRunner implements CommandRunner {
  readonly calls: CommandRunInput[] = [];
  private readonly queue: CommandRunResult[] = [];

  enqueue(result: Partial<CommandRunResult>): void {
    this.queue.push({
      exitCode: result.exitCode ?? 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      timedOut: result.timedOut ?? false,
      durationMs: result.durationMs ?? 0,
    });
  }

  async run(input: CommandRunInput): Promise<CommandRunResult> {
    this.calls.push(input);
    return (
      this.queue.shift() ?? {
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        durationMs: 0,
      }
    );
  }
}
