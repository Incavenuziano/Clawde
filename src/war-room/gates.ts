import type { ActionLane, WarRoomCommand } from "./domain.ts";

const GUARDED_PATTERNS: ReadonlyArray<RegExp> = [
  /\bpanic-stop\b/,
  /\bevents\s+purge\b/,
  /\bsystemctl\b.*\b(stop|restart|disable)\b/,
  /\bmigrate\s+(down|up)\b/,
  /\bgit\s+push\b.*\bmain\b/,
  /\brm\b.*\b(backups|state\.db|\.clawde)\b/,
];

const BLOCKED_PATTERNS: ReadonlyArray<RegExp> = [
  /\bgit\s+reset\s+--hard\b/,
  /\brm\s+-rf\s+\/($|\s)/,
  /\brm\s+-rf\s+~\/\.clawde\b/,
  /\bdd\s+if=/,
];

const YELLOW_PATTERNS: ReadonlyArray<RegExp> = [
  /\bbun\s+(test|run)\b/,
  /\bclawde\s+(smoke-test|diagnose|quota|sessions|result|logs|trace)\b/,
  /\bgh\s+(issue|pr)\s+(list|view|status|diff)\b/,
];

function commandText(argv: ReadonlyArray<string>): string {
  return argv.join(" ");
}

export function classifyCommand(argv: ReadonlyArray<string>): ActionLane {
  const text = commandText(argv);
  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(text))) return "blocked";
  if (GUARDED_PATTERNS.some((pattern) => pattern.test(text))) return "guarded";
  if (YELLOW_PATTERNS.some((pattern) => pattern.test(text))) return "yellow";
  return "green";
}

export function commandWithLane(command: WarRoomCommand): WarRoomCommand {
  return {
    ...command,
    lane: classifyCommand(command.argv),
  };
}

export function isGateExpired(expiresAt: string | undefined, now = new Date()): boolean {
  if (expiresAt === undefined) return false;
  return new Date(expiresAt).getTime() < now.getTime();
}
