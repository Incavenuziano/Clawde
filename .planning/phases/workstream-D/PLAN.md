---
workstream: D
title: Sandbox regressions and enforcement gaps
owner: Codex
reviewer: Claude
branch: task/auto-sandbox-fixes
closes: "#49, #51"
lane: guarded
---

# Workstream D — Sandbox Fixes (GUARDED LANE)

**Owner:** Codex
**Reviewer:** Claude
**Lane:** ⚠️ GUARDED — **não auto-merge**. Parar após PR approved + CI green.
Operador decide o merge.

## Issues

- `#49`: bwrap OS-level enforcement não está wired no worker. `preToolHandler` funciona
  (hook-level), mas o confinamento real do processo via bwrap não é iniciado.
- `#51`: `allowed_writes=['/workspace']` quebra o `implementer` em `sandboxLevel=1` porque
  sem bwrap o workspace real é `/tmp/clawde-<runId>`, não `/workspace`.

## Por que Guarded Lane

Ambas as issues tocam diretamente nos limites de segurança de execução:
- `#49`: wire de bwrap muda o modelo de execução do agente. Falso-negativo (achar que bwrap está ativo quando não está) é pior que o bug.
- `#51`: mudança de `allowed_writes` afeta quais paths o agente pode escrever — scope de write permission.

Qualquer fix aqui deve passar por review humano antes de mergear.

## Expected touchpoints

```
src/sandbox/matrix.ts       (materializeSandbox)
src/worker/runner.ts        (como sandbox é aplicado ao processamento)
.claude/agents/implementer/sandbox.toml
tests/security/*
tests/integration/sandbox-bwrap.test.ts
REQUIREMENTS.md ou README.md  (se claim de sandbox muda)
```

## Tasks

### Task 1 — Diagnóstico e ADR antes de implementar

**Antes de codar**, documentar em `.planning/phases/workstream-D/diagnosis.md`:

1. **#49 scope**: O bwrap está sendo preparado (`materializeSandbox` retorna config) mas
   onde no worker o `bwrap run <args>` é efetivamente chamado? Rastrear o caminho completo
   desde `processTask` até invocação do SDK.

2. **#49 decisão**: Quando `sandboxLevel >= 2` e bwrap disponível, o SDK deve rodar
   _dentro_ do bwrap? Ou o bwrap wraps o worker inteiro? Definir escopo da mudança.

3. **#51 fix**: Qual é a opção correta?
   - (a) Remover `allowed_writes=['/workspace']` do `sandbox.toml` do implementer para level=1.
   - (b) Fazer o `preToolHandler` resolver o path real do workspace na allowlist.
   - (c) Adicionar o workspace real à allowlist dinamicamente ao criar o task_run.

   Opção (a) é a mais segura para um fix imediato — documenta a limitação explicitamente.

### Task 2 — Fix #51 (menor risco)

Atualizar `.claude/agents/implementer/sandbox.toml`:

Opção A (recomendada): remover `allowed_writes=['/workspace']` e adicionar comentário:
```toml
# allowed_writes: sem restrição de path ao nível de allowlist para sandboxLevel=1
# (sem bwrap, o workspace real é /tmp/clawde-<runId>, não /workspace).
# A restrição de escrita em nível de path é efetiva apenas em sandboxLevel=2+.
# Segurança de nível 1 vem do hardening systemd do worker.
allowed_writes = []
```

`allowed_writes = []` significa "allowlist não enforced" per P2.2 behavior (undefined/absent = permissivo).

Verificar o código: qual é o comportamento exato de `allowed_writes = []` vs `undefined` em `preToolHandler`.

### Task 3 — Fix #49 (maior risco — diagnóstico primeiro)

Após diagnóstico (Task 1), implementar o wire de bwrap.

Opções principais:
- **Opção conservadora:** adicionar log explícito quando `sandboxLevel >= 2` mas bwrap não é invocado, para que o operador saiba que o confinamento OS-level não está ativo.
- **Opção funcional:** wire o bwrap invocation no worker/runner para agents com level >= 2.

Se a opção funcional for escolhida, o escopo pode extrapolar o `Expected touchpoints` declarado — acionando Stop Condition. Nesse caso, parar e consultar o operador.

### Task 4 — Testes de segurança

Para o fix de #51:
- Teste que `implementer` com `sandboxLevel=1` consegue escrever no workspace real.
- Teste que `allowed_writes=[]` não bloqueia writes em `preToolHandler` quando level=1.

Para o fix de #49 (se implementado):
- Teste que `sandboxLevel=2` com bwrap disponível realmente confina o processo.
- Teste fail-closed: sem bwrap disponível + `sandboxLevel=2`, task falha com erro claro.

## Stop Conditions específicas deste workstream

Parar e aguardar operador se:

- Fix de #49 requer mudanças em `src/sdk/*` ou `src/worker/runner.ts` além do wire direto.
- Comportamento de `allowed_writes = []` diverge do esperado (verificar testes existentes).
- Bwrap wire requer ADR novo (mudança arquitetural).

## Sequência de execução

```bash
git checkout main && git pull --ff-only
git checkout -b task/auto-sandbox-fixes

# Task 1: escrever diagnosis.md ANTES de codar
# Task 2: fix #51 (menor risco)
# Task 3: fix #49 (após diagnóstico)
# Task 4: testes

bun run ci
# Se task 3 não foi implementada por ser de alto risco:
# bun test -- apenas tasks de #51

GIT_AUTHOR_NAME="Incavenuziano" \
GIT_AUTHOR_EMAIL="222538801+Incavenuziano@users.noreply.github.com" \
GIT_COMMITTER_NAME="Incavenuziano" \
GIT_COMMITTER_EMAIL="222538801+Incavenuziano@users.noreply.github.com" \
git commit -m "fix(sandbox): allowed_writes level-1 fix + bwrap enforcement [GUARDED]

Closes #51
Closes #49  # ou: References #49 se fix parcial

[...]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git push -u origin task/auto-sandbox-fixes
gh pr create --title "fix(sandbox): level-1 allowed_writes + bwrap wire [GUARDED]" ...
# Marcar PR como ready-to-merge,guarded — NÃO mergear sem operador
```

## Critérios de aceite (Claude usa pra review)

- [ ] `diagnosis.md` presente em `.planning/phases/workstream-D/` com decisões de #49.
- [ ] `implementer/sandbox.toml` corrigido para level=1 sem `/workspace` hardcoded.
- [ ] `allowed_writes=[]` behavior verificado e documentado.
- [ ] Testes provam que implementer em level=1 consegue escrever no workspace real.
- [ ] Se bwrap foi wired (#49): teste de confinamento OS-level.
- [ ] Se bwrap NÃO foi wired: log explícito + comentário em código + issue #49 permanece aberto.
- [ ] `bun run ci` clean.
- [ ] Nenhuma mudança em auth, events, DB schema.
- [ ] PR marcado como `ready-to-merge, guarded` — não mergeado sem operador.
