# Clawde — Backlog Executável de Remediação

> Decomposição dos 21 itens de [CONSOLIDATED_FIX_PLAN.md](CONSOLIDATED_FIX_PLAN.md)
> em **~125 tasks atômicas** (5-30min cada). Cada task tem implementer sugerido,
> reviewer obrigatório (oposto), critério de aceite, dependências.
>
> **Não confundir com [docs/BACKLOG.md](docs/BACKLOG.md)** — aquele cobre fases
> de bootstrap (1-9, todas concluídas); este cobre remediação pós-auditorias
> independentes Codex+Claude (2026-04-29).

---

## Decisões fixadas (ratificadas pelo operador 2026-04-29)

1. **Sandbox**: Estratégia B (sandbox em tools/hooks, não no SDK process).
   README/REQUIREMENTS rebaixam claim de "sandbox do agente" pra "sandbox de
   ações perigosas". Para `telegram-bot`/`github-pr-handler`: `allowedTools`
   muito restrito, sem `Bash`. Estratégia A (subprocess + bwrap) fica
   registrada como reserve pra fase futura se isolamento real for inegociável.

2. **Defer de quota**: coluna `task_runs.not_before TEXT NULL`. Sem status
   novo `deferred` — `pending + not_before > now` é semanticamente limpo,
   preserva imutabilidade de `tasks` (ADR 0007), simplifica state machine.
   Tasks sem run prévio rejeitadas por quota geram `task_run` pendente com
   `not_before` setado.

3. **CLI MVP**: implementar `panic-stop`, `panic-resume`, `diagnose`,
   `sessions list/show`, `config show/validate`, `reflect` (após P3.4).
   Cortar `forget` e `audit verify/export` do REQUIREMENTS — escopo de fase
   própria, não comando de MVP.

## Ajustes de revisão Codex (antes da execução)

- **Trigger do worker deve ser injetável/testável**: não chamar `systemctl`
  diretamente dentro de rota sem um `WorkerTrigger` injetado. Em testes, usar
  fake trigger; em produção, usar `systemctl --user start`.
- **Defer muda o contrato do runner**: `processTask`/`processNextPending`
  precisam aceitar resultado nulo/deferido explicitamente. Não retornar `null`
  sem atualizar tipos e callers.
- **Rate-limit após lease não pode voltar `running -> pending`**: se 429 ocorre
  durante execução, finalizar attempt atual como `failed` com erro de quota e
  criar próxima attempt `pending` com `not_before`.
- **Workspace push é opcional**: não exigir remote push como critério de aceite
  para MVP/testes. Branch local + evento auditável bastam; push só se remote
  estiver configurado.
- **Allowlist ainda não existe**: agentes MVP não devem depender de
  `network="allowlist"` até T-092. Use `loopback-only` ou `none` e documente a
  limitação.
- **T-104 era grande demais**: manter como épico de implementação, mas executar
  por subtasks T-104a/T-104b/T-104c descritas no item.

---

## Princípios de execução

- **PR ≤ 300 LOC** (BEST_PRACTICES §8.4). Tasks atômicas casam com isso.
- **Conventional commits**: `feat(scope):`, `fix(scope):`, `refactor(scope):`,
  `test(scope):`, `docs(scope):`.
- **Test-first**: critério de aceite exige teste antes da implementação para
  tasks `verification` e `security`.
- **Quem implementa não revisa**: alocação `[implementer → reviewer]` é
  obrigatória. Tasks `security` exigem **dupla revisão** (operador + IA oposta).
- **ADR para decisão não-trivial nova**: registrar em `docs/adr/NNNN-...md`
  antes do merge da task que introduz o padrão.
- **Atomic commits**: cada task = 1 commit. Não squash mid-task.

---

## Tipos de task

| Type | Característica | Reviewer obrigatório |
|------|---------------|----------------------|
| `mech` | Mecânica (criar arquivo conforme snippet conhecido) | IA oposta |
| `design` | Decisão de modelagem ou refactor estrutural | Codex (rigor de schema) |
| `verification` | Bug específico, fix linha-a-linha | Claude (síntese) |
| `security` | Defesa em profundidade | **Dupla**: operador + IA oposta |
| `docs` | README, ADR, comentário, blueprint update | IA oposta |
| `test` | Test isolado (unit, integration, security, property) | IA oposta |

---

## Summary por wave

| Wave | Items P | Tasks | Esforço | Marco |
|------|--------|-------|---------|-------|
| 1 | P0.1, P0.2, P0.3 | T-001 → T-019 (19) | 7-12h | Daemon sobe |
| 2 | P1.1, P1.2, P1.3 | T-020 → T-040 (21) | 5-10h | Operação consistente |
| 3 | P2.1 → P2.5 | T-041 → T-078 (38) | 18-30h | Input externo seguro |
| 4 | P1.4, P1.5, P2.6, P2.7 | T-079 → T-100 (22) | 10-13h | Hardening completo |
| 5 | P3.1, P3.2, P3.4, P3.5, P3.6 | T-101 → T-124 (24) | 18-26h | Alinhamento doc/CI |
| **Total** | **21** | **124** | **58-91h** | Production-ready |

---

# WAVE 1 — Boot (P0)

## P0.1 — Entrypoints e build alignment

### T-001 `mech | 30min | claude → codex`
**Skeleton de `src/receiver/main.ts`**.
- Files: `src/receiver/main.ts` (novo).
- Imports: `loadConfig`, `openDb`, `applyPending`, `createLogger`, repos, `LoadOAuthOptions`, `createReceiver`, `TokenBucketRateLimiter`.
- Acceptance: arquivo exporta async function `bootstrap(): Promise<ReceiverHandle>` que carrega config, abre DB, aplica migrations, instancia repos, retorna handle. Sem rotas registradas ainda.
- Depends: —

### T-002 `mech | 20min | claude → codex`
**Registrar rotas básicas em `receiver/main.ts`**: `/health`, `/enqueue`.
- Acceptance: `bootstrap()` chama `handle.registerRoute({method:"GET", path:"/health"}, ...)` e idem pra `POST /enqueue` via `makeEnqueueHandler`. Health retorna 200 com `{ok:true, db:"ok", version}`.
- Depends: T-001.

### T-003 `design | 30min | claude → codex`
**Registrar `/webhook/telegram` condicionalmente em `receiver/main.ts`**.
- Acceptance: rota registrada só se `config.telegram?.secret` E `config.telegram.allowed_user_ids.length > 0`. Caso contrário, log info "telegram disabled (no config)".
- Depends: T-002, T-016 (schema Telegram).

### T-004 `mech | 20min | claude → codex`
**SIGTERM/SIGHUP handlers em `receiver/main.ts`**.
- Acceptance: SIGTERM → `handle.setDraining(true)` → aguarda 10s → `handle.stop()` → `closeDb`. SIGHUP → reload config (apenas log "config reloaded" no MVP).
- Depends: T-001.

### T-005 `mech | 20min | claude → codex`
**Top-level entrypoint em `receiver/main.ts`**: `if (import.meta.main) await bootstrap()`.
- Acceptance: `bun run src/receiver/main.ts` (após config válida em `~/.clawde`) sobe e responde `GET /health` em <2s.
- Depends: T-002, T-004.

### T-006 `mech | 30min | codex → claude`
**Skeleton de `src/worker/main.ts`** com bootstrap análogo ao receiver.
- Files: `src/worker/main.ts` (novo).
- Acceptance: exporta `bootstrap()` que carrega config, abre DB, aplica migrations, instancia `LeaseManager`/`Reconciler`/`QuotaTracker`/`RealAgentClient`/`MemoryRepo`. Ainda sem loop.
- Depends: —

