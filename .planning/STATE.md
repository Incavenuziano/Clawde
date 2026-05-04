# STATE — Fix Cycle Deploy Blockers

**Iniciado:** 2026-05-03
**Base:** main @ e483519 (post-Wave 6, GSD minimal v1.39.1 instalado)
**Plan doc:** docs/AUTONOMOUS_DUAL_IA_EXECUTION_PLAN.md (Codex) + .planning/ROADMAP.md (reconciliado)

## Issues neste batch

| Issue | Título resumido | Workstream |
|-------|-----------------|------------|
| #41 | SDK instala musl em Ubuntu/Debian | A |
| #43 | Bundle perde caminho do SDK fora do projeto | A |
| #47 | worker falha com "claude not found" (Windows npm no WSL2) | A |
| #44 | Tasks deferidas sem auto-trigger após quota reset | B |
| #42 | result=NULL em tasks tool-heavy | C |
| #45 | Comportamentos validados — evidence para docs | C |
| #49 | bwrap não wired no worker (OS-level) | D |
| #51 | allowed_writes=/workspace quebra implementer sem bwrap | D |

## Progresso

| WS | Branch | Status | PR |
|----|--------|--------|-----|
| A | `task/auto-runtime-sdk-resolution` | ⬜ pending | — |
| B | `task/auto-quota-wakeup` | ⬜ pending | — |
| C | `task/auto-result-visibility` | ⬜ pending | — |
| D | `task/auto-sandbox-fixes` | ⬜ pending | — |

## Decisões fixadas

1. Workstream A (Codex): config `worker.claude_executable_path` + setup-linux.sh + #47 WSL PATH fix.
2. Workstream B (Codex): timer 30min com OnBootSec=5min.
3. Workstream C (Claude): `clawde result <task-id>` + runner enrichment + docs de produção (#45).
4. Workstream D (Codex, Guarded): wire bwrap no worker + fix allowed_writes para level=1.
5. `bun run ci` é o contrato mínimo de CI para todos os workstreams.

## Para retomar após reset de contexto

1. Ler ROADMAP.md + este arquivo.
2. Ler o PLAN.md do workstream correspondente.
3. Verificar `gh pr list --state all --limit 10`.
4. Confirmar `git log --oneline -5` no branch correto.
