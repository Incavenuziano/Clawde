export type AlertSeverity = "critical" | "high" | "medium" | "low";

export interface Alert {
  readonly severity: AlertSeverity;
  readonly trigger: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly cooldownKey: string;
  /** Cooldown opcional por alerta; default do dispatcher = 1h. */
  readonly cooldownMs?: number;
}

export interface AlertChannel {
  send(alert: Alert): Promise<void>;
}

export interface DispatchResult {
  readonly sent: boolean;
  readonly skippedByCooldown: boolean;
  readonly channelErrors: ReadonlyArray<string>;
}