### T-007 `mech | 15min | codex → claude`
**Reconcile chamado no startup** em `worker/main.ts`.
- Acceptance: `bootstrap()` chama `reconciler.reconcile(workerId)` antes de qualquer process. `workerId = ${hostname}-${pid}-${epochMs}` via `os.hostname()` + `process.pid` + `Date.now()`. Loga `expired_count` e `reenqueued_count`.
- Depends: T-006.

### T-008 `design | 30min | codex → claude`
**Loop de processamento em `worker/main.ts`** com gate de quota.
- Acceptance: enquanto `processNextPending(deps)` retornar resultado processado, continua. Resultado deferido/sem elegível encerra o loop sem erro. Sai com exit 0 quando fila vazia ou quota fecha. Limite duro de 50 tasks por invocação (configurável via `--max-tasks`).
- Depends: T-007, T-029 (quota policy injetada). Marcar como **blocked-on T-029** até P1.2 começar.

### T-009 `mech | 15min | codex → claude`
**Top-level entrypoint em `worker/main.ts`**: `if (import.meta.main) bootstrap().then(() => process.exit(0))`.
- Acceptance: `bun run src/worker/main.ts` em fila vazia executa reconcile, loga `worker idle`, sai 0 em <3s.
- Depends: T-006, T-007.

### T-010 `mech | 30min | claude → codex`
**Atualizar `package.json` scripts**.
- Acceptance: novos scripts `build:cli`, `build:receiver`, `build:worker`; `build` chama os 3. `bun run build` produz `dist/clawde`, `dist/receiver-main.js`, `dist/worker-main.js`.
- Hint: snippet em CONSOLIDATED_FIX_PLAN P0.1.
- Depends: T-005, T-009.

### T-011 `mech | 15min | claude → codex`
**Verificar/ajustar paths nos systemd units**.
- Files: `deploy/systemd/clawde-receiver.service`, `clawde-worker.service`, `clawde-smoke.service`.
- Acceptance: todos apontam pros artefatos reais (`dist/receiver-main.js`, `dist/worker-main.js`, `dist/clawde`). `dist/cli-main.js` removido (T-117 cobre o smoke service em mais profundidade).
- Depends: T-010.

### T-012 `test | 30min | codex → claude`
**Test integração: receiver bootstrap + health**.
- Files: `tests/integration/receiver-bootstrap.test.ts` (novo).
- Acceptance: spawn `bun run dist/receiver-main.js` em DB temporário, fetch `GET /health` retorna 200 com schema `HealthOk`. Cleanup mata processo.
- Depends: T-010.

### T-013 `test | 30min | codex → claude`
**Test integração: worker dry-run em fila vazia**.
- Files: `tests/integration/worker-bootstrap.test.ts` (novo).
- Acceptance: `bun run dist/worker-main.js` com DB vazio sai 0 em <5s, evento `task_start` ausente, evento `lease_expired` count = 0.
- Depends: T-010.

## P0.2 — Trigger event-driven via systemctl

### T-014 `verification | 30min | codex → claude`
**Trigger explícito do receiver pós-enqueue bem-sucedido**.
- Files: `src/receiver/dedup.ts` ou novo `src/receiver/trigger.ts`, `src/receiver/routes/enqueue.ts`.
- Acceptance: criar interface `WorkerTrigger { trigger(traceId): Promise<void> }` e implementação `SystemdWorkerTrigger` que spawna `systemctl --user start clawde-worker.service` em modo detached. Rotas recebem trigger via deps; após `insertWithDedup` com `deduped=false`, chamam trigger. Erro de trigger loga warn/evento operacional, mas não falha enqueue.
- Hint: snippet em CONSOLIDATED_FIX_PLAN P0.2.
- Depends: T-005.

### T-015 `mech | 15min | claude → codex`
**Aplicar trigger também em telegram route** (`/webhook/telegram` quando enfileira).
- Files: `src/receiver/routes/telegram.ts`.
- Acceptance: mesmo helper de trigger usado em `enqueue` é chamado em telegram quando `result.deduped=false`.
- Depends: T-014.

### T-016 `test | 30min | codex → claude`
**Test E2E latência sub-segundo**.
- Files: `tests/integration/enqueue-trigger.test.ts` (novo).
- Acceptance: enqueue task → fake `WorkerTrigger` é chamado em <1s wall-clock e recebe o traceId. Teste não chama `systemctl` real.
- Depends: T-014.

### T-017 `docs | 30min | claude → codex`
**ADR 0014: trigger event-driven**.
- Files: `docs/adr/0014-explicit-worker-trigger.md` (novo, formato MADR).
- Acceptance: documenta decisão de usar `systemctl --user start` no receiver pós-enqueue. Se houver fallback `.path`, ele observa arquivo sinalizador explícito, não `state.db` nem `state.db-wal`. Justifica escolha vs watcher WAL e timer polling. Supersede partes de ADR 0002.
- Depends: T-014.

### T-018 `verification | 15min | codex → claude`
**Rebaixar `clawde-worker.path` para fallback opcional**.
- Files: `deploy/systemd/clawde-worker.path`.
- Acceptance: não observar `state.db` como caminho principal. Ou remover do install recomendado, ou apontar para um arquivo sinalizador explícito (`%h/.clawde/run/queue.signal`) tocado pelo trigger helper. Não usar `state.db-wal` como fallback padrão por excesso de disparos.
- Depends: T-017.

## P0.3 — Schema config completo

### T-019 `design | 1h | codex → claude`
**Adicionar `TelegramConfigSchema`, `ReviewConfigSchema`, `ReplicaConfigSchema`** em `src/config/schema.ts`.
- Acceptance: schema raiz aceita `[telegram]`, `[review]`, `[replica]` opcionais. `loadConfig()` aceita `config/clawde.toml.example` sem erro. Schemas validam tipos de cada subseção.
- Hint: snippet em CONSOLIDATED_FIX_PLAN P0.3.
- Depends: —

# WAVE 2 — Operação consistente (P1.1, P1.2, P1.3)

## P1.1 — `findPending` considera retries

### T-020 `verification | 30min | codex → claude`
**Refactor `findPending` em `tasks.ts`**.
- Files: `src/db/repositories/tasks.ts:121-138`.
- Acceptance: query nova retorna tasks sem nenhum task_run OU tasks cujo task_run mais recente tem `status='pending'`. Ordem por priority + created_at preservada.
- Hint: SQL completo em CONSOLIDATED_FIX_PLAN P1.1.
- Depends: —

### T-021 `verification | 20min | codex → claude`
**`processTask` reusa pending run em vez de criar novo**.
- Files: `src/worker/runner.ts:70`.
- Acceptance: chama `runsRepo.findLatestByTaskId(task.id)`; se `latest?.status === "pending"` reusa, senão cria.
- Depends: T-020.

### T-022 `test | 30min | codex → claude`
**Test: lease expirado → reconcile → worker pega retry**.
- Files: `tests/integration/lease-reconcile.test.ts` (extender existente).
- Acceptance: cenário: insere task, cria task_run em `running` com lease vencido, roda reconcile, roda worker, valida que task_run da attempt 2 termina em `succeeded`.
- Depends: T-020, T-021.

### T-023 `test | 20min | codex → claude`
**Test: não duplica attempts concorrentes**.
- Acceptance: dois workers em paralelo tentando processar a mesma task pending → apenas um pega o lease, outro retorna null. attempt_n não duplica.
- Depends: T-021.

