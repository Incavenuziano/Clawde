# Clawde — Backlog (Fases 1–3)

> Tasks atômicas (1 commit cada, S=≤30min, M=≤2h, L=≤4h). Padrão derivado de
> `superpowers/skills/writing-plans/SKILL.md` — TDD red-green-refactor sempre que
> aplicável. Fases 4–9 ficam como roadmap em `ARCHITECTURE.md` §12; serão detalhadas
> após Fase 3 estar verde.

## Convenções

- **ID:** `F<fase>.T<seq>`, ex: `F1.T01`.
- **Estimate:** S / M / L conforme acima.
- **Depends:** IDs que devem estar `done` antes desta começar.
- **DoD (Definition of Done):** critério verificável; sem opinião subjetiva.
- **Files:** caminhos primários a tocar (pode haver outros menores).
- **Risks:** o que pode travar; 1 linha cada.
- **Status:** `todo` | `in-progress` | `blocked` | `done`. Atualizado conforme andamento
  no PR de cada task.

Cada task vira **1 PR** (squash-mergeable) com commit `<type>(<scope>): <id> <subject>`.

==================================================================

## Fase 1 — Schema + migrations + repositórios (foundation)

**Objetivo:** `state.db` criado com schema completo, migrations idempotentes, repositórios
tipados acessíveis via `bun test`. Nada de SDK Claude ainda.

**Saída:** `bun test` 100% verde, `clawde migrate up` aplica e `PRAGMA integrity_check`
retorna `ok`.

### F1.T01 — Bootstrap do repo (S)
- **Depends:** —
- **Files:** `package.json`, `bunfig.toml`, `tsconfig.json`, `biome.json`, `.gitignore`,
  `.editorconfig`
- **DoD:**
  - `bun --version` mínimo declarado em `package.json` engines.
  - `tsc --noEmit` (strict, NodeNext) passa em repo vazio.
  - `bun test` roda 0 testes sem erro.
  - `biome check` passa.
- **Risks:** versão de Bun em CI não bate com local — pin via `.bun-version`.

### F1.T02 — Tree de pastas vazio + smoke test "hello" (S)
- **Depends:** F1.T01
- **Files:** `src/{domain,db,worker,receiver,sdk,hooks,memory,quota,sandbox,auth,log,config,cli,adapters}/index.ts` (re-exports vazios), `tests/unit/smoke.test.ts`
- **DoD:**
  - Cada subpasta de `src/` tem `index.ts` com `export {}` (placeholder).
  - `tests/unit/smoke.test.ts` afirma `1 + 1 === 2` e passa.
  - Path alias `@clawde/*` resolve em `tsconfig.json` + `bunfig.toml`.

### F1.T03 — Domain: Task, TaskRun, Priority, transitions (S)
- **Depends:** F1.T02
- **Files:** `src/domain/task.ts`, `tests/unit/domain/task.test.ts`
- **DoD:**
  - Tipos `Task`, `NewTask`, `TaskRun`, `Priority`, `TaskRunStatus`, `TaskSource` exportados
    conforme `BLUEPRINT.md` §2.1.
  - `TASK_RUN_TRANSITIONS` constante.
  - Test: cada transição válida em `TASK_RUN_TRANSITIONS` é mapeada; transição inválida
    NÃO aparece.

### F1.T04 — Domain: Session + deriveSessionId (UUID v5) (S)
- **Depends:** F1.T03
- **Files:** `src/domain/session.ts`, `src/domain/uuid.ts`, `tests/unit/domain/session.test.ts`
- **DoD:**
  - `Session`, `SessionState`, `SESSION_TRANSITIONS` exportados.
  - `deriveSessionId({agent, workingDir})` é determinístico (test: mesma entrada → mesmo
    UUID; entrada diferente → UUID diferente).
  - Namespace UUID v5 fixo em `src/domain/uuid.ts`.

### F1.T05 — Domain: Event + EventKind union (S)
- **Depends:** F1.T03
- **Files:** `src/domain/event.ts`, `tests/unit/domain/event.test.ts`
- **DoD:**
  - `Event`, `NewEvent`, `EventKind` (todos os 26 kinds do BLUEPRINT §2.3) exportados.
  - Test: `EventKind` cobre 100% dos kinds listados em `BEST_PRACTICES.md` §6.3.

### F1.T06 — Domain: Quota types (S)
- **Depends:** F1.T03
- **Files:** `src/domain/quota.ts`, `tests/unit/domain/quota.test.ts`
- **DoD:**
  - `Plan`, `QuotaState`, `QuotaLedgerEntry`, `QuotaWindow` exportados.
  - Interface `QuotaPolicy.canAccept` declarada (impl vem em F2).
  - Test: tipos compilam em uso típico (samples).

