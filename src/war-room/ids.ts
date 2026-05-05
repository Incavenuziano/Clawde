export interface WarRoomClock {
  now(): Date;
}

export const systemWarRoomClock: WarRoomClock = {
  now: () => new Date(),
};

export function dayStamp(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

export function makeWarRoomId(date: Date, sequence: number): string {
  return `WR-${dayStamp(date)}-${String(sequence).padStart(3, "0")}`;
}

export function makeTimelineEntryId(date: Date, sequence: number): string {
  return `TL-${dayStamp(date)}-${String(sequence).padStart(6, "0")}`;
}

export function makeGateId(date: Date, sequence: number): string {
  return `GATE-${dayStamp(date)}-${String(sequence).padStart(4, "0")}`;
}

export function makeCommandId(date: Date, sequence: number): string {
  return `CMD-${dayStamp(date)}-${String(sequence).padStart(4, "0")}`;
}