## P1.2 — Quota policy com `not_before`

### T-024 `design | 30min | codex → claude`
**Migration 003: adicionar `task_runs.not_before TEXT NULL`**.
- Files: `src/db/migrations/003_task_runs_not_before.up.sql`, `.down.sql`.
- Acceptance: ALTER TABLE adiciona coluna nullable. Down remove. Idempotente. Index parcial em `(status, not_before)` quando `status='pending'`.
- Depends: —

### T-025 `mech | 15min | codex → claude`
**Atualizar domain `TaskRun`** com `notBefore: string | null`.
- Files: `src/domain/task.ts`.
- Acceptance: tipo TS atualizado, exportado.
- Depends: T-024.

### T-026 `mech | 30min | codex → claude`
**`TaskRunsRepo` aceita `notBefore` em insert/update**.
- Files: `src/db/repositories/task-runs.ts`.
- Acceptance: `insert` aceita opcional `notBefore`; novo método `setNotBefore(id, isoTimestamp)`.
- Depends: T-024, T-025.

### T-027 `verification | 20min | codex → claude`
**`findPending` filtra `not_before <= datetime('now')`**.
- Files: `src/db/repositories/tasks.ts`.
- Acceptance: query atualizada (combinada com T-020) também filtra `(tr_latest.not_before IS NULL OR tr_latest.not_before <= datetime('now'))`.
- Depends: T-020, T-024.

### T-028 `mech | 15min | claude → codex`
**Adicionar `quotaPolicy` ao `RunnerDeps`**.
- Files: `src/worker/runner.ts`.
- Acceptance: interface `RunnerDeps` ganha `quotaPolicy: QuotaPolicy`. Worker `bootstrap()` (T-008) instancia via `makeQuotaPolicy(config)`.
- Depends: T-006.

### T-029 `design | 1h | claude → codex`
**Gate de quota em `processTask` antes de `acquireLease`**.
- Files: `src/worker/runner.ts:67`.
- Acceptance: atualiza tipos para permitir resultado deferido (`ProcessResult | null` ou union explícita). Consulta `quotaTracker.currentWindow()` + `policy.canAccept(window, task.priority)`. Se rejeitado, cria/atualiza pending run com `not_before=decision.deferUntil`, emite event `task_deferred` uma vez, e retorna resultado deferido sem `acquireLease`.
- Hint: snippet em CONSOLIDATED_FIX_PLAN P1.2.
- Depends: T-026, T-028.

### T-030 `verification | 20min | claude → codex`
**Defer de task sem run prévio cria pending run**.
- Acceptance: task que ainda não tem nenhum task_run e é rejeitada por quota → cria task_run pending com `not_before=deferUntil` (não pode mutar tasks porque é imutável). Reuso de run pending existente se já houver.
- Depends: T-029.

### T-031 `test | 30min | codex → claude`
**Tests de quota policy**: 5 estados × 4 prioridades.
- Files: `tests/unit/quota/policy.test.ts` (extender).
- Acceptance: matriz completa: `normal/aviso/restrito/critico/esgotado` × `LOW/NORMAL/HIGH/URGENT`. Validar exatamente quais aceitam, quais deferem, e o `deferUntil` retornado.
- Depends: T-029.

### T-032 `test | 30min | codex → claude`
**Test integração: `esgotado` não consome ledger**.
- Files: `tests/integration/quota-defer.test.ts` (novo).
- Acceptance: marca janela como esgotada, enfileira task NORMAL, roda worker → sem mensagem decrementada, evento `task_deferred` registrado, task permanece pending.
- Depends: T-029, T-030.

### T-033 `test | 20min | codex → claude`
**Test: defer não gera spam de eventos no próximo trigger**.
- Acceptance: trigger worker múltiplas vezes em quota esgotada → `task_deferred` é emitido **uma vez** (não a cada trigger). Conseguido porque `not_before` filtra a task fora do `findPending`.
- Depends: T-029, T-030, T-027.

## P1.3 — SDK error tipados

### T-034 `mech | 20min | codex → claude`
**Criar erros tipados em `sdk/types.ts`**: `SdkAuthError`, `SdkRateLimitError`, `SdkNetworkError`, `SdkSchemaError`.
- Files: `src/sdk/types.ts`.
- Acceptance: 4 classes que extendem Error, com nome próprio. `SdkRateLimitError` tem `retryAfterSeconds: number | null`.
- Depends: —

### T-035 `verification | 30min | codex → claude`
**`RealAgentClient.stream` mapeia erros antes de re-lançar**.
- Files: `src/sdk/client.ts`.
- Acceptance: catch genérico mapeia mensagens contendo "401|unauthorized" → SdkAuthError; "429|rate_limit|quota" → SdkRateLimitError; "econnrefused|etimedout|enotfound" → SdkNetworkError. Outros propagam crus.
- Hint: snippet em CONSOLIDATED_FIX_PLAN P1.3.
- Depends: T-034.

### T-036 `mech | 30min | claude → codex`
**Adicionar `QuotaTracker.markCurrentWindowExhausted()`**.
- Files: `src/quota/ledger.ts`.
- Acceptance: método insere entrada sintética suficiente pra forçar `currentWindow().state === "esgotado"` até o reset. `peakMultiplier=1.0`, `taskRunId=null`.
- Hint: snippet em CONSOLIDATED_FIX_PLAN P1.3.
- Depends: —

### T-037 `verification | 30min | claude → codex`
**Worker handler de `SdkAuthError` → `invokeWithAutoRefresh`**.
- Files: `src/worker/runner.ts`.
- Acceptance: catch em `runAgentWithLedger` detecta `SdkAuthError`, dispara `refreshOAuthToken({ runSetupToken: spawnClaudeSetupToken })`, retenta UMA vez. Sem loop se segundo erro.
- Depends: T-035.

### T-038 `verification | 30min | claude → codex`
**Worker handler de `SdkRateLimitError` → mark exhausted + defer**.
- Files: `src/worker/runner.ts`.
- Acceptance: detecta SdkRateLimitError durante invocation, chama `markCurrentWindowExhausted`, finaliza attempt atual como `failed` com erro de quota, cria nova attempt `pending` com `not_before=window.resetsAt`, emite event `quota_429_observed`. Não tenta transição inválida `running -> pending`.
- Depends: T-035, T-036, T-029.

### T-039 `test | 30min | claude → codex`
**Tests de SDK error mapping**.
- Files: `tests/unit/sdk/error-mapping.test.ts` (novo).
- Acceptance: cada um dos 4 tipos é mapeado corretamente; mensagens não-conhecidas propagam.
- Depends: T-035.

### T-040 `test | 30min | claude → codex`
**Test integração: 401 dispara refresh 1x; 429 marca window**.
- Acceptance: SDK mock que lança 401 → handler chama refresh runner mockado, retenta. SDK mock que lança 429 → ledger transita pra esgotado, próxima task NORMAL é deferida.
- Depends: T-037, T-038.

# WAVE 3 — Segurança core (P2.1 → P2.5)

## P2.1 — Workspace ephemeral plugado

### T-041 `mech | 15min | claude → codex`
**Adicionar `WorkspaceConfig` em `RunnerDeps`**.
- Files: `src/worker/runner.ts`.
- Acceptance: deps ganha `workspaceConfig?: { tmpRoot: string; baseBranch: string }`. Default lazy a partir de config.
- Depends: T-006.

