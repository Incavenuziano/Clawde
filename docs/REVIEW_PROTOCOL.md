# Clawde — Protocolo de Review (Claude + Codex)

> Como duas sessões de IA (Claude e Codex) colaboram via PR no GitHub para
> executar o backlog de remediação de [EXECUTION_BACKLOG.md](../EXECUTION_BACKLOG.md).
> Operador (Incavenuziano) é roteador mínimo entre as sessões.

## Princípio fundamental

**Quem implementa não revisa.** Cada sub-fase em `EXECUTION_BACKLOG.md` tem
implementer fixo (claude ou codex); reviewer é a IA oposta. Tasks `security`
dentro da sub-fase exigem **dupla revisão** (operador + IA oposta).

Sem isso, a colaboração vira sycophancy mútua e perde o valor de ter duas
análises independentes.

## Limitação aceita

Repo `Incavenuziano/Clawde` é privado em GitHub free tier. **Branch protection
não está disponível** — enforcement de "1 review obrigatório antes de merge"
fica como convenção, não regra do GitHub. Operador valida no `STATUS.md`
que cada sub-fase seguiu o fluxo antes de avançar.

Alternativas (não aplicadas): upgrade GitHub Pro ($4/mês) habilita branch
protection; tornar repo público remove a limitação mas expõe código.

## Estratégia de branches: 1 por sub-fase

Cada **sub-fase** (P0.1, P0.2, P0.3, P1.1, P1.2, ..., P3.6) é uma **branch +
PR único**. Dentro do branch há **1 commit por task** (T-NNN), preservando
auditoria granular. Total: ~22 branches/PRs em vez de 124.

**Por que não 1 branch por task**: 124 PRs é overhead inviável; reviews ficam
desfocados em slivers; STATUS.md update inflaciona git log.

**Por que não 1 branch por wave**: PR > 500 LOC viola o limite de 300 do
BEST_PRACTICES; review fica disperso em 5+ módulos diferentes.

**Sub-fase é a unidade certa** porque o BACKLOG já agrupou tasks relacionadas
nela. PR cobre escopo coeso, ~3-13 commits, ~80-400 LOC. Algumas sub-fases
grandes (P2.5, P3.2) são pré-divididas em a/b.

### Lista canônica de branches