### F1.T07 — Domain: Memory + Workspace (S)
- **Depends:** F1.T03
- **Files:** `src/domain/memory.ts`, `src/domain/workspace.ts`,
  `tests/unit/domain/memory.test.ts`
- **DoD:**
  - `MemoryObservation`, `ObservationKind`, `MemorySearchResult`, `Workspace` exportados.
  - Domain index re-exporta todos os tipos.

### F1.T08 — DB client (bun:sqlite + PRAGMAs) (M)
- **Depends:** F1.T02
- **Files:** `src/db/client.ts`, `tests/unit/db/client.test.ts`
- **DoD:**
  - `openDb(path)` configura `journal_mode=WAL`, `busy_timeout=5000`,
    `synchronous=NORMAL`, `foreign_keys=ON`.
  - `closeDb(db)` faz checkpoint WAL.
  - Test: open in-memory DB, run PRAGMA queries, valida valores.
  - `:memory:` path é suportado e isolado por test.

### F1.T09 — Migration 001 SQL (up + down) (M)
- **Depends:** F1.T08
- **Files:** `src/db/migrations/001_initial.up.sql`, `src/db/migrations/001_initial.down.sql`
- **DoD:**
  - `.up.sql` cria todas as tabelas + índices + FTS5 + triggers de append-only conforme
    `ARCHITECTURE.md` §11.2.
  - `.down.sql` remove tudo (`DROP TABLE IF EXISTS` em ordem reversa de dependência).
  - Aplicar `.up.sql` em DB vazio; rodar `PRAGMA integrity_check` retorna `ok`.

### F1.T10 — Migration runner (M)
- **Depends:** F1.T09
- **Files:** `src/db/migrations/runner.ts`, `src/db/migrations/index.ts`,
  `tests/unit/db/migrations.test.ts`
- **DoD:**
  - `applyPending(db, dir)` lê `*.up.sql` em ordem numérica, aplica em transação, atualiza
    `_migrations(version, applied_at)`.
  - `rollback(db, target)` aplica `.down.sql` até atingir `target`.
  - Aplicar 2x consecutivas é idempotente (segunda chamada não faz nada).
  - Test: aplicar, rollback total, aplicar de novo — schema final byte-idêntico (compara
    `sqlite_schema`).

### F1.T11 — Migration roundtrip property test (S)
- **Depends:** F1.T10
- **Files:** `tests/property/migration-roundtrip.test.ts`
- **DoD:**
  - Para toda migration N existente: `up(N) → down(N) → up(N)` produz schema idêntico.
  - Test usa `fast-check` para gerar ordens de aplicação.

### F1.T12 — Repository: tasks (M)
- **Depends:** F1.T10, F1.T03
- **Files:** `src/db/repositories/tasks.ts`, `tests/unit/db/tasks.repo.test.ts`
- **DoD:**
  - Métodos: `insert(NewTask)`, `findById(id)`, `findPending(limit)`,
    `findByDedupKey(key)`.
  - INSERT com `dedupKey` duplicada lança `DedupConflictError` (mapeado de SQLITE_CONSTRAINT).
  - Imutabilidade: trigger `events_no_update` e `events_no_delete` previnem alterações
    indevidas.
  - Test cobre: insert, dedup conflict, findPending ordenado por priority+created_at.

### F1.T13 — Repository: task_runs + lease (M)
- **Depends:** F1.T12
- **Files:** `src/db/repositories/task-runs.ts`, `tests/unit/db/task-runs.repo.test.ts`
- **DoD:**
  - Métodos: `insert(taskId, attemptN, workerId)`, `acquireLease(id, leaseSeconds)`,
    `heartbeat(id, leaseSeconds)`, `transitionStatus(id, to)`,
    `findExpiredLeases()`, `findLatestByTaskId(taskId)`.
  - `transitionStatus` valida transição via `TASK_RUN_TRANSITIONS`; transição inválida
    lança erro tipado.
  - Test cobre: lease acquire/heartbeat/expiry, transição válida/inválida, UNIQUE
    `(task_id, attempt_n)`.

### F1.T14 — Repository: sessions (M)
- **Depends:** F1.T10, F1.T04
- **Files:** `src/db/repositories/sessions.ts`, `tests/unit/db/sessions.repo.test.ts`
- **DoD:**
  - Métodos: `upsert(Session)`, `findById(sessionId)`, `transitionState(id, to)`,
    `listByState(state)`, `markUsed(id)` (atualiza `last_used_at`, incrementa `msg_count`).
  - Test: transições válidas conforme `SESSION_TRANSITIONS`, listagem por estado.

### F1.T15 — Repository: events (append-only) (M)
- **Depends:** F1.T10, F1.T05
- **Files:** `src/db/repositories/events.ts`, `tests/unit/db/events.repo.test.ts`
- **DoD:**
  - Métodos: `insert(NewEvent)`, `queryByTaskRun(id)`, `queryByTrace(traceId)`,
    `queryByKind(kind, since)`.
  - UPDATE/DELETE em `events` lançam erro (trigger SQLite).
  - Test: UPDATE direto via `db.run` falha com mensagem do trigger.

