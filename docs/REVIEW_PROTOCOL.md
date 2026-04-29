# Clawde — Protocolo de Review (Claude + Codex)

> Como duas sessões de IA (Claude e Codex) colaboram via PR no GitHub para
> executar o backlog de remediação de [EXECUTION_BACKLOG.md](../EXECUTION_BACKLOG.md).
> Operador (Incavenuziano) é roteador mínimo entre as sessões.

## Princípio fundamental

**Quem implementa não revisa.** Cada task em `EXECUTION_BACKLOG.md` tem
`[implementer → reviewer]` fixo (claude → codex ou codex → claude). Tasks
`security` exigem **dupla revisão** (operador + IA oposta).

Sem isso, a colaboração vira sycophancy mútua e perde o valor de ter duas
análises independentes.

## Limitação aceita

Repo `Incavenuziano/Clawde` é privado em GitHub free tier. **Branch protection
não está disponível** — enforcement de "1 review obrigatório antes de merge"
fica como convenção, não regra do GitHub. Operador valida no `STATUS.md`
que cada task seguiu o fluxo antes de avançar.

Alternativas (não aplicadas):
- Upgrade GitHub Pro ($4/mês) habilita branch protection.
- Tornar repo público remove a limitação mas expõe código.

## Fluxo por tipo de task

### `mech` — mecânica (snippet conhecido)

```
Implementer:
  git checkout -b task/T-XXX-slug
  <implementação>
  bun run ci  # local
  git add . && git commit -m "feat(scope): T-XXX subject"
  git push -u origin task/T-XXX-slug
  gh pr create --fill --base main --head task/T-XXX-slug
  # Update STATUS.md: linha T-XXX → "in-review, <implementer>, PR #N"
  git add STATUS.md && git commit -m "chore(status): T-XXX in-review" && git push

Operador:
  "<reviewer>: revisa PR #N"

Reviewer:
  gh pr checkout N
  gh pr diff N
  bun run ci  # local
  # Se OK:
  gh pr review N --approve -b "T-XXX OK, CI passou."
  # Se mudanças:
  gh pr review N --request-changes -b "<feedback específico>"

Implementer (se aprovado):
  gh pr merge N --squash --delete-branch
  # Update STATUS.md: T-XXX → "merged, PR #N, YYYY-MM-DD"

Implementer (se mudanças):
  <ajusta>
  git push
  # Notifica operador: "ajustado, PR #N pra re-review"
```

**Tempo médio**: implementação 5-30min, review <15min, total <1h.

### `verification` / `design`

Mesma mecânica, mas reviewer **lê todo o código modificado** (não só CI).
Reviewer pode comentar inline em linhas específicas via:

```bash
gh pr review N --request-changes -b "Ver comentários inline"
gh pr comment N --body "..."
```

Operador é mais cauteloso em aprovar merge — confere que crítica foi endereçada.

**Tempo médio**: review 15-30min, total 1-2h por task.

### `security` — DUPLA REVIEW obrigatória

Tasks marcadas com `security` em `EXECUTION_BACKLOG.md` (T-050, T-051, T-057,
T-075, T-076, T-092, T-096, T-097, T-098, T-099) **não são merge-passíveis**
sem aprovação dos dois reviewers:

1. IA oposta (Claude se Codex implementou; vice-versa) faz review padrão.
2. **Operador** lê PR + review da IA, confirma entendimento, posta segundo
   approve via:
   ```bash
   gh pr review N --approve -b "Operator: validei <ponto específico>."
   ```
3. Merge só após os dois approves.

Se houver discordância forte entre operador e reviewer IA, criar arquivo
`docs/disputes/T-XXX.md` com:
- Posição do reviewer IA
- Posição do operador
- Decisão final (do operador) com justificativa

Não merge-ar até dispute resolvido.

**Tempo médio**: review IA 30min + review operador 15-30min + possível dispute,
total 2-4h por task.

## Convenções de branches e commits

### Branch
```
task/T-NNN-<slug-curto>
```
Exemplos: `task/T-001-receiver-main-skeleton`, `task/T-049-pretooluse-allowedtools`.

### Commit
Conventional commits, scope identificável, T-NNN no subject ou body:

