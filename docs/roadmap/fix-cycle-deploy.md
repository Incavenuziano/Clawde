# Fix Cycle — Deploy Blockers

**Status:** ready-to-execute (2026-05-03)
**Trigger:** primeiros testes reais WSL2 Ubuntu 24.04 (8 tasks, 274 msgs)
**GSD:** plano executável em `.planning/` — ambos AIs têm GSD minimal instalado

## TL;DR

Três issues bloqueantes ou importantes descobertos em produção. Dois AIs implementam
em paralelo (fases atribuídas), review cruzado automático.

| Issue | Tipo | Fase | Owner | Reviewer |
|-------|------|------|-------|----------|
| #41 + #43 SDK binary | bug bloqueante | 1 | Claude | Codex |
| #44 deferred no auto-trigger | gap operacional | 2 | Codex | Claude |
| #45 docs validados | docs | 2 | Codex | Claude |
| #42 result NULL | UX gap | 3 | Claude | Codex |

## Issues resumidos

### #41 + #43 — SDK binary resolution (bloqueante)

**Sintoma:** Worker deployado em `~/.clawde/dist/` não acha o binário glibc do SDK.
`task_runs.status=failed, msgs_consumed=0`.

**Causa:** SDK usa `import.meta.dir` para resolver o binário nativo. Quando bundlado,
aponta para `~/.clawde/dist/` onde não há `node_modules`. Agrava com seleção errada
do binário musl em Ubuntu.

**Fix Fase 1 (Claude):** `worker.claude_executable_path` em `config/schema.ts` + wire
para `pathToClaudeCodeExecutable` do SDK.

**Fix Fase 2 (Codex):** `scripts/setup-linux.sh` que instala o binário glibc em
`~/.clawde/bin/claude` e configura o campo automaticamente.

### #44 — Deferred tasks sem auto-trigger (gap operacional)

**Sintoma:** Após quota resetar, tasks com `not_before <= now()` ficam paradas porque
o `.path` watcher só dispara em mudança de arquivo, não em evento temporal.

**Fix Fase 2 (Codex):** `clawde-deferred-check.timer` com `OnUnitActiveSec=30min` +
`OnBootSec=5min`. Worker executa a cada 30min e processa tasks elegíveis.

### #42 — `result = NULL` em tasks tool-heavy (UX gap)

**Sintoma:** Agente que responde via tool calls (Glob/Grep/Read/Edit) tem `finalText`
vazio → `task_runs.result = NULL`. Operador não consegue ver a resposta via CLI.

**Fix Fase 3 (Claude):**
1. `runner.ts`: salvar texto completo (todos os turns do assistente, não só finalText).
2. `clawde result <task-id>`: novo comando que serve do DB e fallback para JSONL de sessão.

### #45 — Comportamentos validados (docs)

**Positivo:** Reconcile de lease, quota gate, health endpoint e receiver estável
funcionaram corretamente em todos os testes.

**Fix Fase 2 (Codex):** `BEST_PRACTICES.md §12` com evidência de produção.

## Protocolo de review automático

Após cada PR ser aberto pelo owner:

1. **Reviewer** recebe "PR #N pronto pra review" e executa o review
   usando os critérios do PLAN.md da fase correspondente.
2. **Owner** aplica fixes se REQUEST-CHANGES, reabre para re-review.
3. **Merge** após approve — operador faz o approve formal (branch protection).

## Estado atual

Ver `.planning/STATE.md` para progresso live.
