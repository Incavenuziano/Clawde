# STATE — Fix Cycle Deploy Blockers

**Iniciado:** 2026-05-03
**Base:** main @ e483519 (post-Wave 6, post-GSD install)
**Operador:** Incavenuziano

## Contexto

Primeiros testes reais do Clawde em WSL2 Ubuntu 24.04 com systemd revelaram:
- 2 bugs bloqueantes de deploy (#41 musl/glibc + #43 bundle path)
- 1 gap operacional crítico (#44 deferred tasks não disparam após quota reset)
- 1 gap de UX (#42 result NULL para tasks tool-heavy)
- 1 validação positiva a documentar (#45 reconcile/quota/health OK)

## Progresso

| Fase | Status | PR | Notas |
|------|--------|----|----|
| 1 — SDK binary path | ⬜ pending | — | Claude owner |
| 2 — Deploy infra | ⬜ pending | — | Codex owner |
| 3 — Result command | ⬜ pending | — | Claude owner |

## Decisões fixadas

1. Fix #41+#43 juntos: `worker.claude_executable_path` (config) + `scripts/setup-linux.sh`.
2. Fix #44 com timer 30min (Opção A do issue). Não complicar com one-shot timer.
3. Fix #42 com opção C (enrichment no runner) + opção A (novo comando CLI).
4. #45 capturado em BEST_PRACTICES.md § "Comportamentos validados em produção".

## Para retomar após reset de contexto

1. Ler este arquivo + ROADMAP.md.
2. Ler o PLAN.md da fase correspondente em `.planning/phases/0N-*/`.
3. Checar `gh pr list --state all --search "fixes/deploy-blockers OR fix/sdk OR fix/deploy OR feat/result"`.
4. Continuar de onde parou.
