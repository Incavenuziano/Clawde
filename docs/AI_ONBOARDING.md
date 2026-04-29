# Clawde — Onboarding para sessões de IA (Claude / Codex)

> Leia isto primeiro se você é uma sessão de IA (Codex ou Claude) que está
> entrando no projeto Clawde para executar o backlog de remediação.
>
> Este documento responde: o que aconteceu, qual é seu papel, o que ler
> antes, como executar, quando avisar o operador, como revisar.

## 1. O que aconteceu

O projeto Clawde teve seu código revisado independentemente por duas IAs em
2026-04-29 (Claude Opus 4.7 e Codex). As auditorias produziram **21 itens**
de remediação consolidados em `CONSOLIDATED_FIX_PLAN.md` e
`PRODUCTION_READINESS_PLAN.md`. Esses 21 itens foram decompostos em
**124 tasks atômicas** organizadas em **5 waves** dentro de
`EXECUTION_BACKLOG.md`.

O operador (Incavenuziano) aprovou três decisões fixadas:
- **Sandbox Strategy B** (sandbox em tools/hooks, não no SDK process).
- **`task_runs.not_before`** para defer de quota (sem status novo).
- **CLI MVP** corta `forget`/`audit verify-export`.

Codex revisou o backlog e pediu 6 ajustes que foram propagados nas tasks
afetadas (T-014, T-029, T-038, T-042, T-070-076, T-104).

A fase de planejamento está fechada. Próximo passo é **execução** com
**revisão cruzada** entre as duas IAs: quem implementa não revisa.

## 2. Documentos de referência (leia antes de começar)

Em ordem de leitura, ~30min total:

1. **[`STATUS.md`](../STATUS.md)** (raiz) — tabela de branches/sub-fases,
   estado atual de cada uma. Sua "tela de operações".
2. **[`docs/REVIEW_PROTOCOL.md`](REVIEW_PROTOCOL.md)** — fluxo de PR, branches
   por sub-fase, convenções de commit/PR, dupla revisão em security.
3. **[`EXECUTION_BACKLOG.md`](../EXECUTION_BACKLOG.md)** — 124 tasks com
   critérios de aceite, snippets, dependências. Não precisa ler tudo — pule
   pra sub-fase que vai trabalhar.
4. **[`CONSOLIDATED_FIX_PLAN.md`](../CONSOLIDATED_FIX_PLAN.md)** — contexto
   do "porquê" de cada fix. Útil quando snippet do backlog não tá claro.
5. **[`PRODUCTION_READINESS_PLAN.md`](../PRODUCTION_READINESS_PLAN.md)** —
   versão Codex do plano (origem dos itens P-X.Y).

Documentos de fundo (consultar conforme precisar):
- `ARCHITECTURE.md`, `BLUEPRINT.md`, `BEST_PRACTICES.md`, `REQUIREMENTS.md`
- `docs/adr/*.md` — decisões arquiteturais imutáveis

## 3. Princípio fundamental

**Você implementa OU revisa, nunca os dois na mesma sub-fase.** Cada linha
em `STATUS.md#branches` tem `Implementer` e `Reviewer` fixos. Respeite.

Sub-fases com tasks `security` (P2.2, P2.5b, P2.6, P2.7) exigem revisão
**dupla**: você + operador. Não fazer merge sem dois approves.

## 4. Início rápido — primeira sub-fase

### 4.1 Sincronize com main

```bash
cd /caminho/para/Clawde   # repo path; ajuste conforme ambiente
git checkout main
git pull origin main
gh auth status            # confirma autenticado
```

Se `gh` não estiver disponível, peça ao operador antes de prosseguir.

### 4.2 Pegue uma sub-fase pendente

Abra `STATUS.md` e localize a primeira linha com:
- Estado: `pending`
- Implementer: você (codex ou claude)
- Sem dependência (`Dep.: —`) OU dependência já merged

Se houver paralelismo possível (sub-fases independentes), comece pela menor
primeiro pra estabelecer padrão.

### 4.3 Crie branch e marque "in-progress"

