# Clawde — Handoff de sessão (2026-04-29)

> Estado da última sessão Claude Opus 4.7 antes do operador trocar pra
> Sonnet. Leia isto inteiro antes de prosseguir — toda decisão tomada
> e contexto necessário está aqui.

## TL;DR — onde paramos

- **Setup completo**: planos (Codex + Claude), backlog atômico
  (**143 tasks em 6 waves**), protocolo de review, AI onboarding,
  STATUS.md, gh CLI auth, bun + ts, line endings normalizados.
- **Wave 0 (pre-flight) commitada e em main** (commit `fdf9798`).
- **Auditoria de conformidade vs BEST_PRACTICES.md feita**: 8 gaps
  críticos absorvidos como **Wave 6** (T-125..T-143, hardening
  operacional); 14 gaps importantes/aceitáveis documentados em
  [`docs/KNOWN_GAPS.md`](docs/KNOWN_GAPS.md).
- **Codex foi onboarded** (mensagem grande passada pelo operador), tem
  ambiente isolado (`~/clawde` clone), instalou bun/auth/etc, está
  pronto pra começar **P0.3** (`task/P0.3-config-schema`, T-019).
- **Claude vai começar P0.1** (`task/P0.1-entrypoints`, T-001..T-013) em
  paralelo, mas ainda não começou — esperando sinal do operador.
- **Antes de Claude começar P0.1**, operador pediu pra mudar modelo pra
  Sonnet (esta sessão).

## Estado do git

- Remote: `origin/main` em `github.com/Incavenuziano/Clawde.git` (privado).
- Branch atual: `main`, sincronizado com origin.
- Commits relevantes (do mais recente):
  - `fdf9798` — chore(scaffolding): W0 pre-flight (typescript, tsconfig, line endings)
  - `f0203ec` — chore(status): rebalance implementer allocation toward Codex (71/29)
  - `cc23ebd` — docs(protocol): switch to one-branch-per-subphase + add AI onboarding
  - `7ef1d98` — chore(docs): add remediation plans, execution backlog, review protocol
- Working tree: limpo (apenas `.codex` untracked, é arquivo do Codex)

## Ferramentas instaladas

| Ferramenta | Versão | Localização |
|-----------|--------|-------------|
| `gh` CLI | 2.x | system PATH |
| `gh auth` | logged in | conta Incavenuziano, scope `gist,read:org,repo,workflow` |
| `bun` | 1.3.13 | `~/.bun/bin/bun` (PATH adicionado em `~/.bashrc`) |
| `typescript` | 5.7.3 | `node_modules/.bin/tsc` (devDep) |

**Git identity** está configurada via env vars inline em cada commit
(NTFS no `/mnt/c` impede `git config user.*`):
```
GIT_AUTHOR_NAME="Incavenuziano"
GIT_AUTHOR_EMAIL="222538801+Incavenuziano@users.noreply.github.com"
GIT_COMMITTER_NAME="Incavenuziano"
GIT_COMMITTER_EMAIL="222538801+Incavenuziano@users.noreply.github.com"
```
Use sempre esse padrão pra commits — é o noreply oficial do GitHub do user.

## CI local

- `bun run typecheck` ✅ clean
- `bun run lint` ✅ 153 files, no fixes applied
- `bun test` ⚠️ **565/566** (1 flaky pré-existente, **não-bloqueante**):
  - Teste flaky: `tests/unit/db/task-runs.repo.test.ts > findExpiredLeases retorna runs com lease_until < now`
  - Causa: lease 1s vs sleep 1.5s, margem apertada em WSL sob load
  - Em isolamento passa 3/3; só falha esporadicamente em suite completa
  - Não causado pelo W0; ignore se for SÓ esse

## Documentos chave (leia em ordem ao reabrir)

1. **[`docs/AI_ONBOARDING.md`](docs/AI_ONBOARDING.md)** — referência completa pra qualquer IA do projeto
2. **[`STATUS.md`](STATUS.md)** — estado de cada sub-fase, alocação Claude/Codex
3. **[`docs/REVIEW_PROTOCOL.md`](docs/REVIEW_PROTOCOL.md)** — fluxo de PR por sub-fase
4. **[`EXECUTION_BACKLOG.md`](EXECUTION_BACKLOG.md)** — **143 tasks em 6 waves**, foque na sub-fase ativa
5. **[`docs/KNOWN_GAPS.md`](docs/KNOWN_GAPS.md)** — 14 gaps documentados como débito pós-MVP
6. **[`CONSOLIDATED_FIX_PLAN.md`](CONSOLIDATED_FIX_PLAN.md)** — contexto do "porquê" de cada fix
7. **[`PRODUCTION_READINESS_PLAN.md`](PRODUCTION_READINESS_PLAN.md)** — versão Codex do plano

