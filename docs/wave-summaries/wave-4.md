# Wave 4 Audit — Hardening (P1.4, P1.5, P2.6, P2.7)

**Status**: ✅ Closed (2026-04-30)
**Reviewer**: Claude (Opus 4.7)
**Sub-fases**: P1.4, P1.5, P2.6, P2.7 (4/4 merged)

## PRs

| Sub-fase | PR | Merge commit | LOC | Tasks |
|----------|----|----|----|-------|
| P1.4 | [#17](https://github.com/Incavenuziano/Clawde/pull/17) | `8a5d089` | +348 / -8 | T-079..T-085 |
| P1.5 | [#19](https://github.com/Incavenuziano/Clawde/pull/19) | `5abc4b6` | +262 / -46 | T-086..T-091 |
| P2.6 | [#21](https://github.com/Incavenuziano/Clawde/pull/21) | `cd9486a` | +169 / -17 | T-092..T-096 |
| P2.7 | [#22](https://github.com/Incavenuziano/Clawde/pull/22) | `4d63b60` | +178 / -11 | T-097..T-100 |
| **Total** | 4 | — | **+957 / -82** | **22 tasks** |

Implementer: Codex em todos os 4. Reviewer: Claude em todos; operador adicionou
dupla review em P2.6 (T-092/T-096) e P2.7 (T-097/T-098/T-099) por serem `security`.

## Métricas

- Test count: 606 (Wave 3 close em `5830941`) → 640 (Wave 4 close em `ce49c6f`), **+34 testes**.
- Files touched: 30 (`src/` + `tests/` + `docs/`).
- New DB migrations: **2**
  - `004_event_kind_check.up.sql` (P1.4) — recria `events` com `CHECK (kind IN (...))` + `json_valid(payload)`, recria índices/triggers append-only.
  - `005_tasks_json_check.up.sql` (P1.5) — `CHECK (json_valid(depends_on))` + `CHECK (json_valid(source_metadata))` em `tasks`, recria índices e trigger `tasks_no_update`.
- New ADR: **0016** — `events-scrub-policy` (P2.7 T-100): legado imutável por padrão, scrub destrutivo só com aprovação operador.
- New test directory: `tests/security/` (P2.7 T-099) + extensões em `tests/security/log-redaction.test.ts`.
- New error class: `JsonCorruptionError` em `src/db/repositories/tasks.ts` (P1.5 T-088), com `rowId/column/rawValue`.
- Sandbox runtime invariant: `network='allowlist'` agora falha-fechada com mensagem literal `network='allowlist' requires nftables backend not yet implemented. Use 'host' explicitly.` ([bwrap.ts:95-101](../../src/sandbox/bwrap.ts#L95-L101)).
- New event payload contract: `tool_use` migrou de `{tool, input}` para shape allowlisted por ferramenta (Bash → `{tool_name, command_summary}`, Read → `{tool_name, path}`, Edit/Write → `{tool_name, path, bytes_count}`, outras → `{tool_name}`).

## Decisões notáveis

### P1.4 — Migration recria tabela em vez de ALTER ADD CHECK

SQLite não suporta `ALTER TABLE ADD CONSTRAINT`. T-081 segue o padrão "tabela
nova → INSERT WHERE kind IN (...) → DROP antiga → RENAME", **recriando explicitamente** os índices `idx_events_*` e os triggers `events_no_update`/
`events_no_delete`. Decisão crítica em append-only: T-082 limita rows
descartadas (kind fora do whitelist) a 5 — mais que isso falha a migration
assumindo corrupção, pra evitar perda silenciosa de auditoria.

`EVENT_KIND_VALUES` em `src/domain/event.ts` virou source of truth: qualquer
kind novo precisa de update lá + nova migration.

### P1.5 — Defesa em dois níveis: schema + tipo de erro

Schema-level: `CHECK (json_valid(...))` impede que rows novas inseridas com
JSON corrompido entrem na DB. Application-level: `JsonCorruptionError` tipado
em `rowToTask` e `rowToEvent` lança com `rowId/column/rawValue` quando
`JSON.parse` quebra na leitura — degradação graciosa em vez de panic. CLI
queue trata como warning (T-091). Resultado: corrupção pré-migration é
detectada e isolada por row, sem derrubar o serviço.

### P2.6 — Fail-closed em vez de degradar pra `host`

`network='allowlist'` ficou aspiracional (depende de backend nftables/netns
ainda não implementado). Codex teve duas opções: degradar silenciosamente pra
`host` (rede aberta) ou falhar com erro claro. Escolha foi fail-closed —
[bwrap.ts:95-101](../../src/sandbox/bwrap.ts#L95-L101) lança a mensagem
literal do spec. Schema (`AgentSandboxSchema`) ainda aceita `"allowlist"` por
compat de configs existentes. `clawde migrate status --audit-sandbox` audita
agentes que ainda declaram `network='allowlist'`; com `--fail-on-allowlist`,
exit 2 vira CI gate. Trade-off: configs que dependiam do degradar-pra-host
quebram explicitamente, mas o histórico mostra que ninguém estava usando isso
em produção (network='loopback-only' / 'none' eram os defaults reais).

### P2.7 — Defesa em profundidade (allowlist no shape + redact no insert)

`tool_use` event payload virou allowlist literal por ferramenta (em
[handlers.ts:42-95](../../src/hooks/handlers.ts#L42-L95)) — Bash perde env/stdin/etc, fica só `command_summary` (80 chars). Mesmo que o resumo
"vaze" um secret, `EventsRepo.insert` chama `redact()` antes de
`JSON.stringify` ([events.ts:71-72](../../src/db/repositories/events.ts#L71-L72)). Os dois lados são independentes — bug em um não invalida o outro.

ADR 0016 estabelece que events legados (gerados antes deste commit) ficam
imutáveis por padrão. Considera 3 alternativas (manter imutável + audit, scrub
manual com aprovação, exportar lista). Decisão: nenhum scrub destrutivo
automático — qualquer remoção viola contrato append-only e exige decisão
operador separada. Audit command (`audit-scrub.ts`) marcado opcional no spec,
não shipado.

### Schema breaking change (P2.7) merece nota

`tool_use` saiu de `{tool, input}` pra `{tool_name, ...}`. Verificado via
`grep` — sem outros consumidores em `src/`/`tests/`. Mas dashboards/queries
externos baseados em `payload.tool` quebrariam silenciosamente. Worth flagar
em PR bodies futuros que mudam shape de evento (followup #14 abaixo).

## Critérios de validação

### CI em main após todos os merges

- `bun run typecheck` ✅ (`tsc --noEmit` clean)
- `bun run lint` ✅ (2 warnings históricos em bootstrap tests, pré-existentes)
- `bun test` 640 / 640 ✅ (uma rodada em workspace ext4 limpo)

### Smoke E2E

- `tests/integration/sandbox-bwrap.test.ts` cobre fail-closed allowlist + success path com flag. ✅
- `tests/integration/cli-migrate.test.ts` cobre `migrate status --audit-sandbox` (warn, exit 0) e `--fail-on-allowlist` (exit 2). ✅
- `tests/security/log-redaction.test.ts` cobre redact de `sk-ant-*` em `command_summary` persistido. ✅
- `tests/property/event-kind-roundtrip.test.ts` cobre todos `EVENT_KIND_VALUES` (round-trip insert + read back). ✅
- `tests/unit/db/event-kind-check.test.ts` cobre rejeição de kind inválido pelo CHECK. ✅
- `tests/unit/db/tasks.repo.test.ts` extendido com casos `JsonCorruptionError`. ✅

### Critérios CONSOLIDATED_FIX_PLAN

- **P1.4**: `EVENT_KIND_VALUES` cobre todos kinds emitidos (T-079) + CHECK constraint ativo + triggers append-only recriados ✅
- **P1.5**: `json_valid()` em `tasks.depends_on/source_metadata` + `events.payload` (via P1.4); `JsonCorruptionError` exposto em repos ✅
- **P2.6**: bwrap throw quando `network='allowlist'` sem backend; runtime e schema desacoplados; `clawde migrate audit` disponível ✅
- **P2.7**: `redact()` chamado em `EventsRepo.insert`; `tool_use` payload allowlisted; ADR 0016 estabelece política de scrub; teste de segurança cobre Bash + Anthropic token ✅

### Migração de workspace (NTFS → ext4) durante a Wave

P2.6 e antes rodaram em `/mnt/c/Users/pcdan/Clawde/Clawde` (NTFS via WSL2). P2.7
foi implementado já em `/home/pcdan/clawde/Clawde` (ext4 nativo). Resultado: o
flaky histórico `findExpiredLeases` ficou raro mas **não sumiu** (ainda
reproduz esporadicamente em full suite). Confirmação de hipótese parcial: o
overhead de NTFS contribuía mas não era a causa única. Race remanescente
provavelmente lease 1s vs sleep 1.5s margem ainda apertada — fix potencial
sobe `1500 → 2500` em `tests/unit/db/task-runs.repo.test.ts:116`.

## Wave 3 followups (mergeados na mesma janela, escopo separado)

| PR | Merge | Origem |
|----|-------|--------|
| [#13](https://github.com/Incavenuziano/Clawde/pull/13) | `60cfc9c` | Alerta 2 do review do PR #12 — `level=2 + Bash` runtime mismatch (implementer/verifier → level=1; code-quality-reviewer perde Bash). Inclui guard em `loadAllAgents` que warn-loga em bootstrap quando algum agente declara Bash com level≥2. |
| [#14](https://github.com/Incavenuziano/Clawde/pull/14) | `f91b10c` | Alerta 1 do review do PR #12 — Read sem allowlist em telegram-bot/github-pr-handler (auto-resposta = exfiltração). `allowed_reads` 3-state (`undefined`/`[]`/`[paths]`); telegram-bot e github-pr-handler ficam fail-closed. Conflito com handlers.ts do P2.7 resolvido em `447f2ce`. |

Estes PRs são tecnicamente Wave 3 (alertas do P2.5b), mas merged depois da
Wave 4 fechar. Citados aqui pra contexto cross-PR no mesmo período de trabalho.

## Followups abertos

| Item | Origem | Severidade |
|------|--------|------------|
| Audit `--audit-sandbox` só em `migrate status`; flag silenciosamente ignorada em `up`/`down` | P2.6 review (claude) | nit |
| `migrate.ts:97-101` redundância `audit.shouldFail && findings.length > 0` (tautologia com `failOnSandboxAllowlist`) | P2.6 review (claude) | nit cosmético |
| `secrets.ts:44` regex `/sk-ant-[a-zA-Z0-9_-]+/g` torna patterns Anthropic existentes (`{32,}` API key, `oat01-`) redundantes — todas viram subset | P2.7 review (claude) | cleanup |
| `estimateWriteBytes` inclui `old_str` na lista de candidatos (Edit) — semanticamente errado, marginal por causa da ordem | P2.7 review (claude) | nit |
| Schema breaking change `tool_use {tool,input}` → `{tool_name,...}` sem flag em PR body | P2.7 review (claude) | processo (PR template) |
| "Log eventual perda de dados úteis" em redact (T-097 acceptance) — soft requirement não implementado | P2.7 review (claude) | followup |
| Teste para "outras tools" (`Grep`/`WebFetch` → `{tool_name}` only) ausente | P2.7 review (claude) | cobertura |
| Flaky `findExpiredLeases` ainda reproduz em ext4 (raro) | cross-wave | tech-debt; fix conhecido |
| Teste de regressão pra warning "Bash + level≥2" (caso negativo) | PR #13 review | cobertura |
| `payload.toolInput.path` não-string sem teste explícito (Read allowlist) | PR #14 review | cobertura |
| Symlinks via path prefix passam check do Read allowlist (mitigado por bwrap binds em level≥2 só) | PR #14 review | tech-debt; documentar |
| Default `allowed_reads = undefined` (legacy permissivo) em implementer/verifier/code-quality-reviewer/spec-reviewer/researcher | PR #14 review | dívida — converter pra allowlists explícitas quando bwrap mature |

## Resultado

**Wave 4 fechada.** Sistema agora tem:

- DB com schema-level integrity (CHECK constraints) em `events.kind`/`payload` e `tasks.depends_on`/`source_metadata`.
- Application-level resilience a corrupção JSON via `JsonCorruptionError` tipado.
- Sandbox runtime fail-closed para `network='allowlist'`, com audit CLI disponível.
- Events com defesa em profundidade contra exfiltração: payload allowlist por tool no shape + redact no INSERT.
- Política explícita (ADR 0016) sobre legado de events: imutável por padrão, scrub só com aprovação operador.

Próxima wave (5 — Alinhamento): P3.1 já merged. P3.4 com PR #20 em review (rebased pós-migração). P3.2 (claude) e P3.5/P3.6 (codex) pending. Codex iniciou P3.5 em paralelo a esta auditoria.
