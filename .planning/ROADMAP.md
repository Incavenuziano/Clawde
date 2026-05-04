# Clawde — Autonomous Dual-IA Fix Cycle

**Milestone:** `v0.1-deploy-fix`
**Status:** planning-complete — ready-to-execute
**Base:** `main` @ `e483519` (post-Wave 6)
**Source:** issues #41, #42, #43, #44, #45, #47, #49, #51
**Integrates with:** `docs/AUTONOMOUS_DUAL_IA_EXECUTION_PLAN.md` (Codex)

---

## Lanes

### Autonomous Lane
Implementation + cross-review + CI + merge allowed.
Applies to non-security workstreams with strong local verification.

### Guarded Lane
Implementation + cross-review + CI + PR ready-to-merge.
**No auto-merge**. Operator approves explicitly.
Applies when: security-sensitive files, sandbox behavior, auth boundaries.

---

## Workstreams

| WS | Branch | Owner | Reviewer | Issues | Lane |
|----|--------|-------|----------|--------|------|
| **A** | `task/auto-runtime-sdk-resolution` | **Codex** | Claude | #41, #43, #47 | Autonomous |
| **B** | `task/auto-quota-wakeup` | **Codex** | Claude | #44 | Autonomous |
| **C** | `task/auto-result-visibility` | **Claude** | Codex | #42, #45 | Autonomous |
| **D** | `task/auto-sandbox-fixes` | **Codex** | Claude | #49, #51 | **Guarded** |

**Ordem recomendada:** A e C em paralelo → B após A (se houver overlap de arquivo) → D por último.

---

## Minimum CI Contract

Todo branch deve passar antes de abrir PR:

```bash
bun run ci   # typecheck + lint + test (já configurado em package.json)
```

Se o workstream tocar packaging, bundle ou services, também rodar:

```bash
bun run build:worker   # verifica que o bundle compila
```

---

## Stop Conditions (para execução autônoma)

Parar e aguardar operador se:

- `bun run ci` falha por razão inesperada não relacionada ao fix
- Arquivos alterados extrapolam o `Expected touchpoints` do workstream
- Escopo do issue expande para outro workstream
- Migration ou schema change implica reescrita de dados não prevista no plano
- Reviewer encontra disagreement de design (não apenas bug corrigível)
- Arquivo security-sensitive tocado em branch Autonomous Lane

---

## Protocolo de execução

### Implementer (por workstream)

```bash
git checkout main && git pull --ff-only
git checkout -b task/auto-<workstream>
# ler .planning/phases/workstream-<X>/PLAN.md
# implementar
bun run ci                       # deve ser clean
git add -u && git commit         # GIT_AUTHOR/COMMITTER env vars obrigatórios
git push -u origin task/auto-<workstream>
gh pr create ...                 # body fecha issues correspondentes
# atualizar STATUS.md para "in-review, PR #N"
```

### Reviewer (após PR aberto)

```bash
git fetch origin && git checkout task/auto-<workstream>
bun run ci                       # rodar local antes de approve
# checar diff vs Expected touchpoints do PLAN.md
# verificar acceptance criteria
```

Mensagem de aprovação:
```
Approved: scope matches plan, CI green, acceptance criteria met.
```

Mensagem de request-changes:
```
Changes requested: <item específico não atendido>.
```

### Merge rule

- **Autonomous Lane:** merge após reviewer approve + CI green + diff dentro do declared scope.
- **Guarded Lane:** parar após PR approved. Marcar `ready-to-merge, guarded`. Operador decide.

---

## Status vocabulary (STATUS.md)

- `in-progress, codex-auto`
- `in-progress, claude-auto`
- `in-review, PR #N`
- `ready-to-merge, guarded`
- `merged, PR #N, YYYY-MM-DD`

---

## Convenções de commit (herdadas das Waves 1-6)

```bash
GIT_AUTHOR_NAME="Incavenuziano"
GIT_AUTHOR_EMAIL="222538801+Incavenuziano@users.noreply.github.com"
GIT_COMMITTER_NAME=  # idem
GIT_COMMITTER_EMAIL= # idem
```

Conventional commits. Body fecha issues com `Closes #N`. Co-Authored-By obrigatório.