```bash
git checkout -b task/P-X.Y-slug

# Edite STATUS.md:
#   - linha do branch: estado → "in-progress, codex" (ou claude)
#   - cada T-NNN da sub-fase: estado → "in-progress"
git add STATUS.md
git commit -m "chore(status): P-X.Y in-progress"
```

### 4.4 Implemente task-a-task

Para cada T-NNN da sub-fase, em ordem de dependência:

```bash
# Implementação seguindo critério de aceite do EXECUTION_BACKLOG.md
# ... edits ...

bun run typecheck && bun run lint && bun test  # validação local

git add <files>
git commit -m "feat(scope): T-NNN <subject>

<corpo opcional explicando o porquê>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

**Regras de commit**:
- Conventional commits (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`).
- T-NNN no subject (não opcional — auditoria depende disso).
- Atomic: 1 commit = 1 task. Não squash mid-sub-fase.
- `Co-Authored-By` obrigatório (substitua pelo seu modelo se for Codex).

**Se travar em alguma task**:
- Critério de aceite vago? Tente sua melhor interpretação, registre no PR
  body.
- Snippet do backlog não funciona? Adapte, comente no PR.
- Dependência cross-wave? Adicione `// TODO: T-NNN (after P-X.Y)`, marque
  no STATUS.md como `blocked, after P-X.Y`, segue.
- Bloqueio real (precisa de input do operador)? Pare, atualize STATUS.md
  da task pra `blocked, <razão>`, avise no chat.

### 4.5 Abra o PR

```bash
git push -u origin task/P-X.Y-slug

gh pr create --base main --head task/P-X.Y-slug \
  --title "P-X.Y: <descrição curta>" \
  --body "$(cat <<'EOF'
Closes sub-phase P-X.Y in EXECUTION_BACKLOG.md.

## Tasks included
- T-NNN: <subject>
- T-NNN+1: <subject>
- ...

## What changed
<2-4 frases>

## Acceptance criteria validated
- [x] T-NNN criteria
- [x] T-NNN+1 criteria
- ...

## CI
- [x] bun run typecheck clean
- [x] bun run lint clean
- [x] bun test passing (X new tests)

## Notes for reviewer
<pontos específicos>

## Cross-wave dependencies
<TODOs apontando pra sub-fase futura, se houver>

🤖 Implemented by <Claude Opus 4.7 / Codex>
EOF
)"
```

### 4.6 Atualize STATUS.md e notifique

```bash
# Edite STATUS.md:
#   - linha do branch: estado → "in-review, PR #N"
#   - cada T-NNN: estado → "in-review, PR #N"
git add STATUS.md
git commit -m "chore(status): P-X.Y in-review (PR #N)"
git push
```

**Avise o operador no chat**:
```
P-X.Y: PR #N pronto pra review por <reviewer da tabela>.
```

## 5. Fluxo de revisão (quando você é reviewer)

### 5.1 Operador notifica

Você recebe mensagem do operador no chat:
```
"Codex/Claude: revisa PR #N"
```

### 5.2 Confira o PR

```bash
gh pr checkout N
gh pr diff N | less
gh pr view N --comments
```

Leia o body do PR, valide:
- Tasks listadas batem com a sub-fase no `STATUS.md`.
- Critério de aceite de cada T-NNN está cumprido.
- CI marcado como passing — confirme rodando localmente:
  ```bash
  bun run ci
  ```
- Notes for reviewer endereçados.

### 5.3 Para tasks `mech`/`design`/`verification`

Foco: critério de aceite cumprido + qualidade do código (sem bugs óbvios,
naming consistente, sem complexidade desnecessária).

Use `gh pr review` quando houver feedback inline:
```bash
gh pr review N --request-changes -b "<feedback global>"
gh pr comment N --body "<comentário inline numa decisão específica>"
```

Se aprovado:
```bash
gh pr review N --approve -b "P-X.Y: tasks T-NNN..T-NNN+k OK, CI passou."
```

Avise o operador no chat:
```
P-X.Y: PR #N approved.
```

### 5.4 Para tasks `security` dentro do PR

Mesma análise + atenção redobrada:
- Defesa cobre o vetor de ataque descrito no plano?
- Allowlists explícitas? Default fail-closed?
- Redact aplicado em todos os caminhos?

