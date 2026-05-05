import type { WarRoomStore } from "../store.ts";

export interface EvidenceCollectorContext {
  readonly roomId: string;
  readonly store: WarRoomStore;
  readonly cwd: string;
  readonly dbPath: string;
}

export interface EvidenceCollectionResult {
  readonly name: string;
  readonly status: "ok" | "warn" | "error";
  readonly path?: string;
  readonly detail?: string;
}

export interface EvidenceCollector {
  readonly name: string;
  collect(context: EvidenceCollectorContext): Promise<EvidenceCollectionResult>;
}
