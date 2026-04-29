# Wave 2 Audit — Operação consistente

**Status**: ✅ Closed (2026-04-29)
**Reviewer**: Claude
**Sub-fases**: P1.1, P1.2, P1.3 (3/3 merged)

## PRs

| Sub-fase | PR | Commit | LOC | Tasks |
|----------|----|----|----|-------|
| P1.1 | [#4](https://github.com/Incavenuziano/Clawde/pull/4) | `5240a79` | +117 / -13 | T-020..T-023 |
| P1.2 | [#5](https://github.com/Incavenuziano/Clawde/pull/5) | `5b0a6c4` | +287 / -23 | T-024..T-033 |
| P1.3 | [#6](https://github.com/Incavenuziano/Clawde/pull/6) | `abba7fb` | +304 / -37 | T-034..T-040 |
| **Total** | 3 | — | **+708 / -73** | **21 tasks** |

## Métricas

- Test count: 569 (Wave 1 close) → 586 (Wave 2 close), +17 tests
- Files touched: 23 (src/ + tests/)
- New domain types: `task_deferred` event kind, `quota_429_observed` event kind, 4 SDK error classes (`SdkAuthError`, `SdkRateLimitError`, `SdkNetworkError`, `SdkSchemaError`*)
- New DB migration: `003_task_runs_not_before` (ALTER + index parcial)

\* `SdkSchemaError` foi removido após review; será readicionado quando houver caller real.

## Decisões notáveis

### P1.1 — Defensive `LeaseBusyError` em vez de "criar novo run"

Spec literal de T-021: *"se `latest?.status === "pending"` reusa, senão cria"*. Codex divergiu: criou exception `LeaseBusyError` para latest non-pending (succeeded/failed/abandoned) em vez de criar novo attempt. Justificativa correta: criar attempt para uma task `succeeded` seria inválido. `processNextPending` captura e retorna `null`, mantendo o invariante "1 task processada por chamada do worker".

### P1.2 — Defer via `task_runs.not_before`, não novo status

Decisão arquitetural ratificada anteriormente: defer não cria status novo (`deferred`). Em vez disso, run permanece `pending` com `not_before > now`. Anti-spam de eventos vem de duas fontes:
- `findPending` filtra `not_before > datetime('now')` → workers subsequentes não veem a task
- Update no `not_before` só emite `task_deferred` se o valor mudou

Resultado validado em `tests/integration/quota-defer.test.ts` (3 chamadas a `processNextPending` em quota esgotada → 1 evento).

### P1.3 — Acoplamento `mapSdkError` ↔ `isAuthError` por string match

`mapSdkError` usa heurística de keywords ("401", "unauthorized", "429", "rate_limit", "quota", "econnrefused"...) e produz error classes tipadas. `isAuthError` (em `auth/refresh.ts`) também faz string match independente — funciona porque `mapSdkError` preserva a mensagem original que contém os keywords. Frágil mas atual; melhorar coupling pode entrar em followup.

### P1.3 (após review) — `StopReason` ganha `"deferred"`

Inicialmente o defer path retornava `stopReason: "completed"` (semanticamente mentira). Após request-changes, union estendido com `"deferred"` e o defer return foi atualizado.

## Critérios de validação

### CI em main após todos os merges

- `bun run typecheck` ✅
- `bun run lint` ✅
- `bun test` 586 / 586 ✅ (incluindo `findExpiredLeases` que historicamente é flaky)

### Smoke E2E

- `tests/integration/e2e-lifecycle.test.ts` cobre: enqueue → trigger → worker → succeeded. ✅
- `tests/integration/quota-defer.test.ts` cobre: quota esgotada → defer → não consome ledger → anti-spam. ✅
- `tests/integration/lease-reconcile.test.ts` cobre: lease expirado → reconcile → retry attempt 2 → succeeded. ✅
- `tests/integration/worker.test.ts` cobre: 401 com refresh+retry, 429 com quota exhausted + defer. ✅

### Critérios CONSOLIDATED_FIX_PLAN

- **P1.1**: `findPending` retorna tasks com latest run `pending` ✅ (snippet implementado em `tasks.ts`)
- **P1.2**: `quotaPolicy.canAccept` chamado antes de `acquireLease` em `processTask` ✅
- **P1.3**: 4 classes de erro tipadas em `sdk/types.ts` + mapper em `client.ts` + handlers em `runner.ts` ✅

## Followups abertos

| Item | Origem | Branch sugerido |
|------|--------|-----------------|
| **T-008** — `--max-tasks` flag + break no defer | P0.1 (unlocked após P1.2 mergeu) | `task/P0.1-followup-quota-gate` |
| `SdkRateLimitError.retryAfterSeconds` sempre `null` | P1.3 | `task/P1.3-followup-retry-after` (pequeno) |
| `isAuthError` ↔ `SdkAuthError` coupling | P1.3 | mesmo de cima ou Wave 4 |
| Test de "401 persiste após refresh único" | P1.3 | mesmo de cima |
| `processed += 1` conta defers | P0.1 + P1.2 interaction | `task/P0.1-followup-quota-gate` |

## Resultado

**Wave 2 fechada.** Sistema agora tem:
- Retry de tasks abandonadas funcionando ponta-a-ponta
- Quota gate em `processTask` antes de gastar recursos
- Defer via `not_before` sem mudar status, com anti-spam de eventos
- Tratamento robusto de 401 (auto-refresh) e 429 (mark exhausted + new attempt deferred)

Próxima wave (3 — Segurança core): P2.1 workspace plug, P2.2 sandbox, P2.3/P2.4 (Claude), P2.5a/b agent loader.
