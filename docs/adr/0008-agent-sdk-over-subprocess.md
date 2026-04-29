# ADR 0008 — Agent SDK oficial em vez de subprocess do CLI

- **Status:** Accepted
- **Date:** 2026-04-29
- **Decisores:** @Incavenuziano

## Contexto

A v3 do `ARCHITECTURE.md` invocava Claude exclusivamente via `claude -p` headless
(subprocess + parsing de stdout). Funciona, mas tem fragilidades:

- **Parsing de JSON via `jq`/regex** — schema do CLI muda entre versões e quebra
  silenciosamente.
- **Sem hooks programáticos** — `PreToolUse`/`PostToolUse` precisam de script externo
  com glue jq/bash.
- **Sem `canUseTool` gating** — bloqueio de tools fora do allowlist requer wrapper.
- **Streaming via `--output-format stream-json`** funciona, mas compor com `jq` em
  pipeline async é desconfortável.
- **Erros opacos** — exit codes + stderr; sem exceptions tipadas.
- **`--session-id`** funciona, mas capturar IDs gerados pelo CLI exige parsing.

A Anthropic mantém o **`@anthropic-ai/claude-agent-sdk`** oficial em TypeScript que
expõe a mesma funcionalidade do CLI como API tipada.

## Decisão

Usar **`@anthropic-ai/claude-agent-sdk`** como caminho **primário** de invocação:

```typescript
import { ClaudeAgent } from '@anthropic-ai/claude-agent-sdk';

const agent = new ClaudeAgent({
  sessionId: deriveSessionId({ agent, workingDir }),
  hooks: {
    onUserPromptSubmit: hooks.userPromptSubmit,
    onPreToolUse:       hooks.preToolUse,
    onPostToolUse:      hooks.postToolUse,
    onStop:             hooks.stop,
  },
  allowedTools: agentDef.allowedTools,
  maxTurns: agentDef.maxTurns,
});

for await (const msg of agent.stream({ prompt })) {
  await persistMessage(msg);
}
```

`claude -p` direto continua disponível como **fallback** para tasks triviais
(`--bare`, sem hooks, sem tools) — ex: smoke test diário (`clawde smoke-test`).

## Consequências

**Positivas**
- **Tipado** — `Message`, `ToolUseBlock`, `TextBlock` etc; erros são exceptions tipadas.
- **Hooks programáticos** — callbacks TypeScript em vez de scripts externos jq+bash.
- **`canUseTool` nativo** — gate de tools sem wrapper.
- **Streaming async iterator** — compõe com `for await` + AbortController.
- **Sessão determinística** — passamos `sessionId`, SDK respeita; sem parsing.
- **Mantido pela Anthropic** — segue o CLI sem nosso parser quebrar a cada release.
- **Reuso direto** do parser/observation patterns do `claude-mem`.

**Negativas**
- **Depende de runtime Bun/Node** no host (vs só `claude` binário com subprocess).
  Aceitável dado que ADR 0001 já comprou TS+Bun.
- **Acopla** Clawde à API do SDK — mudanças breaking exigem upgrade coordenado.
  Mitigação: pin de versão em `package.json`, smoke test detecta breakage.
- **Subprocess fallback** ainda precisa existir para casos onde SDK não é apropriado
  (smoke test que valida o próprio CLI; comandos administrativos como `setup-token`).

**Neutras**
- Bundle size do SDK (~2MB) é trivial dado que já compilamos via Bun.

## Alternativas consideradas

- **Subprocess + `jq` (v3 original)** — descartado pelos motivos acima.
- **Subprocess + parser custom em TypeScript** — reimplementa o que o SDK já faz.
- **Subprocess para 100% das invocações, SDK só pra hooks** — descartado, perde os
  ganhos centralizados (streaming, types, gating).

## Referências

- `ARCHITECTURE.md` §11.4 (tabela comparativa SDK vs subprocess).
- `BLUEPRINT.md` §1 (`src/sdk/`), §4 (hooks).
- ADR 0001 (TypeScript + Bun stack — pré-requisito desta decisão).
- `@anthropic-ai/claude-agent-sdk` — https://github.com/anthropics/claude-agent-sdk-typescript
- `claude-mem/src/sdk/parser.ts` — fonte dos `ParsedObservation`/`ParsedSummary`.
