/**
 * Sandbox Nível 1: gera systemd unit hardenizada (ADR 0005).
 *
 * Diretivas baseadas em BEST_PRACTICES §10.4:
 *   PrivateTmp, ProtectHome=read-only, ProtectSystem=strict,
 *   NoNewPrivileges, RestrictAddressFamilies, SystemCallFilter@system-service,
 *   ReadWritePaths=worker_dir, PrivateDevices, ProtectKernelTunables,
 *   ProtectKernelModules, LockPersonality, MemoryDenyWriteExecute.
 *
 * Score alvo de systemd-analyze security: ≤2.0.
 */

export interface ServiceUnitInput {
  readonly name: string; // ex: "clawde-worker"
  readonly description: string;
  readonly execStart: string;
  readonly user?: string;
  readonly workingDirectory?: string;
  readonly readWritePaths?: ReadonlyArray<string>;
  readonly environmentFile?: string;
  readonly type?: "simple" | "oneshot" | "forking";
  readonly after?: ReadonlyArray<string>;
}

export const HARDENING_DIRECTIVES: ReadonlyArray<string> = [
  "PrivateTmp=yes",
  "ProtectHome=read-only",
  "ProtectSystem=strict",
  "NoNewPrivileges=yes",
  "PrivateDevices=yes",
  "ProtectKernelTunables=yes",
  "ProtectKernelModules=yes",
  "ProtectControlGroups=yes",
  "LockPersonality=yes",
  "MemoryDenyWriteExecute=yes",
  "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6",
  "RestrictNamespaces=yes",
  "RestrictRealtime=yes",
  "RestrictSUIDSGID=yes",
  "SystemCallArchitectures=native",
  "SystemCallFilter=@system-service",
  "SystemCallFilter=~@privileged @resources",
  "CapabilityBoundingSet=",
  "AmbientCapabilities=",
];

/**
 * Gera o conteúdo do .service unit file.
 */
export function renderServiceUnit(input: ServiceUnitInput): string {
  const after = (input.after ?? []).join(" ");
  const lines: string[] = ["[Unit]", `Description=${input.description}`];
  if (after.length > 0) lines.push(`After=${after}`);

  lines.push("", "[Service]");
  lines.push(`Type=${input.type ?? "oneshot"}`);
  if (input.user !== undefined) lines.push(`User=${input.user}`);
  if (input.workingDirectory !== undefined) {
    lines.push(`WorkingDirectory=${input.workingDirectory}`);
  }
  if (input.environmentFile !== undefined) {
    lines.push(`EnvironmentFile=-${input.environmentFile}`);
  }
  lines.push(`ExecStart=${input.execStart}`);

  // Hardening.
  lines.push("");
  lines.push("# Hardening (ADR 0005 nivel 1, BEST_PRACTICES §10.4)");
  for (const directive of HARDENING_DIRECTIVES) {
    lines.push(directive);
  }

  if (input.readWritePaths !== undefined && input.readWritePaths.length > 0) {
    lines.push(`ReadWritePaths=${input.readWritePaths.join(" ")}`);
  }

  lines.push("");
  lines.push("[Install]");
  lines.push("WantedBy=default.target");
  lines.push("");
  return lines.join("\n");
}

export interface PathUnitInput {
  readonly name: string;
  readonly description: string;
  readonly pathChanged: string;
  readonly serviceUnit: string; // nome do .service correspondente
}

export function renderPathUnit(input: PathUnitInput): string {
  return [
    "[Unit]",
    `Description=${input.description}`,
    "",
    "[Path]",
    `PathChanged=${input.pathChanged}`,
    `Unit=${input.serviceUnit}`,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

export interface TimerUnitInput {
  readonly name: string;
  readonly description: string;
  readonly onCalendar: string;
  readonly serviceUnit: string;
  readonly persistent?: boolean;
}

export function renderTimerUnit(input: TimerUnitInput): string {
  return [
    "[Unit]",
    `Description=${input.description}`,
    "",
    "[Timer]",
    `OnCalendar=${input.onCalendar}`,
    `Unit=${input.serviceUnit}`,
    `Persistent=${input.persistent === true ? "true" : "false"}`,
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
}