### F1.T16 — Repository: quota_ledger (M)
- **Depends:** F1.T10, F1.T06
- **Files:** `src/db/repositories/quota-ledger.ts`,
  `tests/unit/db/quota-ledger.repo.test.ts`
- **DoD:**
  - Métodos: `insert(entry)`, `currentWindow(now)`, `totalConsumed(windowStart)`,
    `findRecent(limit)`.
  - `currentWindow` usa rounding pra hora cheia UTC do `windowStart`.
  - Test: ledger acumula corretamente em janela; janela rola após 5h.

### F1.T17 — Repository: memory + FTS5 search (M)
- **Depends:** F1.T10, F1.T07
- **Files:** `src/db/repositories/memory.ts`, `tests/unit/db/memory.repo.test.ts`
- **DoD:**
  - Métodos: `insertObservation(NewObservation)`, `searchFTS(query, limit)`.
  - Insert popula `memory_fts` automaticamente via trigger ou explicit insert.
  - Test: insert PT-BR + EN, search trigram retorna ambas com score.

### F1.T18 — State transitions module (S)
- **Depends:** F1.T03, F1.T04
- **Files:** `src/state/transitions.ts`, `tests/unit/state/transitions.test.ts`
- **DoD:**
  - `validateTaskRunTransition(from, to)` retorna `Ok | InvalidTransitionError`.
  - `validateSessionTransition(from, to)` idem.
  - Reusada por repositories (refator de F1.T13/F1.T14).

### F1.T19 — `clawde migrate` CLI subset (S)
- **Depends:** F1.T10
- **Files:** `src/cli/commands/migrate.ts`, `src/cli/main.ts` (esqueleto), `tests/integration/cli-migrate.test.ts`
- **DoD:**
  - `clawde migrate up` aplica pendentes; output JSON via `--output json`.
  - `clawde migrate status` mostra current vs latest.
  - `clawde migrate down --target N --confirm` rollback.
  - Test E2E: bun script invoca CLI binary.

### F1.T20 — Integração: schema completo + integrity_check (S)
- **Depends:** F1.T10–F1.T17
- **Files:** `tests/integration/db-roundtrip.test.ts`
- **DoD:**
  - Aplica todas migrations, popula 5 tasks + 10 task_runs + 50 events + 20 messages
    + 30 observations.
  - `PRAGMA integrity_check` retorna `ok`.
  - Queries das views/repos retornam dados consistentes.
  - Tempo total <2s.

==================================================================

## Fase 2 — Worker oneshot via Agent SDK + sessão continuada

**Objetivo:** worker processa 1 task end-to-end usando `@anthropic-ai/claude-agent-sdk`,
persiste `task_runs`, `quota_ledger`, `events` e `messages`, e termina.
Sub-agentes ainda não — só agente "default" simples.

**Saída:** `clawde queue "test"` + worker oneshot processa 1 task; logs estruturados
em `events` + journald; `bun test integration` 100% verde com SDK mockado; smoke test
manual com SDK real consome ≤1 mensagem da quota.

### F2.T21 — Logger estruturado + redact (M)
- **Depends:** F1.T05
- **Files:** `src/log/logger.ts`, `src/log/redact.ts`, `src/log/secrets.ts`,
  `src/log/trace.ts`, `tests/unit/log/*`
- **DoD:**
  - `createLogger(ctx)` retorna `{trace, debug, info, warn, error, fatal}`.
  - Output JSON one-line conforme `BEST_PRACTICES.md` §6.2.
  - `redact(obj)` mascara chaves listadas em `secrets.ts` (token patterns, PII).
  - Test: payload com `{token: "sk-ant-..."}` → log final tem `{token: "[REDACTED]"}`.
  - `newTraceId()` gera ULID; propaga via `AsyncLocalStorage`.

### F2.T22 — Config loader (zod schema + TOML) (M)
- **Depends:** F1.T02
- **Files:** `src/config/{load,schema,defaults}.ts`, `tests/unit/config/*`,
  `deploy/config-example/clawde.toml`
- **DoD:**
  - Parse `~/.clawde/config/clawde.toml` (override via `CLAWDE_CONFIG` env).
  - Validação com `zod` conforme `BLUEPRINT.md` §7.1.
  - Defaults aplicados quando chave ausente.
  - `clawde config show` mostra resolved.
  - Test: TOML inválido → erro com `path` e `message` claros (não exception bruta).