Documentos do projeto Clawde (consultar conforme precisar):
- `ARCHITECTURE.md`, `BLUEPRINT.md`, `BEST_PRACTICES.md`, `REQUIREMENTS.md`
- `docs/adr/0001..0013` — decisões arquiteturais imutáveis

## Decisões fixadas (NÃO revisitar)

Ratificadas pelo operador 2026-04-29:

1. **Sandbox Strategy B**: sandbox em tools/hooks (PreToolUse hook),
   SDK fica in-process. README/REQUIREMENTS rebaixam claim de "sandbox
   do agente" pra "sandbox de ações perigosas". Para `telegram-bot` e
   `github-pr-handler`: `allowedTools` muito restrito, sem `Bash`.
   Estratégia A (subprocess + bwrap) é reserve pra fase futura.

2. **Defer de quota via `task_runs.not_before`** (TEXT NULL).
   `pending + not_before > now` é semanticamente limpo. Sem status
   novo `deferred`. Tasks sem run prévio rejeitadas por quota geram
   `task_run` pendente com `not_before` setado.

3. **CLI MVP corta `forget` e `audit verify/export`**. Implementar:
   `panic-stop`, `panic-resume`, `diagnose`, `sessions list/show`,
   `config show/validate`, `reflect` (após P3.4).

Ressalvas do Codex já propagadas no backlog (T-014, T-029, T-030,
T-038, T-042, T-070-076, T-104):
- Trigger do worker via `WorkerTrigger` injetável (não systemctl inline).
- Defer atualiza tipos do runner pra resultado deferido.
- 429 mid-execução: `running → failed` + cria nova `pending` (não
  volta `running → pending`).
- Workspace push é opcional no MVP (branch local basta).
- Agentes MVP usam `loopback-only`/`none`, não `allowlist` (até T-092).
- T-104 quebrado em T-104a/b/c.

## Alocação 71/29 (Codex 71%, Claude 29%)

### Claude implementer (6 sub-fases) — você (esta sessão)

| Sub-fase | Branch | Tasks | LOC est. | Reviewer |
|----------|--------|-------|----------|----------|
| **P0.1** | `task/P0.1-entrypoints` | T-001..T-013 | ~250 | codex |
| P2.3 | `task/P2.3-external-input` | T-054..T-057 | ~80 | codex |
| P2.4 | `task/P2.4-review-fresh` | T-058..T-062 | ~120 | codex |
| P3.1 | `task/P3.1-readme-status` | T-101..T-103 | ~80 | codex |
| P3.2 | `task/P3.2-cli-ops` | T-104a/b/c, T-105..T-111 | ~400 | codex |
| P3.4 | `task/P3.4-reflect-job` | T-112..T-115 | ~150 | codex |

### Claude reviewer (21 sub-fases) — Codex implementa

P0.2, P0.3, P1.1, P1.2, P1.3, P2.1, P2.2 (security), P2.5a, P2.5b (security),
P1.4, P1.5, P2.6 (security), P2.7 (security), P3.5, P3.6,
**P6.1, P6.2, P6.3 (security em T-132), P6.4, P6.5, P6.6** (Wave 6).

## Próxima ação ao reabrir sessão

### Estado de cada IA neste momento

- **Codex**: aguardando sinal pra começar P0.3 (já onboarded, mensagem grande passada pelo operador na última conversa).
- **Claude (você)**: aguardando sinal pra começar P0.1 (modelo trocado pra Sonnet — esta sessão).

### Quando reabrir como Sonnet

1. Ler `docs/AI_ONBOARDING.md` inteiro.
2. Ler `STATUS.md` pra ver alocação corrente.
3. Confirmar com operador: "Sessão reaberta em Sonnet. Pego P0.1 (task/P0.1-entrypoints)?"
4. Se autorizado, criar branch:
   ```bash
   cd /mnt/c/Users/pcdan/Clawde/Clawde
   git checkout main
   git pull origin main
   git checkout -b task/P0.1-entrypoints
   ```