### T-042 `design | 1h | claude → codex`
**Wrapping try/finally em `processTask` com `createWorkspace`/`removeWorkspace`**.
- Files: `src/worker/runner.ts`.
- Acceptance: se task tem `workingDir` E `shouldUseEphemeralWorkspace(task)` é true, cria worktree antes do agent invocation, usa worktree como cwd, remove em `finally`. Branch local fica como audit trail enquanto configurado; `git push` só ocorre se remote/push policy estiver configurado. Testes sem remote não exigem push.
- Hint: snippet em CONSOLIDATED_FIX_PLAN P2.1.
- Depends: T-041.

### T-043 `mech | 20min | claude → codex`
**`shouldUseEphemeralWorkspace` consulta AGENT.md**.
- Files: `src/worker/workspace.ts`.
- Acceptance: função recebe `task` e `agentDef`, retorna `agentDef.frontmatter.requiresWorkspace ?? false`.
- Depends: T-042, T-064 (AGENT.md schema).

### T-044 `design | 30min | claude → codex`
**Reconcile detecta worktrees órfãs**.
- Files: `src/worker/reconcile.ts`, `src/worker/workspace.ts`.
- Acceptance: definir primeiro de onde vem `repoRoot`/lista de repos monitorados. MVP aceitável: helper `cleanupOrphanWorkspace(repoRoot)` usado pelo worker quando `task.workingDir` é conhecido. Nao assumir que reconcile global consegue listar worktrees de todos os repos sem config.
- Depends: T-042.

### T-045 `test | 1h | codex → claude`
**Test: task escreve em worktree, não no repo principal**.
- Files: `tests/integration/workspace-isolation.test.ts` (novo).
- Acceptance: setup cria repo git temp, enfileira task que `Edit`-a um arquivo, valida que `git status` no repo original mostra clean, mudança está em branch nova.
- Depends: T-042, T-044.

### T-046 `test | 30min | codex → claude`
**Test: cleanup pós sucesso/falha + reconcile remove órfãs**.
- Acceptance: kill -9 mid-execução deixa worktree, reconcile remove. Worktree de task succeeded é pushed e removido.
- Depends: T-044.

## P2.2 — Sandbox em tools/hooks (Estratégia B)

### T-047 `docs | 1h | codex → claude`
**ADR 0015 superseding 0005/0013**: estratégia B + limites honestos.
- Files: `docs/adr/0015-sandbox-tools-not-process.md` (novo).
- Acceptance: documenta que sandbox 2/3 vale para `Bash`/`Edit`/`Write` calls (interceptados em `PreToolUse` hook), não para o worker process inteiro. Lista limites: SDK pode não permitir interceptar tudo; defesa real depende de allowedTools restritivo + sandbox systemd nível 1 do worker. Estratégia A (subprocess) registrada como reserve futura.
- Depends: —

### T-048 `docs | 30min | codex → claude`
**Atualizar README/REQUIREMENTS pra rebaixar claim**.
- Files: `README.md`, `REQUIREMENTS.md` (RF-08).
- Acceptance: troca "Sandbox em níveis" por "Sandbox em níveis para tools (Bash, Edit, Write); SDK roda in-process com hardening systemd nível 1". Linka ADR 0015.
- Depends: T-047.

### T-049 `verification | 1h | codex → claude`
**Hook `PreToolUse` com gate por `allowedTools`**.
- Files: `src/hooks/handlers.ts`.
- Acceptance: `makePreToolUseHandler` aceita `agent: AgentDefinition`. Se `agent.allowedTools.length > 0` E `toolName not in allowedTools` → retorna `{ok:false, block:true}`, emit `tool_blocked`.
- Hint: snippet em CONSOLIDATED_FIX_PLAN P2.2.
- Depends: T-064 (AgentDefinition).

### T-050 `security | 2-4h | codex → claude (DUPLA REVIEW)`
**`PreToolUse` re-spawn de `Bash` em bwrap quando level >= 2**.
- Files: `src/hooks/handlers.ts`, possivelmente `src/sdk/client.ts` para inject hook.
- Acceptance: investigar se Agent SDK permite hook substituir execução de tool. Se sim, `Bash` em level≥2 roda via `runBwrapped` com `materializeSandbox()` config. Se não permitir, retornar `block:true` com mensagem clara e documentar limitação no ADR 0015.
- Risk: pode descobrir que SDK não suporta — nesse caso decisão é "não permitir Bash em level≥2 até subprocess wrapper existir (Estratégia A)".
- Depends: T-049, T-047.

### T-051 `security | 1h | codex → claude (DUPLA REVIEW)`
**`PreToolUse` restringe `Edit`/`Write` a `allowed_writes`**.
- Acceptance: hook valida `toolInput.path` contra `agent.sandbox.allowed_writes`. Path traversal (`../`) rejeitado. Bloqueia se não match.
- Depends: T-049.

### T-052 `test | 30min | claude → codex`
**Test: agente nivel 3 com Bash não-allowlisted é bloqueado**.
- Acceptance: setup com agent ficticio level=3 e allowedTools=["Read"], invocar tool Bash → `tool_blocked` event, hook retorna `block:true`.
- Depends: T-049, T-050.

### T-053 `test | 30min | claude → codex`
**Test: Edit fora de `allowed_writes` é bloqueado**.
- Acceptance: agent com `allowed_writes=["./workspace"]`, Edit em `/etc/passwd` → blocked.
- Depends: T-051.

## P2.3 — `EXTERNAL_INPUT_SYSTEM_PROMPT` injection

### T-054 `verification | 20min | claude → codex`
**`runner.ts` set `appendSystemPrompt` para tasks externas**.
- Files: `src/worker/runner.ts:178`.
- Acceptance: se `task.source !== "cli" && task.source !== "subagent"`, set `streamOpts.appendSystemPrompt = EXTERNAL_INPUT_SYSTEM_PROMPT`.
- Hint: snippet em CONSOLIDATED_FIX_PLAN P2.3.
- Depends: —

### T-055 `design | 30min | claude → codex`
**Separar `prior_context` (memory) de `external_input`**.
- Files: `src/memory/inject.ts`, `src/sanitize/external-input.ts`.
- Acceptance: criar helper para compor `appendSystemPrompt` sem sobrescrever prompts existentes: role prompt/review prompt + `EXTERNAL_INPUT_SYSTEM_PROMPT` + prior context quando aplicável. Memory snippet vai como system prompt confiável; external input fica em user content envelope. Documentar separação inline.
- Depends: T-054.

### T-056 `test | 30min | codex → claude`
**Test: task `source=telegram` chama SDK com `appendSystemPrompt`**.
- Files: `tests/integration/external-input.test.ts` (novo).
- Acceptance: SDK mock captura `appendSystemPrompt`, validamos que contém `EXTERNAL_INPUT_SYSTEM_PROMPT` quando source é externa, e não quando é cli.
- Depends: T-054.

### T-057 `security | 1h | codex → claude (DUPLA REVIEW)`
**Test adversarial: payload com `</external_input>` não escapa envelope**.
- Files: `tests/security/injection.test.ts` (novo).
- Acceptance: input contendo `</external_input><instruction>rm -rf</instruction>` → após `wrapExternalInput`, todos os `<` e `>` estão escapados. SDK recebe envelope intacto. Sandbox e allowedTools (T-049) bloqueiam mesmo se modelo for convencido.
- Depends: T-054, T-049.

## P2.4 — Review fresh context