### F2.T23 — SDK wrapper: invoke + stream (M)
- **Depends:** F1.T14, F2.T21
- **Files:** `src/sdk/{client,stream,parser}.ts`, `tests/unit/sdk/*`
- **DoD:**
  - `createAgent({sessionId, allowedTools, maxTurns, hooks})` retorna client tipado.
  - `agent.stream({prompt})` async iterator de `Message`.
  - Mock do SDK em `tests/mocks/sdk-mock.ts` (emula stream-json).
  - Reuso de `ParsedObservation`/`ParsedSummary` do `claude-mem/src/sdk/parser.ts`.
  - Test: mock emite 3 messages → iterator entrega 3.

### F2.T24 — Hooks pipeline básico (M)
- **Depends:** F2.T23, F1.T15
- **Files:** `src/hooks/{session-start,user-prompt-submit,pre-tool-use,post-tool-use,stop}.ts`,
  `tests/unit/hooks/*`
- **DoD:**
  - Cada hook conforme contratos do `BLUEPRINT.md` §4.
  - Default behavior: registra `event` apropriado, não bloqueia.
  - `UserPromptSubmit` chama `prompt-guard` (T36) — se ausente nesta fase, vira no-op.
  - Hook timeout (`hooks.toml.on_timeout`) respeitado.

### F2.T25 — Quota policy: canAccept (S)
- **Depends:** F1.T16, F2.T22
- **Files:** `src/quota/{policy,thresholds,peak-hours}.ts`, `tests/unit/quota/*`
- **DoD:**
  - `canAccept(window, priority)` implementa matriz do `ARCHITECTURE.md` §6.6.
  - Reserve `URGENT` 15% configurável.
  - Peak hours multiplier 1.7 default (TZ from config).
  - Test: cobre todas bordas (60/80/95/100%, normal vs peak, cada priority).

### F2.T26 — Quota ledger update após cada msg (S)
- **Depends:** F2.T23, F2.T25
- **Files:** `src/quota/ledger.ts`, `tests/unit/quota/ledger.test.ts`
- **DoD:**
  - Wrapper em torno de `agent.stream` decrementa ledger por message processed.
  - Janela ativa identificada via `quota_ledger` repo.
  - Peak multiplier aplicado ao decremento conforme TZ atual.
  - Test: 3 messages mock → ledger tem 3 entries.

### F2.T27 — Workspace ephemeral (git worktree) (M)
- **Depends:** F1.T07
- **Files:** `src/worker/workspace.ts`, `tests/integration/workspace.test.ts`
- **DoD:**
  - `createWorkspace(taskRunId, baseBranch)` cria `/tmp/clawde-<id>` via
    `git worktree add`.
  - `removeWorkspace(workspace)` limpa via `git worktree remove --force`.
  - Branch criada: `clawde/<task_id>-<slug>`.
  - Reconcile: worktrees órfãs (sem `task_run` em `running`) são removidas no startup.
  - Test integration usa repo bare temporário.

### F2.T28 — Lease manager (S)
- **Depends:** F1.T13
- **Files:** `src/worker/lease.ts`, `tests/unit/worker/lease.test.ts`
- **DoD:**
  - `acquire(taskRunId, leaseSeconds)` é atômico (UPDATE com cláusula `WHERE
    lease_until IS NULL OR lease_until < datetime('now')`).
  - `heartbeat(taskRunId, leaseSeconds)` extende.
  - `release(taskRunId, finalStatus)` finaliza com transição válida.
  - Test: 2 workers concorrentes → apenas 1 acquire.

### F2.T29 — Reconcile no startup (S)
- **Depends:** F2.T28, F1.T13
- **Files:** `src/worker/reconcile.ts`, `tests/integration/reconcile.test.ts`
- **DoD:**
  - Lê `task_runs` em `running` com `lease_until < now`.
  - Para cada: `transitionStatus → abandoned`, `events.kind='lease_expired'`,
    INSERT novo `task_runs` com `attempt_n+1`.
  - Test integration: simula kill -9 (insere row em `running` com lease expirado),
    chama reconcile, verifica re-enqueue.

### F2.T30 — Worker main: end-to-end (L)
- **Depends:** F2.T22–T29
- **Files:** `src/worker/main.ts`, `src/worker/runner.ts`,
  `tests/integration/worker.test.ts`
- **DoD:**
  - Entrypoint: lê config → reconcile → seleciona próxima task pending → acquire lease
    → setup workspace → invoca SDK → persiste messages + events + quota → libera lease
    com `succeeded`/`failed` → cleanup workspace.
  - Heartbeat em background a cada `heartbeat_seconds`.
  - Logs estruturados em todos os pontos de §6.3 do `BEST_PRACTICES.md`.
  - Test integration com SDK mock: 1 task pending → após worker run, `task_runs` em
    `succeeded`, `events` tem `task_start`+`task_finish`, ledger atualizado.
  - Tempo total <2s no test.

