# ADR 0001 — TypeScript + Bun como stack core

- **Status:** Accepted
- **Date:** 2026-04-29
- **Decisores:** @Incavenuziano

## Contexto

A v3 do `ARCHITECTURE.md` propunha "Bash + SQLite" como stack do daemon. Análise do
ecossistema do usuário e validação contra repos reais (`claude-mem`, `get-shit-done`,
`superpowers`, `clawflows`) mostraram que essa decisão era subótima:

- A premissa "Bash sem dependências" é falsa: já exigia `claude`, `sqlite3`, `jq`, `curl`.
- Repos próprios do usuário usam TS/Bun (`claude-mem`) e JS (`get-shit-done` hooks) —
  reuso direto de código é possível.
- Anthropic mantém SDK oficial em TypeScript (`@anthropic-ai/claude-agent-sdk`) que
  evolui junto com o CLI; subprocess + `jq` parsing é frágil a mudanças de schema.
- Funcionalidades não-triviais (concorrência, hooks tipados, streaming async, testes
  decentes) custam ~600-800 linhas em Bash defensivo, ~350-450 em TS/Bun.

## Decisão

Stack core: **TypeScript 5.x + Bun runtime + `@anthropic-ai/claude-agent-sdk` oficial.**

Bash continua como linguagem **apenas** para systemd glue (`.service`, `.timer`, `.path`)
e scripts ops curtos (`backup.sh`, `restore-drill.sh`).

Python permanece como **fallback** se o usuário quiser sair do Bun no futuro — `claude-agent-sdk`
Python é igualmente oficial. Decisão é reversível com esforço médio (re-escrever `src/sdk/`,
`src/db/`, `src/worker/`).

## Consequências

**Positivas**
- Reuso direto: schema/migrations/parser de `claude-mem`, hooks JS de `get-shit-done`.
- `bun:sqlite` stdlib (sem `better-sqlite3`/`sqlite3` npm), `bun test` built-in,
  `Bun.serve()` sem express.
- Distribuição via `bun build --compile` produz binário ~50MB sem Node.
- SDK oficial elimina parsing de stdout, dá streaming async iterator e hooks tipados.
- Tipos estáticos cobrem domínio inteiro (Task, Session, Event, etc).

**Negativas**
- Bun ainda é runtime jovem (vs Node) — risco de bug em libs nativas. Mitigação: pin de
  versão (`bun.lockb` commitado), smoke test diário.
- Adiciona ~50MB ao host (binário Bun) vs ~5MB Bash + jq.
- Curva de aprendizado se contribuidor futuro só souber Bash/Python.

**Neutras**
- TypeScript exige passo de build (`tsc` ou `bun build`) — mitigado pelo pipeline já
  necessário pra outros gates (lint, test).

## Alternativas consideradas

- **Bash + jq + sqlite3 CLI** — descartada (justificativa acima).
- **Python 3.11 + `claude-agent-sdk` + uv** — válida, é fallback se Bun não vingar.
  Perde reuso direto de claude-mem/GSD.
- **Node + npm** — perde os ganhos de Bun (sqlite stdlib, test built-in, compile).

## Referências

- `ARCHITECTURE.md` §11.3 (tabela comparativa Bash/Python/TS+Bun).
- `BLUEPRINT.md` §1 (tree do repo) e §2 (tipos do domínio).
- `claude-mem` (`Incavenuziano/claude-mem`) — fonte de reuso de migrations/parser.