5. Atualizar STATUS.md (linha P0.1 + linhas T-001..T-013 → "in-progress, claude").
6. Implementar T-001 a T-013 (sequenciais, com algumas paralelas):
   - T-001 → T-005: skeleton de `src/receiver/main.ts`, rotas, signals, entrypoint
   - T-006 → T-009: skeleton de `src/worker/main.ts`, reconcile, loop, entrypoint
   - **T-008** está `blocked-on T-029` (P1.2 do Codex). Adicione TODO no código,
     marque a linha de T-008 como `blocked, after P1.2` no STATUS.md, segue.
   - T-010: atualizar package.json scripts (build:cli/receiver/worker)
   - T-011: ajustar systemd units pra apontar nos artefatos certos
   - T-012, T-013: tests integração de bootstrap
7. Cada task → 1 commit (atomic). Commit subject `feat(scope): T-NNN <subject>`.
8. Sempre usar env vars de identity nos commits (ver seção "Ferramentas").
9. Antes do PR: `bun run typecheck && bun run lint && bun test` (pode pular o flaky se for SÓ aquele).
10. Push, abrir PR seguindo template do `docs/REVIEW_PROTOCOL.md`.
11. Atualizar STATUS.md → "in-review, PR #N".
12. Avisar operador: `P0.1: PR #N pronto pra review por Codex.`

## Pontos abertos / observações

### Sobre o ambiente

- WSL2 Ubuntu 24.04 em `/mnt/c/Users/pcdan/Clawde/Clawde` (NTFS mount).
- NTFS impede `chmod` em alguns arquivos do `.git/` (lockfile).
  Workaround: `bun.lock` regenerado via `/tmp` Linux nativo quando
  `bun add` precisar atualizar.
- Permission de `git config user.*` falha por NTFS — use env vars inline
  no commit (ver seção "Ferramentas").

### Sobre o teste flaky

- `findExpiredLeases retorna runs com lease_until < now`
- Causa: lease 1s + sleep 1.5s, margem pequena.
- **Não consertei** porque é fora do escopo de W0 (foi pré-existente).
- Considerar criar followup task pós-Wave 1 pra aumentar margem
  (mudar `1500` pra `2500` em `tests/unit/db/task-runs.repo.test.ts:116`).

### Sobre o Codex

- Ambiente isolado em `~/clawde` (clone próprio, não compartilha com `/mnt/c`).
- bun + gh + git config independentes.
- Comunicação 100% via PR + GitHub. Operador é router de mensagens
  curtas: `"Codex: revisa PR #N"`, `"PR aprovado"`, etc.
- Códex confirmou onboarding ("Onboard OK. Começando P0.3.") mas
  encontrou bloqueios de ambiente (RO, sem bun, sem gh auth) que
  foram resolvidos com mensagem específica de setup. Aguardando
  confirmação que sincronizou o W0 e começou P0.3.

### Cross-wave dependencies conhecidas

- **T-008** (P0.1) depende de **T-029** (P1.2). Resolver com TODO no
  código durante P0.1, criar followup PR `task/P0.1-followup-quota-gate`
  depois que P1.2 mergear.

### Branch protection

- **NÃO disponível** (repo privado em GitHub free tier). Enforcement de
  "1 review obrigatório" é convenção, não regra do GitHub. Operador
  valida via STATUS.md.
- Alternativas não aplicadas: upgrade Pro ($4/mês) ou tornar repo público.

## Comandos úteis ao reabrir

```bash
# Sincronizar ambiente
cd /mnt/c/Users/pcdan/Clawde/Clawde
git checkout main
git pull origin main
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
bun --version    # confirma 1.3.13+
gh auth status   # confirma Incavenuziano logado

# Estado do trabalho
cat STATUS.md | head -60        # ver alocação e estado
gh pr list --state open         # PRs abertos
git log --oneline -10           # commits recentes

# Pra começar uma sub-fase
git checkout -b task/P-X.Y-slug
# ... implementação task-a-task ...

# Antes do PR
bun run typecheck && bun run lint && bun test

# Commit (com env vars de identity)
GIT_AUTHOR_NAME="Incavenuziano" \
GIT_AUTHOR_EMAIL="222538801+Incavenuziano@users.noreply.github.com" \
GIT_COMMITTER_NAME="Incavenuziano" \
GIT_COMMITTER_EMAIL="222538801+Incavenuziano@users.noreply.github.com" \
git commit -m "feat(scope): T-NNN subject

Closes T-NNN.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"

# PR
git push -u origin task/P-X.Y-slug
gh pr create --base main --head task/P-X.Y-slug \
  --title "P-X.Y: <descrição>" \
  --body "<template do REVIEW_PROTOCOL.md>"
```

---

*Salvo pelo Claude Opus 4.7 em 2026-04-29 antes da troca pra Sonnet.*
*Próxima sessão: ler isto + AI_ONBOARDING.md + STATUS.md, depois começar P0.1.*