### F2.T31 — Smoke test command (S)
- **Depends:** F2.T22, F1.T19
- **Files:** `src/cli/commands/smoke-test.ts`, `tests/integration/smoke-test.test.ts`
- **DoD:**
  - Implementa checklist do `BEST_PRACTICES.md` §5.5: CLI version, JSON ping,
    receiver health, integrity_check, worker dry-run.
  - Exit 0 ok, 1 fail; output legível em texto + JSON via `--output json`.
  - Test mocka cada subverificação.

### F2.T32 — Systemd units: worker (S)
- **Depends:** F2.T30
- **Files:** `deploy/systemd/clawde-worker.service`,
  `deploy/systemd/clawde-worker.path`,
  `deploy/systemd/clawde-smoke.service`, `deploy/systemd/clawde-smoke.timer`
- **DoD:**
  - `.service` com hardening Nível 1 conforme ADR 0005.
  - `.path` watcha `state.db` mtime → dispara `.service`.
  - `.timer` smoke diário às 04:00 local.
  - `systemd-analyze security clawde-worker.service` score ≤2.0.
  - `systemd-analyze verify` em todos os arquivos passa.

### F2.T33 — Sandbox Nível 1 (systemd-only) integrado (S)
- **Depends:** F2.T32
- **Files:** `src/sandbox/systemd.ts`, `tests/integration/sandbox-level-1.test.ts`
- **DoD:**
  - Worker gera/valida unit file conforme matriz do ADR 0005.
  - Test E2E (em CI Linux): worker rodando dentro do unit não consegue ler
    `~/.ssh/` (paths fora de `ReadWritePaths`).
  - Bwrap/netns vêm em fase 4 (não nesta fase).

==================================================================

## Fase 3 — receiver + adapter CLI local

**Objetivo:** `clawde-receiver` always-on enfileira via HTTP/unix-socket; CLI local
`clawde queue` é o primeiro adapter completo. Telegram/GitHub adapters ficam pra Fase 6.

**Saída:** `clawde queue "test"` insere task → systemd `.path` dispara worker em ≤1s →
task processa → `clawde logs --task <id>` mostra trail completo.

### F3.T34 — Receiver server (Bun.serve TCP + unix socket) (M)
- **Depends:** F2.T22, F2.T21
- **Files:** `src/receiver/server.ts`, `tests/integration/receiver-server.test.ts`
- **DoD:**
  - `Bun.serve()` em `127.0.0.1:18790` (TCP) E `/run/clawde/receiver.sock` (unix).
  - SIGTERM → drain (recusa novos com 503, completa em-flight) + close DB clean.
  - SIGHUP → reload config.
  - Test: spawn receiver, conecta via TCP, fecha — sem leak.

### F3.T35 — Endpoint /health (S)
- **Depends:** F3.T34, F1.T08
- **Files:** `src/receiver/routes/health.ts`, `tests/integration/health.test.ts`
- **DoD:**
  - `GET /health` retorna `200 {ok: true, db: 'ok', quota: 'normal', version}`.
  - DB `integrity_check` falhou → `503 {ok: false, reason: 'db_corrupted', details}`.
  - Quota `esgotado` → `503 reason: 'quota_exhausted'`.
  - Sem auth (cf. BLUEPRINT §3.1).
  - Test cobre os 3 caminhos.

### F3.T36 — Auth: HMAC + unix socket fs perms (M)
- **Depends:** F3.T34
- **Files:** `src/receiver/auth/hmac.ts`, `src/receiver/auth/unix-perms.ts`,
  `tests/security/webhook-auth.test.ts`
- **DoD:**
  - `verifyTelegramSecret(req, secret)` checa `X-Telegram-Bot-Api-Secret-Token`.
  - `verifyGitHubHmac(req, secret)` checa `X-Hub-Signature-256` (constant-time compare).
  - Unix socket: chmod 0660 + group ownership configurável; reject se peer não está no
    group (`SO_PEERCRED`).
  - 401 registra `events.kind='auth_fail'`.
  - Test: header inválido/ausente → 401; correto → 202.

### F3.T37 — Rate limit (token bucket em memória) (S)
- **Depends:** F3.T34
- **Files:** `src/receiver/auth/rate-limit.ts`, `tests/unit/rate-limit.test.ts`
- **DoD:**
  - Bucket por origem (IP remoto): 10/min, 100/h.
  - Excedido → 429 + `Retry-After` header.
  - Health endpoint isento.
  - Test: 11 requests no mesmo segundo do mesmo IP → 11ª é 429.

### F3.T38 — Dedup (idempotency_key) (S)
- **Depends:** F1.T12, F3.T34
- **Files:** `src/receiver/dedup.ts`, `tests/integration/dedup.test.ts`
- **DoD:**
  - INSERT com `dedup_key` UNIQUE; segunda chamada → 409 `{deduped: true, taskId}`.
  - `events.kind='dedup_skip'` registrado.
  - Header `X-Idempotency-Key` aceito como alternativa a `body.dedupKey`.
  - Test: 2 enqueues com mesma key → segundo retorna 409 com mesmo taskId.