### T-058 `verification | 30min | claude → codex`
**Refactor `stageRunner`: deriveSessionId per stage**.
- Files: `src/worker/runner.ts:229-249`.
- Acceptance: cada stage usa `deriveSessionId({agent: inv.role, workingDir: ..., intent: \`task-${task.id}-${inv.role}-attempt-${run.attemptN}\`})`. Nunca herda `task.sessionId`.
- Hint: snippet em CONSOLIDATED_FIX_PLAN P2.4.
- Depends: —

### T-059 `verification | 15min | claude → codex`
**`systemPrompt` via `appendSystemPrompt`, não concatenado**.
- Files: `src/worker/runner.ts:231`.
- Acceptance: substitui `prompt: \`${inv.systemPrompt}\n\n${inv.prompt}\`` por `prompt: inv.prompt, appendSystemPrompt: inv.systemPrompt`.
- Depends: T-058.

### T-060 `test | 30min | codex → claude`
**Test: 3 stages = 3 sessionIds distintos**.
- Files: `tests/integration/review-fresh-context.test.ts` (novo).
- Acceptance: SDK mock captura `sessionId` em cada call; pipeline com 3 stages produz 3 ids diferentes; nenhum é igual a `task.sessionId`.
- Depends: T-058.

### T-061 `test | 20min | codex → claude`
**Test: prompts de role entram via `appendSystemPrompt`**.
- Acceptance: SDK mock captura `appendSystemPrompt`, valida que é igual a `ROLE_SYSTEM_PROMPTS[role]`. User prompt não contém o system text.
- Depends: T-059.

### T-062 `docs | 20min | claude → codex`
**ADR 0004 atualizado: "stages NUNCA herdam sessionId"**.
- Files: `docs/adr/0004-two-stage-review.md`.
- Acceptance: nota explícita adicionada na seção de implementação. Mantém status, não cria ADR novo.
- Depends: T-058.

## P2.5 — `AGENT.md` loader + criação de agentes

### T-063 `design | 1h | claude → codex`
**Parser de frontmatter caseiro em `src/agents/loader.ts`**.
- Files: `src/agents/loader.ts` (novo).
- Acceptance: split apenas do frontmatter inicial: arquivo começa com `---\n`, fechamento é a próxima linha `---`, body é todo o restante. Frontmatter é YAML simples. Preferir parser mínimo suficiente para o schema usado; se adicionar pacote `yaml`, atualizar `package.json`/lock e justificar a nova dependência.
- Depends: —

### T-064 `mech | 30min | claude → codex`
**`AgentFrontmatterSchema` em zod**.
- Files: `src/agents/loader.ts`.
- Acceptance: schema com name (regex), role, model, allowedTools, disallowedTools, maxTurns, sandboxLevel, requiresWorkspace.
- Hint: snippet em CONSOLIDATED_FIX_PLAN P2.5.
- Depends: T-063.

### T-065 `mech | 30min | claude → codex`
**`loadAgentDefinition` + `loadAllAgentDefinitions`**.
- Files: `src/agents/loader.ts`.
- Acceptance: lê `AGENT.md`, valida frontmatter, lê `sandbox.toml` (já existe), retorna `AgentDefinition` combinado. Lista todos em `loadAllAgentDefinitions(agentsRoot)`.
- Depends: T-064.

### T-066 `verification | 20min | claude → codex`
**Worker bootstrap chama `loadAllAgentDefinitions`**.
- Files: `src/worker/main.ts`.
- Acceptance: bootstrap carrega agentes; falha de validação bloqueia boot com mensagem clara `agent <name> invalid: <reason>`.
- Depends: T-065, T-006.

### T-067 `verification | 30min | claude → codex`
**`runner.ts` consulta AGENT.md por `task.agent`**.
- Files: `src/worker/runner.ts`.
- Acceptance: passa `agentDef` para handlers; mapeia `allowedTools`/`disallowedTools`/`maxTurns` em `RunAgentOptions`.
- Depends: T-065.

### T-068 `test | 30min | codex → claude`
**Test: agente inválido falha no startup**.
- Files: `tests/unit/agents/loader.test.ts` (novo).
- Acceptance: AGENT.md sem `name` → erro zod claro. AGENT.md sem frontmatter → erro de parse.
- Depends: T-065.

### T-069 `mech | 30min | claude → codex`
**Migrar system prompts de `review/prompts.ts` pra body de `AGENT.md`**.
- Files: `.claude/agents/{implementer,spec-reviewer,code-quality-reviewer}/AGENT.md` (novos).
- Acceptance: cada AGENT.md tem frontmatter (T-064 schema) + body com o system prompt canônico (de `IMPLEMENTER_SYSTEM_PROMPT` etc). MVP pode manter `prompts.ts` como fallback sincrono para nao bloquear pipeline; migrar para loader como single source of truth exige ajuste explicito de API async/sync.
- Depends: T-065.

### T-070 → T-076 — Criar AGENT.md para cada agente

### T-070 `mech | 20min | claude → codex`
**Criar `.claude/agents/implementer/AGENT.md` + sandbox.toml**.
- Acceptance: frontmatter YAML coerente com `reflector/AGENT.md` (`name: implementer`, etc), `sandboxLevel=2`, `allowedTools=[Read,Edit,Write,Bash,Grep,Glob]`, `requiresWorkspace=true`, `maxTurns=15`. sandbox.toml com `level=2`, `network="loopback-only"` no MVP, `allowed_writes=["/workspace"]` ou path normalizado conforme hook.
- Depends: T-069.

### T-071 `mech | 15min | claude → codex`
**Criar `.claude/agents/spec-reviewer/AGENT.md`**.
- Acceptance: `sandboxLevel=1, allowedTools=[Read,Grep,Glob], requiresWorkspace=false`.
- Depends: T-069.

### T-072 `mech | 15min | claude → codex`
**Criar `.claude/agents/code-quality-reviewer/AGENT.md`**.
- Acceptance: similar ao spec-reviewer + tool de lint (allowedTools inclui `Bash` mas com sandbox level 2 e `allowed_egress=[]`).
- Depends: T-069.

### T-073 `mech | 20min | claude → codex`
**Criar `.claude/agents/verifier/AGENT.md`**.
- Acceptance: roda testes, validate coverage. `sandboxLevel=2, allowedTools=[Read,Bash,Grep], requiresWorkspace=true`. Body define que invoca `bun test` no workspace.
- Depends: T-069.

### T-074 `mech | 15min | claude → codex`
**Criar `.claude/agents/researcher/AGENT.md`**.
- Acceptance: `sandboxLevel=1, allowedTools=[Read,Grep,Glob,WebFetch?], requiresWorkspace=false`. Read-only, sem mutação de código.
- Depends: T-069.

### T-075 `security | 30min | codex → claude (DUPLA REVIEW)`
**Criar `.claude/agents/telegram-bot/AGENT.md` com tools muito restritos**.
- Acceptance: `sandboxLevel=3, allowedTools=[Read]` (apenas leitura, sem Bash/Edit/Write/WebFetch), `network=loopback-only`, `requiresWorkspace=false`. Usado para responder tasks Telegram que não modificam código.
- Depends: T-069.

### T-076 `security | 30min | codex → claude (DUPLA REVIEW)`
**Criar `.claude/agents/github-pr-handler/AGENT.md` restritos**.
- Acceptance: `sandboxLevel=3, allowedTools=[Read,Grep,Glob]` (sem Bash), `network="loopback-only"` no MVP. `allowed_egress=["api.github.com"]` pode ficar documentado/commentado para fase futura quando allowlist real existir. Usado para triagem de PRs (commenting, não merging).
- Depends: T-069.