```
feat(receiver): T-001 add bootstrap skeleton

Implements task T-001 from EXECUTION_BACKLOG.md. Creates
src/receiver/main.ts exporting bootstrap() that loads config,
opens DB, applies migrations, wires repos. Routes registered
in T-002 (next).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

`Co-Authored-By` deixa claro qual IA fez a implementação (auditável via
`git log`).

### PR title
```
T-NNN: <conventional commit subject>
```
Exemplos:
- `T-001: feat(receiver): add bootstrap skeleton`
- `T-049: feat(hooks): gate PreToolUse by allowedTools`

### PR body (template)
```markdown
Closes task T-NNN in EXECUTION_BACKLOG.md.

## What
<2-3 frases sobre a mudança>

## Acceptance criteria
<copia do backlog>

## Notes for reviewer
<pontos específicos pra prestar atenção, decisões tomadas, perguntas>

## CI
- [ ] `bun run typecheck` clean
- [ ] `bun run lint` clean
- [ ] `bun test` passing (X new tests)
- [ ] Manual smoke (se aplicável): <descrição>

🤖 Implemented by Claude Opus 4.7 / Codex (escolher)
```

## Workflow do operador (você)

### Mínimo necessário entre tasks

Quando implementer notifica "T-XXX pronto, PR #N":

```
"<reviewer>: revisa PR #N"
```

Quando reviewer notifica resultado:

```
Se aprovado:
  → diz pro implementer: "merge"
Se mudanças requested:
  → reviewer já mandou feedback no PR
  → implementer ajusta sem você intervir
Se security task:
  → você abre PR, lê diff, lê review da IA
  → posta segundo approve ou inicia dispute
```

### Tempo investido por você

- Tasks `mech`: ~30s (1 mensagem por task)
- Tasks `verification`/`design`: ~30s + leitura ocasional
- Tasks `security`: 15-30min cada (10 tasks security = 2.5-5h total ao longo do projeto)
- Wave audit: 30min-1h (5 waves = 2.5-5h total)

**Total estimado de seu tempo**: 5-15h ao longo das 124 tasks. Resto é só
roteamento.

## Atualização de STATUS.md

Estados e quando atualizar:

| Estado | Atualizado por | Quando |
|--------|----------------|--------|
| `pending` | — (estado inicial) | Setup do backlog |
| `in-progress, <quem>` | Implementer | Ao começar trabalho na task |
| `in-review, <quem>, PR #N` | Implementer | Após `gh pr create` |
| `merged, PR #N, YYYY-MM-DD` | Implementer | Após `gh pr merge` |
| `blocked, <razão>` | Quem detectou | Ao identificar dep faltante |

Update do STATUS.md vai junto no commit (ou commit separado `chore(status):`).
Conflitos raros porque cada linha é independente.

## Wave audits

Última task da wave gera **wave summary**:

```
docs/wave-summaries/wave-N.md
```

Conteúdo:
- Lista de tasks completas (links pros PRs)
- Resultados dos critérios de validação da wave (do CONSOLIDATED_FIX_PLAN)
- Issues encontrados que viraram tasks novas (T-NNN-followup-1, ...)
- Métricas: LOC, tests count, time spent

**Reviewer da wave** (alternando: Codex revisa Wave 1, Claude revisa Wave 2):
- Roda `bun run ci` em main após todas merges
- Valida critérios de validação da wave
- Smoke test E2E (Wave 1+ tem isso)
- Posta wave-review no `docs/wave-summaries/wave-N.md` (PR próprio)

Operador aprova wave fechada → próxima wave começa.

## Pontos de fricção previstos

| Situação | Mitigação |
|----------|-----------|
| Reviewer travou / não responde | Operador pinga: `"status do review do PR #N?"` |
| CI quebra entre tasks paralelas | Quem mergeu por último resolve antes de qualquer outro merge |
| Dois implementers começam mesma task | STATUS.md tem `in-progress, <quem>` antes — segundo desiste ou ajuda |
| Discordância sobre escopo de task | Criar comment no PR; operador decide; pode requerer split em sub-tasks |
| Snippet do backlog não funciona como descrito | Implementer ajusta + comenta no PR explicando; reviewer valida |

## Início — Wave 1

Primeira task: T-001 (`mech`, claude → codex). Quando começar:

1. Claude:
   ```
   git checkout -b task/T-001-receiver-main-skeleton
   ```
2. Implementa T-001 conforme [EXECUTION_BACKLOG.md](../EXECUTION_BACKLOG.md).
3. Commit + push + `gh pr create`.
4. Update `STATUS.md`.
5. Avisa operador.

Operador roteia pro Codex revisar. Codex aprova ou pede mudanças. Merge.
Próxima task começa em paralelo se sem dependência.

---

*Documento vivo. Ajustar conforme atrito real surge na execução.*