### F3.T39 — Endpoint /enqueue (M)
- **Depends:** F3.T35–T38
- **Files:** `src/receiver/routes/enqueue.ts`,
  `tests/integration/enqueue.test.ts`
- **DoD:**
  - `POST /enqueue` valida payload via zod (`EnqueueRequest` do BLUEPRINT §3.1).
  - 400 se inválido; 202 com `{taskId, traceId, deduped}` se ok.
  - INSERT em `tasks` toca `state.db` mtime → systemd `.path` dispara worker.
  - Test E2E: HTTP POST → worker fires (em test, mock systemd unit).

### F3.T40 — Systemd unit: receiver (S)
- **Depends:** F3.T34
- **Files:** `deploy/systemd/clawde-receiver.service`
- **DoD:**
  - Hardening Nível 1.
  - `Restart=on-failure RestartSec=10s`.
  - `LoadCredential=oauth-token:/etc/clawde/credentials/oauth_token`.
  - `systemd-analyze verify` passa.

### F3.T41 — CLI bootstrap + parsing (S)
- **Depends:** F1.T19
- **Files:** `src/cli/main.ts`, `src/cli/output.ts`,
  `tests/integration/cli-bootstrap.test.ts`
- **DoD:**
  - Subcomandos descobríveis via `--help`.
  - `--output {text|json}` global.
  - Exit codes conforme BLUEPRINT §6.2 (0/1/2/3/4/5).
  - TTY detect → cores; pipe → sem cores.
  - Test: `clawde --help` retorna 0; `clawde foo` retorna 1.

### F3.T42 — CLI: queue (M)
- **Depends:** F3.T39, F3.T41
- **Files:** `src/cli/commands/queue.ts`,
  `tests/integration/cli-queue.test.ts`
- **DoD:**
  - `clawde queue [opts] <prompt>` faz POST no unix socket do receiver.
  - Flags: `--priority`, `--agent`, `--session-id`, `--working-dir`, `--depends-on`,
    `--dedup-key`.
  - Stdout: taskId em texto; JSON com `{taskId, traceId, deduped}` se `--output json`.
  - Receiver indisponível → exit 2 com mensagem clara em stderr.
  - Test E2E: spawn receiver, invoca `clawde queue`, verifica row em `tasks`.

### F3.T43 — CLI: logs (M)
- **Depends:** F1.T15, F3.T41
- **Files:** `src/cli/commands/logs.ts`, `tests/integration/cli-logs.test.ts`
- **DoD:**
  - `clawde logs --task <id>` retorna events ordenados por ts.
  - `--trace <ulid>`, `--since <duration>`, `--level`, `--kind` filtram.
  - `--follow` faz tail (poll DB a cada 500ms).
  - Test cobre filtros + tail.

### F3.T44 — CLI: trace + quota status (S)
- **Depends:** F3.T43
- **Files:** `src/cli/commands/trace.ts`, `src/cli/commands/quota.ts`,
  `tests/integration/cli-trace-quota.test.ts`
- **DoD:**
  - `clawde trace <ulid>` consolida events+messages cronologicamente.
  - `clawde quota status` mostra estado atual da janela com cores
    (verde/amarelo/vermelho).
  - `clawde quota history` últimas 30 janelas.
  - Test snapshot do output.

### F3.T45 — CLI: smoke-test wire (S)
- **Depends:** F3.T41, F2.T31
- **Files:** atualização em `src/cli/commands/smoke-test.ts`
- **DoD:**
  - Comando smoke-test agora consulta receiver health real (não mais mock).
  - Test integration: spawn receiver + invoca smoke-test → exit 0.

### F3.T46 — E2E: queue → worker → result (M)
- **Depends:** F3.T42, F2.T30, F2.T32
- **Files:** `tests/e2e/lifecycle.test.ts`
- **DoD:**
  - Setup: receiver + worker (com SDK mockado) + `state.db` temporário + systemd
    `.path` simulado.
  - `clawde queue "echo hello"` → task INSERT → `state.db` mtime mudou → script
    simula `.path` trigger → worker oneshot fires → task processa.
  - Verificações: `tasks.id` existe; `task_runs.status='succeeded'`; `events`
    contém `enqueue`, `task_start`, `task_finish`; `quota_ledger` decrementado.
  - Tempo total <5s.

==================================================================

## Roadmap (Fases 4–9, alta granularidade — detalhado quando Fase 3 estiver verde)