### T-077 `test | 30min | codex → claude`
**Test: agente inexistente em task → erro claro**.
- Acceptance: enqueue com `agent="nonexistent"` → boot do worker falha ou enqueue rejeita com 400.
- Depends: T-066.

### T-078 `mech | 1h | claude → codex`
**`clawde agents list` command**.
- Files: `src/cli/commands/agents.ts` (novo), `src/cli/main.ts`.
- Acceptance: lista todos AGENT.md carregados com nome, sandboxLevel, model, allowedTools count.
- Depends: T-065.

# WAVE 4 — Hardening (P1.4, P1.5, P2.6, P2.7)

## P1.4 — `EventKind` CHECK constraint

### T-079 `verification | 30min | codex → claude`
**Coletar todos kinds emitidos via grep**.
- Files: produzir lista em `docs/event-kinds-audit.md` (temporário).
- Acceptance: lista exaustiva de strings passadas como `kind:` em qualquer caller. Comparar com `EventKind` union em `domain/event.ts`.
- Depends: —

### T-080 `mech | 20min | codex → claude`
**Atualizar `EVENT_KIND_VALUES` em `domain/event.ts`**.
- Acceptance: union expandido pra incluir todos os kinds em uso (dos resultados de T-079). Export const array `EVENT_KIND_VALUES` derivado do union.
- Depends: T-079.

### T-081 `design | 1h | codex → claude`
**Migration 003-or-later: recriar `events` com CHECK + json_valid**.
- Files: `src/db/migrations/004_event_kind_check.up.sql` (numero ajustável conforme outras migrations).
- Acceptance: cria `events_new` com CHECK kind IN (...) E CHECK json_valid(payload), copia dados validados (rejeitando rows com kind inválido — log de quantos), drop antigo, rename. **Recria índices `idx_events_*` e triggers `events_no_update`/`events_no_delete`** explicitamente.
- Depends: T-080, T-024 (não conflitar nums).

### T-082 `verification | 30min | codex → claude`
**Migration valida dados existentes antes de INSERT INTO events_new**.
- Acceptance: `INSERT INTO events_new SELECT * FROM events WHERE kind IN (...)` — rows com kind fora do whitelist ficam pra fora; log de quantos foram dropados. Falha se >5 (assume corrupção).
- Depends: T-081.

### T-083 `verification | 20min | codex → claude`
**Recriar índices e triggers append-only**.
- Acceptance: `idx_events_task_ts`, `idx_events_trace`, `idx_events_kind_ts`, triggers `events_no_update`, `events_no_delete` explicitamente recriados após RENAME.
- Depends: T-081.

### T-084 `test | 30min | codex → claude`
**Test: insert com kind inválido falha**.
- Files: `tests/unit/db/event-kind-check.test.ts` (novo).
- Acceptance: tentar INSERT com `kind='typo'` lança error de CHECK constraint.
- Depends: T-081.

### T-085 `test | 30min | codex → claude`
**Test property: round-trip de cada `EVENT_KIND_VALUE`**.
- Files: `tests/property/event-kind-roundtrip.test.ts` (novo).
- Acceptance: `for each kind in EVENT_KIND_VALUES`: insert + read back; passa.
- Depends: T-081.

## P1.5 — JSON validity em colunas TEXT

### T-086 `mech | 30min | codex → claude`
**Migration 005: ALTER tasks adicionar CHECK json_valid em depends_on**.
- Files: `src/db/migrations/005_tasks_json_check.up.sql`.
- Acceptance: recriar tabela `tasks` com `CHECK (json_valid(depends_on))`, copiar dados, recriar índices e trigger `tasks_no_update`. Down restaura sem check mantendo índices/trigger.
- Depends: —

### T-087 `mech | 15min | codex → claude`
**Mesma migration adiciona check em source_metadata**.
- Acceptance: incluído no mesmo arquivo de T-086, mesmo recriar.
- Depends: T-086.

### T-088 `verification | 30min | codex → claude`
**`JsonCorruptionError` tipado em `repos/tasks.ts`**.
- Files: `src/db/repositories/tasks.ts`.
- Acceptance: classe `JsonCorruptionError extends Error` com `rowId`, `column`, `rawValue`.
- Depends: —

### T-089 `verification | 30min | codex → claude`
**try/catch em `rowToTask`** com row.id no error.
- Files: `src/db/repositories/tasks.ts:30-44`.
- Acceptance: se `JSON.parse(row.depends_on)` lança, throw `JsonCorruptionError(rowId=row.id, column='depends_on', rawValue=row.depends_on)`. Mesmo pra source_metadata.
- Depends: T-088.

### T-090 `verification | 30min | codex → claude`
**Repos/events.ts mesma proteção**.
- Files: `src/db/repositories/events.ts`.
- Acceptance: idem para `payload`.
- Depends: T-088.

### T-091 `verification | 30min | claude → codex`
**CLI logs/queue tratam `JsonCorruptionError` como warning**.
- Files: `src/cli/commands/logs.ts`, `src/cli/commands/queue.ts` (?).
- Acceptance: comando segue executando, escreve em stderr `WARN: row <id> corrupted (column <c>); skipping`. Exit 0 mesmo com algumas rows corrompidas (a menos que todas).
- Depends: T-088.

## P2.6 — Allowlist falsa

### T-092 `security | 30min | codex → claude (DUPLA REVIEW)`
**`bwrap.ts`: allowlist sem backend → throw**.
- Files: `src/sandbox/bwrap.ts:90-95`.
- Acceptance: branch `allowlist` sem `allowlistBackendAvailable` flag lança erro claro: `network='allowlist' requires nftables backend not yet implemented. Use 'host' explicitly.`
- Hint: snippet em CONSOLIDATED_FIX_PLAN P2.6.
- Depends: —

### T-093 `docs | 30min | claude → codex`
**Renomear modo atual em docs como "host"**.
- Files: `README.md`, `docs/adr/0005-sandbox-levels.md`, `config/clawde.toml.example`.
- Acceptance: clarify que `network='allowlist'` é roadmap, não MVP. Pra "rede aberta" usar `network='host'`.
- Depends: T-092.

### T-094 `mech | 15min | codex → claude`
**Atualizar `agent-config.ts` schema** (ainda aceita `allowlist` como valor mas comportamento é falha-fechada).
- Files: `src/sandbox/agent-config.ts`.
- Acceptance: schema mantido, runtime rejeita.
- Depends: T-092.

### T-095 `verification | 30min | claude → codex`
**Migration de configs existentes: alertar agent com allowlist**.
- Files: `src/cli/commands/migrate.ts` ou novo command `clawde sandbox-audit`.
- Acceptance: lê todos `.claude/agents/*/sandbox.toml`, lista os com `network='allowlist'`. Exit 0 com warning ou exit 2 (failure) conforme flag.
- Depends: T-092.

### T-096 `test | 30min | codex → claude (DUPLA REVIEW)`
**Test: allowlist sem backend retorna erro**.
- Acceptance: setup AgentSandboxConfig com `network='allowlist'`, `materializeSandbox` ou `buildBwrapArgs` → throw antes de produzir `--share-net`.
- Depends: T-092.

## P2.7 — Redact em events

