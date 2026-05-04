# Clawde — Fix Cycle: Deploy Blockers

**Milestone:** `v0.1-deploy-fix`
**Status:** ready-to-execute
**Base branch:** `main` @ `e483519`
**Issues:** #41, #42, #43, #44, #45

## Protocol automático

- Cada fase tem um **owner** (implementer) e um **reviewer** (outro AI).
- Owner: cria branch, executa PLAN.md, abre PR com `/gsd-ship`.
- Reviewer: quando PR estiver aberto, faz review com critérios do PLAN.md e posta resultado.
- Sem interferência do operador nos reviews — só na decisão final de merge.
- Ambos os AIs têm GSD minimal profile instalado.

## Fases

| Fase | Branch | Owner | Reviewer | Issues | Status |
|------|--------|-------|----------|--------|--------|
| 1 | `fix/sdk-binary-path` | **Claude** | Codex | #41, #43 | pending |
| 2 | `fix/deploy-infra` | **Codex** | Claude | #44, #45 (docs) | pending |
| 3 | `feat/result-command` | **Claude** | Codex | #42 | pending |

## Convenções (herdadas das waves 1-6)

- `git commit` via env vars: `GIT_AUTHOR_NAME="Incavenuziano" GIT_AUTHOR_EMAIL="222538801+Incavenuziano@users.noreply.github.com"` + idem para COMMITTER.
- Conventional commits + issue ref no body (ex: `Closes #41`).
- Atomic: 1 commit por task lógica. Não squash mid-phase.
- `bun run typecheck` + `bun run lint` + `bun test` devem estar clean antes de abrir PR.
- Self-approve bloqueado (Incavenuziano = author das PRs do Claude). Reviewer faz `gh pr review --approve --body "..."` ou posta snippet pro operador rodar em outra conta.

## Critérios globais de aceite

- `bun run typecheck` clean.
- `bun run lint` clean (0 errors, ≤1 warning pré-existente).
- `bun test` 717+ pass / 0 fail.
- Nenhuma injeção mid-stream.
- Docs atualizados junto com behavior runtime.