Após você (IA) aprovar, **operador faz segundo approve**. Você não merge
sozinho. Avise:
```
P-X.Y: review da IA aprovada. Operator: precisa segundo approve em PR #N pra merge.
```

### 5.5 Se mudanças requested

Aguarde implementer ajustar e push. GitHub envia notificação. Re-revise:
```bash
gh pr checkout N
git pull
gh pr diff N..HEAD
```

Aprove ou pede mais mudanças. Não há limite formal de rounds, mas se passar
de 3 rounds, considere split em sub-tasks ou levante pro operador.

## 6. Fluxo de merge (você é o implementer aprovado)

```bash
gh pr merge N --squash --delete-branch
git checkout main && git pull

# Edite STATUS.md:
#   - linha do branch: estado → "merged, PR #N, YYYY-MM-DD"
#   - cada T-NNN: estado → "merged"
git add STATUS.md
git commit -m "chore(status): P-X.Y merged (PR #N)"
git push
```

Notifique:
```
P-X.Y: merged. <próxima sub-fase disponível?>
```

## 7. Comandos cheat sheet

```bash
# Sincronizar
git checkout main && git pull origin main

# Branch nova
git checkout -b task/P-X.Y-slug

# Status
git status
gh pr list --state open
gh pr view N

# Push
git push -u origin task/P-X.Y-slug

# PR
gh pr create --base main --head task/P-X.Y-slug --title "..." --body "..."

# Review
gh pr checkout N
gh pr diff N
gh pr review N --approve -b "..."
gh pr review N --request-changes -b "..."

# Merge
gh pr merge N --squash --delete-branch

# CI local
bun run typecheck && bun run lint && bun test
# ou
bun run ci
```

## 8. Quando avisar o operador

| Situação | Mensagem sugerida |
|----------|-------------------|
| Sub-fase pronta pra review | `P-X.Y: PR #N pronto pra review por <quem>.` |
| Review aprovado | `P-X.Y: PR #N approved.` |
| Mudanças solicitadas | (não precisa avisar — implementer recebe via gh) |
| Implementer ajustou após review | `P-X.Y: PR #N ajustado pra re-review.` |
| Sub-fase merged | `P-X.Y: merged.` |
| Bloqueio real (precisa decisão humana) | `P-X.Y bloqueada: <razão específica + opções>.` |
| Discordância em review (security) | `Dispute em P-X.Y: <ponto>. Posições no docs/disputes/.` |
| Wave inteira completa | `Wave N: todas sub-fases merged. Audit por <quem>?` |

## 9. Regras de ouro

1. **Não invente tasks.** Se faltar algo, levante pro operador.
2. **Não pule revisão.** PR sem approve de reviewer não merge.
3. **Não toque branch da outra IA** sem checkout local explícito.
4. **Não force-push em main**. Sempre via PR.
5. **Não commite secrets**. Token OAuth, API keys, etc — `redact` aplicado.
6. **Não rode comandos destrutivos** (`git reset --hard`, `rm -rf`) sem
   confirmação do operador.
7. **Atomic commits**. Se um commit cobrir múltiplas tasks, está errado.
8. **Critério de aceite é contrato**. Se não dá pra cumprir, não cumpra
   parcialmente sem documentar — pare e avise.
9. **CI verde antes do PR**. Não confie em "vai passar no CI remoto".
10. **STATUS.md sempre coerente com a realidade**. Se branch tá em review,
    a linha tá em review.

## 10. Estado atual (no momento desta escrita)

- **Commit base**: `7ef1d98` em `main` — adicionou todos os planos + STATUS + protocolo.
- **Sub-fases prontas pra começar** (sem deps): P0.1, P0.3.
- **Próxima sub-fase com dependência simples**: P0.2 (depende de T-005 dentro de P0.1).
- **Wave 1**: 3 sub-fases (P0.1, P0.2, P0.3). Marco: daemon sobe.

Para alocação corrente, consulte `STATUS.md#branches`.

---

*Este documento é vivo — atualize se descobrir fricção não coberta aqui.*
