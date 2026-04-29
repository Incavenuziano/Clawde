/**
 * Pipeline de hooks. Resolve handler registrado, aplica timeout, captura erros.
 *
 * Política de timeout:
 *   - on_timeout="block" → output {ok:false, block:true, message:"hook timeout"}
 *   - on_timeout="allow" → output {ok:false, block:false, message:"hook timeout"}
 * BLUEPRINT §4.5 (fail-safe default = block para UserPromptSubmit; allow para
 * PreToolUse/PostToolUse/Stop).
 */

import type { HookHandler, HookInput, HookName, HookOutput } from "./types.ts";

export type OnTimeout = "block" | "allow";

export interface HookConfig {
  readonly enabled: boolean;
  readonly timeoutMs: number;
  readonly onTimeout: OnTimeout;
}

const DEFAULT_HOOK_CONFIG: Record<HookName, HookConfig> = {
  SessionStart:     { enabled: true, timeoutMs: 1000, onTimeout: "allow" },
  UserPromptSubmit: { enabled: true, timeoutMs: 500,  onTimeout: "block" },
  PreToolUse:       { enabled: true, timeoutMs: 200,  onTimeout: "allow" },
  PostToolUse:      { enabled: true, timeoutMs: 2000, onTimeout: "allow" },
  Stop:             { enabled: true, timeoutMs: 5000, onTimeout: "allow" },
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | "__TIMEOUT__"> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve("__TIMEOUT__"), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export class HookPipeline {
  private readonly handlers = new Map<HookName, HookHandler<HookInput>>();
  private readonly configs = new Map<HookName, HookConfig>();

  constructor(configs: Partial<Record<HookName, HookConfig>> = {}) {
    for (const name of Object.keys(DEFAULT_HOOK_CONFIG) as HookName[]) {
      this.configs.set(name, configs[name] ?? DEFAULT_HOOK_CONFIG[name]);
    }
  }

  register<I extends HookInput>(name: HookName, handler: HookHandler<I>): void {
    this.handlers.set(name, handler as HookHandler<HookInput>);
  }

  configFor(name: HookName): HookConfig {
    return this.configs.get(name) ?? DEFAULT_HOOK_CONFIG[name];
  }

  async run(input: HookInput): Promise<HookOutput> {
    const config = this.configFor(input.hook);
    if (!config.enabled) {
      return { ok: true };
    }
    const handler = this.handlers.get(input.hook);
    if (handler === undefined) {
      return { ok: true };
    }
    try {
      const result = await withTimeout(Promise.resolve(handler(input)), config.timeoutMs);
      if (result === "__TIMEOUT__") {
        return {
          ok: false,
          block: config.onTimeout === "block",
          message: `hook ${input.hook} timeout (${config.timeoutMs}ms)`,
        };
      }
      return result;
    } catch (err) {
      return {
        ok: false,
        block: false,
        message: `hook ${input.hook} error: ${(err as Error).message}`,
      };
    }
  }
}
