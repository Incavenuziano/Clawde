/**
 * Detecção de peak hours por timezone.
 * Default: 5–11 AM PT (America/Los_Angeles), multiplier 1.7
 * (BEST_PRACTICES + ARCHITECTURE §8.8 — comportamento Anthropic).
 */

export interface PeakHoursConfig {
  readonly timezone: string;
  readonly startLocal: string; // "HH:MM"
  readonly endLocal: string;
  readonly multiplier: number;
}

export const DEFAULT_PEAK_CONFIG: PeakHoursConfig = {
  timezone: "America/Los_Angeles",
  startLocal: "05:00",
  endLocal: "11:00",
  multiplier: 1.7,
};

function parseHHMM(s: string): { h: number; m: number } {
  const [hStr, mStr] = s.split(":");
  return {
    h: Number.parseInt(hStr ?? "0", 10),
    m: Number.parseInt(mStr ?? "0", 10),
  };
}

/**
 * Retorna { isPeak, multiplier } para timestamp atual no timezone configurado.
 */
export function checkPeakHours(
  now: Date = new Date(),
  config: PeakHoursConfig = DEFAULT_PEAK_CONFIG,
): { isPeak: boolean; multiplier: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const hourPart = parts.find((p) => p.type === "hour");
  const minutePart = parts.find((p) => p.type === "minute");
  const localHour = Number.parseInt(hourPart?.value ?? "0", 10);
  const localMinute = Number.parseInt(minutePart?.value ?? "0", 10);
  const localMinutes = localHour * 60 + localMinute;

  const start = parseHHMM(config.startLocal);
  const end = parseHHMM(config.endLocal);
  const startMin = start.h * 60 + start.m;
  const endMin = end.h * 60 + end.m;

  // Suporta janelas que não atravessam meia-noite (caso default 05–11).
  const isPeak = localMinutes >= startMin && localMinutes < endMin;
  return {
    isPeak,
    multiplier: isPeak ? config.multiplier : 1.0,
  };
}
