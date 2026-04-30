# ADR 0004 — Two-stage review obrigatório via subagents

- **Status:** Accepted
- **Date:** 2026-04-29
- **Decisores:** @Incavenuziano

## Contexto

Tasks complexas (geração de código, refactor, decisões arquiteturais) executadas por um
único agente Claude correm risco de:
- Implementar contra spec mal interpretada (sem caçar inconsistências).
- Aceitar próprio código sem auto-crítica (LLMs tendem a confirmar próprios outputs).
- Pular testes/edge cases por viés de "isso parece funcionar".

O repo `superpowers` (Incavenuziano) tem skill `subagent-driven-development` que resolve
isso com pipeline `implementer → spec-reviewer → code-quality-reviewer`. Padrão validado
em uso real e documentado como "ouro" na seção §4.5 do `ARCHITECTURE.md`.

`get-shit-done` (Incavenuziano) reforça com 20 agents especializados por papel
(researcher/planner/executor/debugger/verifier).

## Decisão

**Toda task complexa** (definida como `task.priority >= NORMAL` AND não-trivial) passa
por pipeline de subagents em estágios separados:

```
PR / task
   │
   ▼
implementer (Stage 1)            — escreve código + testes
   │
   ▼
spec-reviewer (Stage 2)          — valida vs spec, aponta gaps
   │   (rejeita N≤3x, loop)
   │
   ▼
code-quality-reviewer (Stage 3)  — lint, sec, perf, idiomatic
   │
   ▼
verifier (Final)                 — roda testes, valida cobertura
   │
   ▼
PR ready
```

Cada stage roda em **fresh context** (nova sessão Claude, não `--resume`). Saída do
estágio N é input do N+1. Loop limitado a 3 iterações entre Stage 1↔2 antes de escalar
como `task_run.status='failed'` com `error='review_loop_exhausted'`.

Tasks `LOW` (cleanup, indexing, smoke test) **podem** pular o pipeline — define-se em
`tasks.priority` no enqueue.

## Implementação — fresh-context invariants (T-058 / P2.4)

**Stages NUNCA herdam `task.sessionId` nem compartilham sessão entre si.** Cada stage
do pipeline ganha `sessionId` próprio derivado de:

```
deriveSessionId({
  agent: inv.role,                                    // implementer | spec-reviewer | code-quality-reviewer
  workingDir: workspaceOverride ?? task.workingDir,   // ou "/no-workspace"
  intent: `task-${task.id}-${inv.role}-attempt-${run.attemptN}`,
})
```

Consequências dessa derivação:

- Implementer não vê histórico anterior de spec-reviewer (anchor bias zero).
- Reviewers não compartilham contexto entre si (spec ≠ qualidade independentes).
- Retries (`attempt_n+1` após reconcile/falha) ganham novas sessões, garantindo que
  uma tentativa não envenene a seguinte.
- Stages do mesmo role dentro do mesmo `attempt_n` (ex: implementer chamado novamente
  após rejeição do spec-reviewer) reutilizam o mesmo `sessionId` (intent é determinístico),
  preservando contexto de iteração interna do role mas isolando entre roles.

`systemPrompt` do role (`ROLE_SYSTEM_PROMPTS[role]`) chega via `appendSystemPrompt` da
SDK — system content confiável — em vez de concatenado ao user prompt (T-059). Isso evita
contamination do user content e separa instrução curada (system) de iteração da task (user).

Validação em `tests/integration/review-fresh-context.test.ts`.

## Consequências

**Positivas**
- Reduz drasticamente bugs de "implementação aparentemente correta mas viola spec".
- Cada review é especialista (spec ≠ qualidade ≠ verificação) — separação de preocupações.
- Fresh context evita "anchor bias" do agente que escreveu o código.
- Audit trail completo: cada estágio gera `task_run` próprio (sub-agente roda como
  "task filha" enfileirada via `source='subagent'`).
- Padrão já provado em `superpowers` — não estamos inventando.

**Negativas**
- **3-4x mais quota consumida** por task complexa. Mitigação: tasks `LOW` pulam pipeline;
  quota policy em §6.6 ajusta.
- Latência ponta-a-ponta cresce (4 cold starts em vez de 1). Mitigação: pra perfil
  low-volume, latência total <2min ainda é aceitável.
- Loop entre Stage 1↔2 pode ficar caro se spec for ambígua. Mitigação: cap de 3 iterações.

**Neutras**
- Implementação requer DAG de dependências entre task_runs filhas (via `tasks.depends_on`).
  Já modelado no schema (BLUEPRINT §2.1).

## Alternativas consideradas

- **Single-agent com self-review** — descartado; LLMs não auto-criticam confiavelmente.
- **Two-stage somente (implementer + reviewer)** — opção mais leve, mas perde separação
  spec ≠ qualidade. Pode ser modo `--quick` no futuro se demanda surgir.
- **Review humano obrigatório em todo PR** — inviável pra solo dev; humano fica como
  approval final no GitHub PR (ver `BEST_PRACTICES.md` §11), não pra cada task.

## Referências

- `ARCHITECTURE.md` §4.5 (reuso de superpowers), §12 fase 9.
- `BEST_PRACTICES.md` §11.1.
- `BLUEPRINT.md` §5 (sub-agentes mínimos).
- `superpowers/skills/subagent-driven-development/` — fonte do padrão.
