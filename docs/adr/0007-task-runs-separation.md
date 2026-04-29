# ADR 0007 — Separação `tasks` (intenção) vs `task_runs` (tentativa)

- **Status:** Accepted
- **Date:** 2026-04-29
- **Decisores:** @Incavenuziano

## Contexto

A v3 do `ARCHITECTURE.md` propunha tabela `tasks` única misturando: intenção (prompt,
agent, working_dir), estado de execução (status, started_at, finished_at), e resultado
(result, error). Esse design tem 3 problemas:

1. **Idempotência quebrada** — UPDATE de status sobrescreve tentativas anteriores.
   Falha + retry perde histórico do erro original.
2. **Sem lease/heartbeat** — não há como detectar worker zumbi (kill -9 mid-task)
   além de timeouts ad-hoc.
3. **Audit incompleto** — múltiplas tentativas com erros distintos (rede, quota,
   sandbox) ficam impossíveis de reconstruir.

Padrão estabelecido em sistemas de fila confiáveis (Sidekiq, Oban, Postgres SKIP LOCKED):
intenção é imutável; tentativas são append-only.

## Decisão

Schema dividido em duas tabelas com responsabilidades distintas:

**`tasks` — intenção, IMUTÁVEL após INSERT:**
- `id`, `priority`, `prompt`, `agent`, `session_id`, `working_dir`, `depends_on`,
  `source`, `source_metadata`, `dedup_key`, `created_at`.
- Receiver insere; **ninguém** faz UPDATE (trigger SQLite reforça).

**`task_runs` — cada tentativa de execução:**
- `id`, `task_id` FK, `attempt_n`, `worker_id`, `status`, `lease_until`, `started_at`,
  `finished_at`, `result`, `error`, `msgs_consumed`.
- UNIQUE `(task_id, attempt_n)` — uma row por tentativa.
- Worker INSERT em estado `pending`/`running`, UPDATE somente colunas mutáveis durante
  execução (`lease_until`), final UPDATE pra `succeeded`/`failed`/`abandoned`.

**Reconciliação no startup do worker:**
```sql
SELECT id FROM task_runs
WHERE status = 'running'
  AND lease_until < datetime('now');
```
Para cada `task_run` zumbi: marca `abandoned`, registra `events.kind='lease_expired'`,
INSERT novo `task_runs` com `attempt_n+1` em `pending`.

## Consequências

**Positivas**
- **Audit completo** — todas as tentativas preservadas, com cause-of-failure por attempt.
- **Lease/heartbeat resolve worker zumbi** — kill -9 mid-task → próximo startup detecta
  em ≤30s e re-enfileira sem intervenção manual.
- **Idempotência forte** — INSERT em `tasks` com `dedup_key` UNIQUE bloqueia replay;
  INSERT em `task_runs` com `(task_id, attempt_n)` UNIQUE bloqueia race entre workers.
- **Estatísticas reais** — taxa de retry, distribuição de erros, latência por tentativa
  são queries triviais.
- Padrão familiar a quem viu Sidekiq/Oban — fácil de explicar.

**Negativas**
- 2 tabelas em vez de 1 — joins em queries comuns (resultado da última tentativa).
  Mitigado por view `latest_task_runs`.
- Disco: cada retry adiciona row em `task_runs`. Cleanup mensal mantém ≤90 dias hot
  (BEST_PRACTICES §6.9).
- State machine de `task_runs.status` precisa ser respeitada (validada em
  `src/state/transitions.ts`) — disciplina extra no worker.

**Neutras**
- Implementação requer trigger SQLite pra reforçar imutabilidade de `tasks`. Trivial.

## Alternativas consideradas

- **Tabela `tasks` única (v3 original)** — descartada (motivos acima).
- **`task_attempts` em vez de `task_runs`** — sinônimo, escolha de naming. `task_runs`
  alinha com terminologia de orchestration (Airflow, Dagster).
- **Soft delete + status na mesma row** — não resolve o problema de auditoria de
  múltiplas tentativas.

## Referências

- `ARCHITECTURE.md` §11.2 (schema completo).
- `BEST_PRACTICES.md` §4.4 (lease/heartbeat reconciliation).
- `BLUEPRINT.md` §2.1 (`Task` e `TaskRun` interfaces, `TASK_RUN_TRANSITIONS`).
- Padrão de Oban — https://hexdocs.pm/oban/Oban.html#module-overview
- Postgres SKIP LOCKED — https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE
