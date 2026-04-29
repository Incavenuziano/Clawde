/**
 * Defaults explícitos. zod já provê via `.default()`, mas expor aqui dá pra
 * referenciar em testes / docs sem precisar inferir do parse.
 */

import { type ClawdeConfig, ClawdeConfigSchema } from "./schema.ts";

export const DEFAULT_CONFIG: ClawdeConfig = ClawdeConfigSchema.parse({});
