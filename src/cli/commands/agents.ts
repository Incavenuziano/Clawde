import { join } from "node:path";
import { AgentDefinitionError, loadAllAgentDefinitions } from "@clawde/agents";
import { loadConfig } from "@clawde/config";
import { type OutputFormat, emit, emitErr } from "../output.ts";

export interface RunAgentsOptions {
  readonly format: OutputFormat;
}

interface AgentListItem {
  readonly name: string;
  readonly model: string;
  readonly sandboxLevel: number;
  readonly allowedToolsCount: number;
}

export function runAgents(options: RunAgentsOptions): number {
  try {
    const config = loadConfig();
    const root = join(config.clawde.home, "agents");
    const defs = loadAllAgentDefinitions(root);
    const items: AgentListItem[] = defs.map((d) => ({
      name: d.name,
      model: d.frontmatter.model,
      sandboxLevel: d.frontmatter.sandboxLevel,
      allowedToolsCount: d.frontmatter.allowedTools.length,
    }));
    emit(options.format, { agents: items }, (raw) => {
      const rows = (raw as { agents: ReadonlyArray<AgentListItem> }).agents;
      if (rows.length === 0) return "(no agents)";
      return rows
        .map(
          (a) =>
            `${a.name}\tmodel=${a.model}\tsandbox=${a.sandboxLevel}\tallowed_tools=${a.allowedToolsCount}`,
        )
        .join("\n");
    });
    return 0;
  } catch (err) {
    const msg =
      err instanceof AgentDefinitionError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    emitErr(`agents list failed: ${msg}`);
    return 2;
  }
}