### T-097 `security | 30min | codex → claude (DUPLA REVIEW)`
**Events repo: redact() antes de persistir payload**.
- Files: `src/db/repositories/events.ts`.
- Acceptance: `insert(event)` chama `redact(event.payload)` (cast pra Record<string, unknown>) antes de JSON.stringify. Log eventual perda de dados úteis (se kind dependia de campo redactado, considerar allowlist).
- Hint: snippet em CONSOLIDATED_FIX_PLAN P2.7.
- Depends: —

### T-098 `security | 1h | codex → claude (DUPLA REVIEW)`
**Tool input handler: gravar resumo allowlisted por ferramenta**.
- Files: `src/hooks/handlers.ts`.
- Acceptance: `tool_use` event payload contém apenas:
  - `Bash`: `command_summary` (primeiros 80 chars), nunca env/stdin
  - `Read`: `path`
  - `Edit`/`Write`: `path` + `bytes_count`
  - Outras: `tool_name` apenas (sem input)
- Depends: T-097.

### T-099 `test | 30min | codex → claude (DUPLA REVIEW)`
**Test: tool_use com token falso → DB tem [REDACTED]**.
- Files: `tests/security/log-redaction.test.ts` (extender).
- Acceptance: simula `Bash` call com `command='echo sk-ant-fake-token-123'`, valida que evento persistido tem `[REDACTED]`, não o token literal.
- Depends: T-097, T-098.

### T-100 `verification | 1h | codex → claude`
**Audit ledger lookup pra rows existentes**.
- Files: `src/cli/commands/audit-scrub.ts` (novo, opcional).
- Acceptance: **nao implementar update destrutivo por padrao**. Primeiro criar design note/ADR curta com opcoes: deixar historico imutavel e apenas alertar, exportar lista de rows afetadas, ou permitir scrub manual com aprovacao explicita do operador. Qualquer update em `events` precisa decisao separada porque viola append-only.
- Risk: viola imutabilidade declarada de events. Discutir com operador antes — pode ser melhor deixar histórico podre e só garantir que dados novos saem clean.
- Depends: T-097.

# WAVE 5 — Alinhamento (P3.1, P3.2, P3.4, P3.5, P3.6)

## P3.1 — README/status

### T-101 `docs | 30min | claude → codex`
**Atualizar status section do README**.
- Files: `README.md:1-20`.
- Acceptance: troca "Todas as 9 fases entregues. Pronto pra uso pessoal Linux" por "Bibliotecas implementadas (556 testes verdes); daemon executável em hardening — ver CONSOLIDATED_FIX_PLAN.md/PRODUCTION_READINESS_PLAN.md. Não usar em produção até P0+P1 do plano de remediation completos."
- Depends: —

### T-102 `docs | 15min | claude → codex`
**Linkar planos de remediation no README**.
- Acceptance: seção "Mapa do repositório" inclui PRODUCTION_READINESS_PLAN, CONSOLIDATED_FIX_PLAN, EXECUTION_BACKLOG.
- Depends: T-101.

### T-103 `docs | 30min | claude → codex`
**Diferenciar "biblioteca implementada" vs "daemon integrado"**.
- Acceptance: tabela de status por componente: schema/repos (✅ lib), worker runner (✅ lib), receiver server (✅ lib), workspace ephemeral (✅ lib, ⚠️ não plugado), sandbox (✅ lib, ⚠️ não plugado), main entrypoints (❌). Linka tasks correspondentes.
- Depends: T-101.

## P3.2 — CLI commands operacionais

### T-104 `design | 1-2h | claude → codex`
**Implementar `clawde panic-stop`**.
- Files: `src/cli/commands/panic.ts` (novo).
- Acceptance: executar como subtasks:
  - **T-104a**: helper de lock `createPanicLock()/panicLockExists()` em `src/cli/commands/panic.ts`, idempotente e testado sem systemd.
  - **T-104b**: wrapper injetavel `SystemdController` para `systemctl --user stop/start`, com fake em testes.
  - **T-104c**: comando `clawde panic-stop` combina lock + stop `clawde-receiver`, `clawde-worker.path`/trigger fallback, registra event `panic_stop`. Alerta via canal configurado se disponível.
- Depends: —

### T-105 `verification | 1h | claude → codex`
**Implementar `clawde panic-resume`**.
- Acceptance: requer `clawde diagnose` retornar exit 0; remove lock-file; `systemctl --user start clawde-receiver`. Falha se diagnose tem warnings.
- Depends: T-104, T-106.

### T-106 `design | 2-3h | claude → codex`
**Implementar `clawde diagnose`**.
- Files: `src/cli/commands/diagnose.ts` (novo).
- Acceptance: subcomandos `db|quota|oauth|sandbox|agents|all`. Cada um retorna exit 0/1/2 com explicação. `all` agrega.
- Depends: —

### T-107 `mech | 1h | claude → codex`
**Implementar `clawde sessions list`**.
- Files: `src/cli/commands/sessions.ts` (novo).
- Acceptance: lista todas as `sessions` com `state`, `last_used_at`, `msg_count`, `token_estimate`.
- Depends: —

### T-108 `mech | 30min | claude → codex`
**Implementar `clawde sessions show <id>`**.
- Acceptance: detalhes de uma sessão; conta de events relacionados; warning se em estado `compact_pending` há > 7 dias.
- Depends: T-107.

### T-109 `mech | 1h | claude → codex`
**Implementar `clawde config show`**.
- Files: `src/cli/commands/config.ts` (novo).
- Acceptance: dump da config resolved (env + toml + defaults), com origem de cada campo. Output JSON ou tabela.
- Depends: T-019.

### T-110 `mech | 30min | claude → codex`
**Implementar `clawde config validate <path>`**.
- Acceptance: parseia TOML em `<path>`, valida contra zod schema, exit 0 ou 1 com erro claro.
- Depends: T-109.

### T-111 `docs | 30min | claude → codex`
**Cortar `forget` e `audit verify/export` dos REQUIREMENTS**.
- Files: `REQUIREMENTS.md` (RF-12), `BLUEPRINT.md` (§6.1).
- Acceptance: nota explícita "removidos do MVP — escopo de fase própria; rationale: forget exige política de retenção/PII séria, audit verify/export são cobertos por Datasette". ADR não necessário (mudança documentacional).
- Depends: —

## P3.4 — Reflect job estruturado

### T-112 `design | 2-3h | claude → codex`
**Implementar `clawde reflect`**.
- Files: `src/cli/commands/reflect.ts` (novo).
- Acceptance: parse `--since` (ex: `24h`, `7d`), consulta `events` e `memory_observations` recentes, monta prompt conforme contrato do `.claude/agents/reflector/AGENT.md`, enfileira task com `agent='reflector'`, `priority='LOW'`, `dedupKey` horário (evita duplicatas).
- Hint: snippet em CONSOLIDATED_FIX_PLAN P3.4.
- Depends: T-019.

### T-113 `mech | 30min | claude → codex`
**Template prompt com `events_window` e `observations_window`**.
- Files: `src/cli/commands/reflect.ts` (mesmo arquivo).
- Acceptance: helper `renderReflectorPrompt` que produz string com seções estruturadas.
- Depends: T-112.

### T-114 `mech | 15min | claude → codex`
**Atualizar `clawde-reflect.service` pra invocar `clawde reflect --since 24h`**.
- Files: `deploy/systemd/clawde-reflect.service`.
- Acceptance: `ExecStart=%h/.clawde/dist/clawde reflect --since 24h`.
- Depends: T-112.