| Fase | Tema | Saída esperada |
|------|------|----------------|
| **4** | Sandbox Níveis 2 e 3 (bwrap, netns) | Worker invoca via bwrap; matriz por agente carregada de `sandbox.toml` |
| **5** | Memória nativa **+ aprendizado** (indexer + hooks + reflexão + memory-aware prompting) | Tasks F5.T47–T55 detalhadas abaixo |
| **6** | Telegram adapter + sanitize | Bot grammy enfileira via `external_input` wrapper; prompt-guard ativo |
| **7** | OAuth refresh proativo + Datasette | `clawde-oauth-check.timer`; dashboard read-only em :8001 |
| **8** | Multi-host (Litestream) | `state.db` replicado pra B2/S3; laptop+server compartilham fila |
| **9** | Two-stage review pipeline | Sub-agentes implementer/spec-reviewer/code-quality-reviewer/verifier ativos pra tasks `priority>=NORMAL` |

==================================================================

## Fase 5 — Memória nativa + aprendizado (detalhada)

**Objetivo:** memória deixa de ser arquivo morto. Reflection layer extrai lições, memory-aware
prompting injeta contexto relevante automaticamente em cada invocação. Implementa ADR 0009 + 0010.

**Saída:** `clawde reflect now` gera lições verificáveis; toda task `priority>=NORMAL` recebe
top-K observations como `<prior_context>`; `clawde memory search "X"` retorna mix FTS5 +
embedding (se ligado) com score por importance.

### F5.T47 — JSONL batch indexer (M)
- **Depends:** F1.T17 (memory repo), F2.T22 (config)
- **Files:** `src/memory/jsonl-indexer.ts`, `tests/integration/jsonl-indexer.test.ts`
- **DoD:**
  - Lê `~/.claude/projects/<hash>/*.jsonl` append-only, parseia entries, popula
    `memory_observations` com `kind='observation'`.
  - Reindex idempotente: rerun não duplica (dedup via `(source_jsonl, line_offset)` UNIQUE).
  - Tolera linhas truncadas (último append em curso) — pula sem erro.
  - Test fixture: 50MB JSONL → indexer roda <30s; rerun = 0 linhas novas.

### F5.T48 — Embedding service (multilingual-e5-small) (M)
- **Depends:** F5.T47, ADR 0010
- **Files:** `src/memory/embeddings.ts`, `tests/integration/embeddings.test.ts`
- **DoD:**
  - `embed(text): Float32Array(384)` via `@xenova/transformers` carregando
    `Xenova/multilingual-e5-small`.
  - Lazy load: modelo só baixa/carrega na 1ª chamada.
  - Cache LRU de embeddings recentes (cap 1000 entries) pra evitar recomputar.
  - Configurável: `memory.embeddings_enabled = false` desliga sem erros.
  - Test: PT-BR + EN inputs retornam vetores com cosine similarity razoável (smoke).

### F5.T49 — sqlite-vec integration + híbrida search (M)
- **Depends:** F5.T48, F1.T17
- **Files:** `src/memory/search.ts`, `tests/integration/memory-search.test.ts`,
  migration `002_add_embeddings.up.sql`
- **DoD:**
  - Migration adiciona `memory_observations.embedding BLOB(3072)` + `importance REAL DEFAULT 0.5`.
  - Search híbrida: FTS5 (BM25) + cosine via sqlite-vec, ranking unificado por RRF.
  - Score boost por `importance` (multiplicador configurável).
  - Test: índice 100 obs PT-BR + EN; query retorna top-5 com scores monotônicos.

### F5.T50 — Hooks PostToolUse/Stop persistem observations (S)
- **Depends:** F2.T24 (hooks pipeline), F1.T17
- **Files:** atualização em `src/hooks/post-tool-use.ts`, `src/hooks/stop.ts`,
  `tests/integration/hooks-memory.test.ts`
- **DoD:**
  - `PostToolUse` extrai `(toolName, summary, exitCode)` e insere `memory_observations`
    com `kind='observation'`.
  - `Stop` insere `kind='summary'` com `finalText` truncado.
  - Embedding gerado se `memory.embeddings_enabled=true`.
  - Test: hook fires → row em `memory_observations` + (opcional) embedding presente.

### F5.T51 — Reflector sub-agent + clawde-reflect job (M)
- **Depends:** F5.T50, F2.T30 (worker)
- **Files:** `.claude/agents/reflector/AGENT.md`, `.claude/agents/reflector/sandbox.toml`,
  `src/cli/commands/reflect.ts`, `deploy/systemd/clawde-reflect.{service,timer}`,
  `tests/integration/reflector.test.ts`