Ver tabela em [`STATUS.md`](../STATUS.md#branches) para alocação atual de
implementer/reviewer e estado de cada branch.

### Cross-wave dependencies

Algumas tasks dependem de tasks de outra sub-fase (ex: T-008 do P0.1 está
`blocked-on T-029` em P1.2). Resolver assim:

- PR principal mergeia com `// TODO: T-NNN (after P-X.Y)` no código.
- Linha da task em STATUS.md fica `blocked, after P-X.Y`.
- PR de followup `task/P-X.Y-followup-<slug>` mergeia depois da sub-fase
  bloqueante completar.

## Fluxo de sub-fase

### Etapas (mech, verification, design)

```bash
# 1. Implementer pega a sub-fase
git checkout main
git pull origin main
git checkout -b task/P-X.Y-slug
# Atualiza STATUS.md: linha do branch → "in-progress, <implementer>"
# Tasks individuais → "in-progress, <implementer>"
git add STATUS.md
git commit -m "chore(status): P-X.Y in-progress"

# 2. Implementação task-a-task (1 commit por T-NNN)
# Para cada T-NNN da sub-fase:
#   <implementação>
#   bun run typecheck && bun run lint && bun test  # local
#   git add . && git commit -m "feat(scope): T-NNN subject"

# 3. Final: PR
git push -u origin task/P-X.Y-slug
gh pr create --base main --head task/P-X.Y-slug \
  --title "P-X.Y: <descrição curta>" \
  --body "$(cat docs/templates/pr-body.md)"
# (template em docs/templates — ver seção "Template de PR" abaixo)

# 4. Atualiza STATUS.md: branch + tasks → "in-review, PR #N"
git add STATUS.md
git commit -m "chore(status): P-X.Y in-review"
git push

# 5. Notifica operador
echo "P-X.Y: PR #N pronto pra review por <reviewer>"
```

### Reviewer

```bash
# 1. Operador notifica: "Codex/Claude: revisa PR #N"
gh pr checkout N
gh pr diff N | less
bun run ci  # validação local

# 2a. Se OK
gh pr review N --approve -b "P-X.Y: todas tasks OK, CI passou."

# 2b. Se mudanças
gh pr review N --request-changes -b "$(cat <<'EOF'
P-X.Y review:
- T-NNN-a: <issue específico>
- T-NNN-b: <outro issue>
- Geral: <crítica de design>
EOF
)"
```

### Implementer pós-review

```bash
# Se aprovado
gh pr merge N --squash --delete-branch
# Atualiza STATUS.md: branch + tasks → "merged, PR #N, YYYY-MM-DD"
git checkout main && git pull
git add STATUS.md && git commit -m "chore(status): P-X.Y merged" && git push

# Se mudanças
git checkout task/P-X.Y-slug
# <ajusta>
bun run ci
git add . && git commit -m "fix(scope): address P-X.Y review feedback"
git push
# Notifica operador: "P-X.Y ajustado, PR #N pra re-review"
```

**Tempo médio por sub-fase**:
- Implementação: 1-6h (depende da sub-fase)
- Review: 30min-1h
- Round de mudanças (se houver): +30min-1h

### Tasks `security` dentro da sub-fase — DUPLA REVIEW

Sub-fases com tasks `security` (P2.2, P2.3, P2.5b, P2.6, P2.7) **não fazem
merge** sem aprovação dupla:

1. IA reviewer faz review padrão.
2. **Operador** lê PR + review da IA, posta segundo approve:
   ```bash
   gh pr review N --approve -b "Operator: validei <ponto específico>."
   ```
3. Merge só após **dois approves** distintos.

Discordância forte: criar `docs/disputes/P-X.Y.md` com posições e decisão
final do operador.

## Convenções

### Branch
```
task/P-X.Y-<slug-curto>
```
Exemplos:
- `task/P0.1-entrypoints`
- `task/P0.3-config-schema`
- `task/P2.5a-agent-loader`
- `task/P2.5b-agent-files`

### Commits dentro do branch (1 por task)

Conventional commits, scope identificável, T-NNN no subject:

```
feat(receiver): T-001 add bootstrap skeleton

Implements task T-001 from EXECUTION_BACKLOG.md. Creates
src/receiver/main.ts exporting bootstrap() that loads config,
opens DB, applies migrations, wires repos. Routes registered
in T-002 (next commit).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

`Co-Authored-By` deixa explícito qual IA fez a implementação.

### PR title

```
P-X.Y: <descrição curta da sub-fase>
```

Exemplos:
- `P0.1: receiver + worker entrypoints + build alignment`
- `P0.3: config schema for telegram/review/replica sections`
- `P2.5a: AGENT.md loader + zod validation`

### PR body (template)

```markdown
Closes sub-phase P-X.Y in EXECUTION_BACKLOG.md.

## Tasks included
- T-NNN: <subject>
- T-NNN+1: <subject>
- ...

## What changed
<2-4 frases sobre a mudança total>

## Acceptance criteria validated
- [ ] T-NNN criteria
- [ ] T-NNN+1 criteria
- ...

## CI
- [ ] `bun run typecheck` clean
- [ ] `bun run lint` clean
- [ ] `bun test` passing (X new tests)
- [ ] Manual smoke (se aplicável): <descrição>

## Notes for reviewer
<pontos específicos pra prestar atenção, decisões tomadas, perguntas>

## Cross-wave dependencies
<se houver TODOs apontando pra sub-fase futura, listar aqui>

🤖 Implemented by Claude Opus 4.7 / Codex
```

## Workflow do operador (você)

### Mínimo necessário

Quando implementer notifica "P-X.Y pronto, PR #N":
```
"<reviewer>: revisa PR #N"
```

Quando reviewer notifica resultado:
- **Aprovado**: diz pro implementer "merge".
- **Mudanças**: reviewer já comentou no PR; implementer ajusta sem você intervir.
- **Security**: você abre PR, lê diff, lê review da IA, posta segundo approve ou inicia dispute.

### Tempo investido

- Sub-fases `mech`/`verification`/`design`: ~30s (1 mensagem)
- Sub-fases com tasks `security`: 15-30min cada (5 sub-fases security = 1.5-3h)
- Wave audit (5 wave audits): 30min-1h cada = 2.5-5h

**Total estimado de seu tempo**: 5-12h ao longo das 22 sub-fases.

## Atualização de STATUS.md

Estados aplicados na linha do **branch** E em cada **task** individual:

| Estado branch | Estado tasks | Atualizado por | Quando |
|--------------|--------------|----------------|--------|
| `pending` | `pending` | — | Setup inicial |
| `in-progress, <quem>` | `in-progress` em todas | Implementer | Ao começar branch |
| `in-review, PR #N` | `in-review` em todas | Implementer | Após `gh pr create` |
| `merged, PR #N, YYYY-MM-DD` | `merged` em todas | Implementer | Após `gh pr merge` |
| `blocked, after P-X.Y` | `blocked` nas afetadas | Quem detectou | Cross-wave dep |

Update do STATUS.md vai como commit `chore(status):` separado em cada
transição. Conflitos raros (cada branch toca linhas próprias).

## Wave audits

Quando todas as sub-fases de uma wave merged, reviewer da wave (alternando:
Codex revisa Wave 1, Claude revisa Wave 2, ...) faz audit:

1. Roda `bun run ci` em main após todos os merges da wave.
2. Valida critérios de "Validação final" do CONSOLIDATED_FIX_PLAN para a wave.
3. Smoke test E2E (Wave 1+ tem isso).
4. Cria `docs/wave-summaries/wave-N.md` com:
   - Lista de PRs (links)
   - Métricas (LOC, tests count, sub-fases completas)
   - Issues encontrados que viraram tasks novas
   - Resultado dos critérios de validação
5. Posta como PR próprio: `task/wave-N-summary`.

Operador aprova wave fechada → próxima wave começa.

## Pontos de fricção previstos

| Situação | Mitigação |
|----------|-----------|
| Reviewer travou / não responde | Operador pinga: `"status do review do PR #N?"` |
| CI quebra entre sub-fases paralelas merged | Última merge resolve antes de qualquer novo merge |
| Dois implementers começam mesma sub-fase | STATUS.md tem `in-progress, <quem>` antes — segundo desiste |
| Discordância sobre escopo de sub-fase | Comment no PR; operador decide; pode requerer split |
| Snippet do backlog não funciona | Implementer ajusta + comenta no PR explicando; reviewer valida |
| Sub-fase fica > 500 LOC | Split em sub-fase a/b/c; abrir 2 PRs sequenciais ou paralelos |

## Início — começar Wave 1

**Pré-requisitos** (já feitos):
- `gh` CLI instalado e autenticado.
- `STATUS.md` na raiz com 124 tasks listadas.
- Plano consolidado em `EXECUTION_BACKLOG.md`.
- Commit base `7ef1d98` em main com tudo o acima.

**Primeiras 3 sub-fases** (Wave 1, podem rodar em paralelo):

| Branch | Tasks | Implementer | Reviewer | LOC est. | Dep. |
|--------|-------|-------------|----------|----------|------|
| `task/P0.1-entrypoints` | T-001..T-013 | claude | codex | ~250 | — |
| `task/P0.2-trigger` | T-014..T-018 | codex | claude | ~120 | T-005 (P0.1) |
| `task/P0.3-config-schema` | T-019 | codex | claude | ~80 | — |

**T-008** está `blocked-on T-029` (de P1.2) — implementer adiciona TODO no
código, marca no STATUS.md, segue. Followup `task/P0.1-followup-quota-gate`
mergeia depois de P1.2.

---

*Documento vivo. Ajustar conforme atrito real surge na execução.*