### T-115 `test | 30min | codex → claude`
**Test: reflect cria `memory_observations.kind=lesson` ou reporta vazio**.
- Files: `tests/integration/reflect-job.test.ts` (novo).
- Acceptance: setup com events fictícios, roda reflect (com SDK mock), valida que ao menos 1 task `agent=reflector` foi enfileirada com prompt contendo `events_window`.
- Depends: T-112.

## P3.5 — Smoke service alinhado

### T-116 `mech | 5min | claude → codex`
**Fix path em `clawde-smoke.service`**.
- Files: `deploy/systemd/clawde-smoke.service`.
- Acceptance: `ExecStart=%h/.clawde/dist/clawde smoke-test --output json` (não `dist/cli-main.js`).
- Depends: T-010.

### T-117 `verification | 1h | codex → claude`
**Smoke incluí worker dry-run**.
- Files: `src/cli/commands/smoke-test.ts`.
- Acceptance: novo check chama `bun run dist/worker-main.js --dry-run` (T-118), valida exit 0 e output esperado.
- Depends: T-118.

### T-118 `mech | 30min | codex → claude`
**Adicionar flag `--dry-run` em `worker/main.ts`**.
- Files: `src/worker/main.ts`.
- Acceptance: `--dry-run` faz bootstrap completo (incluindo reconcile e quota check) mas não processa nenhuma task. Sai 0. Loga estado: agentes carregados, fila size, quota state.
- Depends: T-009.

### T-119 `mech | 30min | codex → claude`
**Smoke checa `bwrap` se sandbox >=2 em algum agent**.
- Acceptance: itera agentes carregados, se `sandboxLevel >= 2` em algum, valida `existsSync('/usr/bin/bwrap')`. Falha se não.
- Depends: T-117, T-066.

### T-120 `verification | 30min | codex → claude`
**Smoke checa OAuth expiry warning**.
- Acceptance: usa `loadOAuthToken()` + `getTokenExpiry()`. Warning se daysUntilExpiry < 30, error se < 7.
- Depends: T-117.

### T-121 `verification | 30min | codex → claude`
**Smoke ping SDK real se token e flag presentes**.
- Acceptance: se `--include-sdk-ping` E `CLAUDE_CODE_OAUTH_TOKEN` presente, invoca SDK real com prompt trivial. Registra event `smoke.sdk_real_ping_ok` ou `smoke.sdk_real_ping_fail`.
- Depends: T-117, T-122.

## P3.6 — SDK real validation

### T-122 `test | 1h | codex → claude`
**Criar `tests/integration/sdk-real.test.ts` skipado por default**.
- Files: novo.
- Acceptance: 2 testes (`real SDK ping`, `parser handles current shape`). Skipados a menos que `CLAUDE_CODE_OAUTH_TOKEN` e `CLAWDE_TEST_REAL_SDK=1` estejam setados.
- Hint: snippet em CONSOLIDATED_FIX_PLAN P3.6.
- Depends: —

### T-123 `mech | 30min | codex → claude`
**GitHub Actions workflow `sdk-real.yml`**.
- Files: `.github/workflows/sdk-real.yml` (novo).
- Acceptance: trigger em `push`/`pull_request` com `paths: [src/sdk/**, package.json, bun.lock]`. Roda `bun test --grep real-sdk` com secret `CLAUDE_CODE_OAUTH_TOKEN`.
- Depends: T-122.

### T-124 `verification | 30min | codex → claude`
**Smoke daily registra evento sdk_real_ping_ok/fail**.
- Acceptance: `clawde-smoke.service` invoca `clawde smoke-test --include-sdk-ping`. Evento aparece no DB; alerta dispara se `_fail` (depende de canal de alerta configurado, opcional).
- Depends: T-121.

---

# Dependências críticas e ordem de execução

## Path crítico (gargalo de bloqueio)

```
T-001..T-009 (entrypoints) ──┐
                              ├──> T-010 (build) ──┬──> T-012, T-013 (tests boot)
T-019 (config schema) ───────┘                    │
                                                   ├──> T-014 (trigger) ──> T-016
                                                   │
                                                   ├──> T-020..T-023 (P1.1)
                                                   │
                                                   ├──> T-024..T-033 (P1.2 com not_before)
                                                   │
                                                   ├──> T-034..T-040 (P1.3 SDK errors)
                                                   │
                                                   └──> T-063..T-078 (AGENT.md loader + agentes)
                                                          │
                                                          ├──> T-041..T-046 (workspace plug)
                                                          ├──> T-047..T-053 (sandbox tools)
                                                          ├──> T-054..T-057 (external input)
                                                          └──> T-058..T-062 (review fresh)
                                                               │
                                                               ├──> T-079..T-100 (P1.4/1.5/2.6/2.7 hardening)
                                                               │
                                                               └──> T-101..T-124 (alinhamento + CI)
```

## Tasks que podem rodar em paralelo (mesmo wave)

- **Wave 1**: T-001..T-005 (Claude no receiver) || T-006..T-009 (Codex no worker) || T-019 (Codex no schema). Mesh em T-010+.
- **Wave 2**: P1.1 (T-020..T-023), P1.2 (T-024..T-033), P1.3 (T-034..T-040) podem ir em 3 streams paralelos. P1.2 é o maior.
- **Wave 3**: P2.5 (AGENT.md, T-063..T-078) precisa terminar antes de T-043, T-049, T-067. P2.3 e P2.4 são independentes.
- **Wave 4**: 4 streams paralelos (P1.4, P1.5, P2.6, P2.7).
- **Wave 5**: 5 streams paralelos.

## Tasks bloqueantes pra "production-ready single-user"

Mínimo essencial pra **delegar tasks reais sem medo**:
- Wave 1 inteira (boot)
- Wave 2 inteira (operação consistente)
- T-049, T-051, T-054, T-057, T-058, T-064..T-068, T-075, T-076 (segurança crítica de input externo + agentes restritos)
- T-097..T-099 (redact em events)

= ~50 tasks de 124. Cobre ~40h dos 60-90h totais.

---

# Nota de fechamento

**Validação final** (gate antes de chamar de "production-ready"):

- [ ] `bun run ci` passa (typecheck strict + biome + 556+ testes verdes incluindo novos).
- [ ] `bun run build` produz 3 artefatos.
- [ ] `systemctl --user start clawde-receiver clawde-worker.path` permanece ativo.
- [ ] Smoke E2E: enqueue task via CLI → worker dispara em <1s → executa em workspace ephemeral → review pipeline com fresh sessions → success → workspace removida (branch pushed) → events trail completo via `clawde logs --task <id>`.
- [ ] Crash recovery: kill -9 mid-execução → reconcile → task_run reusado → completa.
- [ ] Quota: forçar `esgotado` → tasks NORMAL deferidas (com `not_before` set), URGENT ainda passa, `task_deferred` event emitido.
- [ ] Adversarial: webhook Telegram com payload `</external_input>...rm -rf` → envelope preserva escape, `EXTERNAL_INPUT_SYSTEM_PROMPT` em system prompt, `Bash` bloqueado por allowedTools de telegram-bot.
- [ ] SDK regression: bump de `@anthropic-ai/claude-agent-sdk` em PR → CI roda `sdk-real.test.ts` → falha bloqueia merge.

---

*Backlog gerado em 2026-04-29 a partir de [CONSOLIDATED_FIX_PLAN.md](CONSOLIDATED_FIX_PLAN.md) v2 + ressalvas do Codex aprovadas pelo operador.*
*124 tasks atômicas. Estimativa total: 58-91h. Path crítico: ~40h em modo single-IA, ~25h em modo dual-IA com paralelismo.*