- **DoD:**
  - `AGENT.md` define role, prompt, allowedTools restritos a Read.
  - `clawde reflect now` enfileira task `URGENT` invocando `reflector` com janela
    `reflection.window_hours` (default 24).
  - Reflector lê `events` + `messages_fts` recentes, extrai padrões, retorna JSON
    com array de `{content, importance, source_observation_ids}`.
  - Worker persiste cada item como `memory_observations.kind='lesson'` + atualiza
    `consolidated_into` nas observations referenciadas.
  - Systemd timer roda a cada 6h (configurável).
  - Test integration: 20 observations sintéticas → reflector retorna ≥1 lesson coerente.

### F5.T52 — Importance scoring updater (S)
- **Depends:** F5.T51
- **Files:** `src/memory/importance.ts`, `tests/unit/importance.test.ts`
- **DoD:**
  - Parte do reflector: re-avalia `importance` de observations referenciadas em lessons
    novas (sobe score) e de observations sem matches recentes (desce score).
  - Score em [0.0, 1.0]; clamp explícito.
  - Test: simular cycles, verificar convergência (lessons mantêm score alto).

### F5.T53 — Memory-aware prompting (auto inject) (M)
- **Depends:** F5.T49, F2.T30
- **Files:** `src/worker/runner.ts` (atualização), `src/memory/inject.ts`,
  `tests/integration/memory-aware.test.ts`
- **DoD:**
  - Antes de invocar SDK, worker chama `searchMemory(taskContext, topK=N)` (N do AGENT.md
    ou default 5).
  - Top-K envelopados em `<prior_context source="clawde-memory">…</prior_context>` e
    injetados via `--append-system-prompt` do SDK.
  - Configurável por agente: `memoryAware: true|false` em AGENT.md frontmatter.
  - Cap de tokens injetados (`memory.max_inject_tokens` default 3000) — trunca por
    importance descendente.
  - Test: task com `memoryAware=true` recebe prior_context; `false` não recebe.

### F5.T54 — Pruning job (mensal) (S)
- **Depends:** F5.T52
- **Files:** `src/memory/prune.ts`, `deploy/systemd/clawde-prune.{service,timer}`,
  `tests/unit/prune.test.ts`
- **DoD:**
  - `clawde memory prune` deleta observations com `importance < 0.2 AND
    created_at < now()-90d AND kind != 'lesson'`.
  - Lessons NUNCA são apagadas (preserva aprendizado consolidado).
  - Dry-run (`--dry-run`) reporta sem deletar.
  - Systemd timer mensal.
  - Test: setup mix de obs/lessons; prune mantém lessons + obs recentes/important.

### F5.T55 — CLI: memory commands + e2e (S)
- **Depends:** F5.T49, F5.T51
- **Files:** `src/cli/commands/memory.ts`, `tests/e2e/memory-lifecycle.test.ts`
- **DoD:**
  - `clawde memory search "<query>" --top-k 5 --kind observation|lesson|all`
  - `clawde memory show <id>`
  - `clawde memory stats` (counts por kind + distribuição de importance)
  - `clawde memory prune --dry-run`
  - E2E: gera 5 sessões, indexa, roda reflector, busca lesson gerada, valida.

==================================================================

## Métricas de saúde do backlog

Auto-checks a manter:

- **Total de tasks Fase 1:** 20 (T01–T20).
- **Total de tasks Fase 2:** 13 (T21–T33).
- **Total de tasks Fase 3:** 13 (T34–T46).
- **Total de tasks Fase 5 (detalhada por ADR 0009):** 9 (T47–T55).
- **Soma fases detalhadas (1+2+3+5):** 55 tasks. Estimate distribution: ~6 L, ~28 M, ~21 S.
- **Fases 4, 6, 7, 8, 9 ainda em alto nível** — detalhadas após Fase 3 verde.
- **Critical path** (dependências encadeadas mais longas):
  - Fase 1: T01 → T02 → T08 → T09 → T10 → T20 (6 tasks).
  - Fase 2: T20 (Fase 1 done) → T22 → T23 → T24 → T30 → T33 (6 tasks).
  - Fase 3: T33 (Fase 2 done) → T34 → T39 → T42 → T46 (5 tasks).
- **Paralelismo possível dentro de Fase 1:** T03–T07 (domain types) podem ser feitas em
  paralelo após T02. T12–T17 (repos) podem ser feitas em paralelo após T10.

==================================================================

## Como o Clawde consome este backlog (uma vez auto-hospedado)

A partir da Fase 9 (two-stage review), tasks deste backlog viram input para o próprio
Clawde:

1. Operador (humano) seleciona próxima task `todo` cuja `Depends` está toda `done`.
2. `clawde queue --priority NORMAL --agent implementer "Implement F1.T08 conforme
   docs/BACKLOG.md"`.
3. Pipeline subagent (ADR 0004) gera código + spec review + quality review + verifier.
4. PR criado por bot, humano dá approval final.
5. Operador atualiza `Status: done` no backlog após merge.

Antes da Fase 9, operador implementa manualmente com Claude Code interactive.
