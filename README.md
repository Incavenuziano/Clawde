# Clawde

> Daemon pessoal de execução de tasks que usa Claude Code headless via Max subscription.
> Receiver always-on minimal + worker oneshot event-driven. Não substitui Claude Code
> interativo — coexistem.

**Status:** Plano de remediação completo — **todas as 6 waves merged** ([STATUS.md](STATUS.md)) com audits por wave em [docs/wave-summaries/](docs/wave-summaries/). Cobertura entregue:

- **Wave 1** boot/entrypoints (receiver + worker + build/systemd alignment + schema config)
- **Wave 2** operação consistente (retry, quota gate via `task_runs.not_before`, SDK errors tipados)
- **Wave 3** security core (workspace ephemeral, sandbox em tools, AGENT.md loader, external input safety, review fresh context)
- **Wave 4** hardening (EventKind CHECK constraint, JSON validity, fail-closed allowlist, redact em events)
- **Wave 5** alinhamento (CLI ops `panic-stop`/`panic-resume`/`diagnose`/`sessions`/`config`, reflect job estruturado, smoke service alinhado, SDK real validation)
- **Wave 6** hardening operacional (CI security gates: gitleaks/bun-audit/coverage; DB integrity automation; events retention 90d; alerts via Telegram+SMTP com 7 triggers; backup 3-2-1 cadenciado; restore drill mensal)

**719 testes** (717 pass, 2 skip, 0 fail em rodada estável), TypeScript strict clean. Pronto pra uso pessoal Linux. Para deploy, ver [`docs/wave-summaries/`](docs/wave-summaries/) pra o que cada wave entregou + STATUS.md pra estado atual.

## O que é

Clawde executa **tarefas headless agendadas/event-driven** delegando ao Claude Code
(Agent SDK oficial). Você usa Claude Code interativo pra trabalho síncrono (brainstorm,
debug steered, refactor live). Usa Clawde quando **não está presente**: triage noturna
de PRs, response a webhooks, batch overnight, jobs recorrentes.

Vantagens centrais (vs OpenClaw/Hermes/uso manual):

- **Custo previsível:** Max subscription fixo, não API por token.
- **Resiliência operacional:** lease/heartbeat (zombie detection), idempotency keys,
  reconcile pós-crash, audit append-only com triggers SQLite.
- **Sandbox em níveis** (systemd / +bwrap / +netns) selecionável por agente.
- **Aprendizado real** via reflection layer + memory-aware prompting (não só
  retrieval rebrandado de "learning").
- **Stack mínimo:** Bun + SQLite, binário único ~50MB compilado, ~30-50MB RAM idle.

Limitações honestas (também centrais):

- Single-user, single-host (multi-host só via Litestream na Fase 8).
- Single-provider Anthropic (sem multi-provider — decisão consciente).
- Linux only em produção (macOS é dev local).
- Bun runtime ainda jovem (edge cases possíveis).
- Sem channels além de Telegram + webhook genérico.

Ver [`REQUIREMENTS.md`](REQUIREMENTS.md) pra escopo completo + não-objetivos
explícitos.

## Quando usar Clawde vs Claude Code

| Cenário | Use |
|---------|-----|
| Brainstorm, exploração, debug com você presente | **Claude Code** |
| Refactor steered, "vou ver e ajustar" | **Claude Code** |
| Triage agendada de PRs | **Clawde** |
| Response a webhook (GitHub, Telegram) | **Clawde** |
| Smoke test diário | **Clawde** |
| Batch overnight | **Clawde** |
| Tarefa única que requer audit formal | **Clawde** |
| Coding interativo no IDE | **Claude Code** |

Eixo real é **presença do operador**, não "criativo vs execução". Detalhes em
[ADR 0011](docs/adr/0011-clawde-not-replacement-for-claude-code.md).

**Os dois compartilham**: sessões em `~/.claude/projects/<hash>/`, sub-agentes em
`.claude/agents/`, hooks em `.claude/hooks/`, `CLAUDE.md`, skills `SKILL.md`. Reuso
bilateral por design.

## Mapa do repositório

| Documento | Linhas | Cobre |
|-----------|--------|-------|
| [`README.md`](README.md) | este | Front door, pitch, quando usar |
| [`REQUIREMENTS.md`](REQUIREMENTS.md) | ~165 | Requisitos funcionais/não-funcionais + não-objetivos explícitos |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | ~1200 | Comparativo OpenClaw/Hermes/Clawde + decisões arquiteturais detalhadas |
| [`BLUEPRINT.md`](BLUEPRINT.md) | ~1130 | Spec executável: tree, tipos do domínio, OpenAPI, hooks, agents, CLI, config |
| [`BEST_PRACTICES.md`](BEST_PRACTICES.md) | ~1245 | Manual operacional: 6 invariantes + segurança + testes + logging + audit + dev/ops + incidentes |
| [`CONSOLIDATED_FIX_PLAN.md`](CONSOLIDATED_FIX_PLAN.md) | ~1200 | Plano de remediação consolidado pós-auditoria dupla (Claude + Codex) — 21 itens P0..P3 |
| [`PRODUCTION_READINESS_PLAN.md`](PRODUCTION_READINESS_PLAN.md) | ~700 | Versão Codex do plano de readiness — origem dos itens P-X.Y |
| [`EXECUTION_BACKLOG.md`](EXECUTION_BACKLOG.md) | ~1100 | Backlog atômico: 143 tasks em 6 waves, com critérios de aceite e snippets |
| [`STATUS.md`](STATUS.md) | live | Estado de cada sub-fase + check-list de tasks; atualizado por PR |
| [`docs/adr/`](docs/adr/) | 15 ADRs | Decisões arquiteturais imutáveis (formato MADR simplificado) |
| [`docs/wave-summaries/`](docs/wave-summaries/) | live | Audit de cada wave após fechamento (wave-N.md) |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | ~660 | Tasks atômicas das 9 fases originais (entregues como bibliotecas) |
| [`docs/KNOWN_GAPS.md`](docs/KNOWN_GAPS.md) | ~250 | Gaps documentados que viraram débito pós-MVP |

**Como ler primeira vez (~30 min):**
1. README (este, ~5min)
2. REQUIREMENTS (~5min) — escopo
3. ARCHITECTURE §1 + §6 + §11 (~10min) — visão e decisões core
4. ADRs (~10min) — porquês imutáveis

**Antes de implementar uma task:** ler o BLUEPRINT da seção relevante + as ADRs citadas.

## Arquitetura em 30 segundos

```
Input externo (Telegram, webhook, CLI local)
            │
            ▼
   ┌─────────────────────────┐
   │   clawde-receiver       │  always-on, ~30-50MB
   │   Bun.serve()           │  HTTP + unix socket
   │   HMAC auth + rate-limit│  só enfileira, não executa
   └────────────┬────────────┘
                │ INSERT em tasks
                ▼
   ┌─────────────────────────┐
   │   state.db (SQLite WAL) │  tasks · task_runs · sessions ·
   │                         │  messages_fts · quota_ledger ·
   │                         │  events · memory_observations ·
   │                         │  memory_fts
   └────────────┬────────────┘
                │ mtime change
                ▼
   ┌─────────────────────────┐
   │  systemd .path watcher  │
   └────────────┬────────────┘
                │ triggers
                ▼
   ┌─────────────────────────┐
   │   clawde-worker         │  oneshot, event-driven
   │   Agent SDK + sandbox   │  sandbox nivel 1 + gate de tools
   │   two-stage review      │  pipeline subagentes
   └─────────────────────────┘
```

Mais detalhes em [`ARCHITECTURE.md`](ARCHITECTURE.md) §1.3.

## Stack

- **Runtime:** [Bun](https://bun.sh) (TypeScript via `bun build --compile`)
- **SDK:** [`@anthropic-ai/claude-agent-sdk`](https://github.com/anthropics/claude-agent-sdk-typescript)
- **DB:** SQLite (`bun:sqlite`) + FTS5 trigram + [sqlite-vec](https://github.com/asg017/sqlite-vec)
- **Embeddings (opt-in):** [`Xenova/multilingual-e5-small`](https://huggingface.co/intfloat/multilingual-e5-small) via [`@xenova/transformers`](https://github.com/xenova/transformers.js)
- **HTTP:** `Bun.serve()` (sem express, hono, fastify)
- **Telegram:** [grammy](https://grammy.dev) (quando Fase 6 iniciar)
- **Sandbox:** systemd hardening + [bubblewrap](https://github.com/containers/bubblewrap)
- **Backup:** [Litestream](https://litestream.io) opcional pra multi-host (Fase 8)
- **Dashboard:** [Datasette](https://datasette.io) read-only sobre `state.db`

## Quick start

```bash
# Setup inicial (uma vez)
bun install
bun run build
claude setup-token       # OAuth headless 1-ano (Max subscription) — fora do clawde
clawde migrate up

# Subir daemons (systemd user)
mkdir -p ~/.config/systemd/user
cp deploy/systemd/clawde-*.{service,timer,path} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now clawde-receiver clawde-worker.path \
  clawde-smoke.timer clawde-oauth-check.timer clawde-reflect.timer \n  clawde-deferred-check.timer

# Enfileirar primeira task
clawde queue --priority NORMAL "explica o que esse repo faz"

# Acompanhar
clawde logs --task <run-id>
clawde trace <ulid>
clawde quota status
clawde memory search "alguma coisa"
```

### Comandos disponíveis

| Comando | Função |
|---------|--------|
| `clawde queue <prompt>` | Enfileira nova task no receiver |
| `clawde migrate <up\|status\|down>` | Aplica/reverte migrations SQLite |
| `clawde logs --task <id>` | Lista events de um task_run |
| `clawde trace <ulid>` | Mostra todos events de um trace_id |
| `clawde quota <status\|history>` | Estado da janela 5h Max + histórico |
| `clawde memory <search\|stats\|prune\|reindex\|inject>` | Memória nativa SQLite + FTS5 |
| `clawde auth <status\|check>` | Inspeciona OAuth token (source, expiry) |
| `clawde dashboard` | Probe Datasette read-only + lista canned queries |
| `clawde replica <status\|verify>` | Saúde do Litestream snapshot remoto |
| `clawde review history <run-id>` | Eventos do pipeline de review |
| `clawde smoke-test` | Verifica DB, migrations, receiver health |
| `clawde version`, `clawde help` | Meta |

Use `--output json` em qualquer subcomando pra parse machine-readable.

Configuração em `~/.clawde/config/clawde.toml`. Schema completo em
[`BLUEPRINT.md`](BLUEPRINT.md) §7.

### Opcionais

- **Embeddings semânticos** (Fase 5): `bun add @xenova/transformers` →
  `clawde memory reindex --provider xenova`. Sem isso, busca é FTS5 trigram.
- **Telegram input** (Fase 6): defina `telegram.secret` + `telegram.allowed_user_ids` no `clawde.toml`,
  configure `setWebhook` apontando pra `clawde-receiver:18790/webhook/telegram`.
- **Datasette dashboard** (Fase 7): `pipx install datasette` →
  `systemctl --user enable --now clawde-datasette`. Acesse `http://127.0.0.1:18791`.
- **Multi-host backup** (Fase 8): instale `litestream`, edite
  `deploy/litestream/litestream.yml` com bucket B2/S3, `systemctl --user enable --now clawde-litestream`.
- **Two-stage review** (Fase 9): orquestrador `runReviewPipeline()` em código;
  worker pode wrap calls do SDK pra passar implementer → spec → quality.

### Sandbox

Por agente, em `.clawde/agents/<nome>/sandbox.toml`:

```toml
level = 2          # 1 (systemd) | 2 (+ bwrap) | 3 (+ netns)
network = "host"   # host | allowlist | loopback-only | none
max_memory_mb = 1024
```

Defaults sane por agente em `defaultLevelForAgent` (`telegram-bot`/`github-pr-handler` → 3,
`implementer`/`debugger` → 2, demais → 1). No runtime atual, os gates de tool calls
(`Bash`, `Edit`, `Write`, `Read`) estão wirados no loop principal. `network="allowlist"`
permanece aceito no schema por compatibilidade, mas está em **fail-closed** até existir
backend nftables/netns: use `host` explicitamente para rede aberta. Ver ADR 0015.

## Inspirações

Validadas via leitura de código (não só docs):

- **[Hermes (NousResearch)](https://github.com/NousResearch/hermes-agent)** — Memory Provider ABC, FTS5 trigram, schema de sessions/messages.
- **[OpenClaw](https://github.com/openclaw/openclaw)** — Plugin SDK contract, padrão SKILL.md.
- **[claude-mem](https://github.com/Incavenuziano/claude-mem)** (próprio) — migrations SQLite, parser Agent SDK.
- **[clawflows](https://github.com/Incavenuziano/clawflows)** (próprio) — formato WORKFLOW.md.
- **[superpowers](https://github.com/Incavenuziano/superpowers)** (próprio) — `subagent-driven-development`, `writing-plans`.
- **[get-shit-done](https://github.com/Incavenuziano/get-shit-done)** (próprio) — hooks JS, state template, agent contract.
- **[Reflexion](https://arxiv.org/abs/2303.11366)** (Shinn et al, 2023) — reflection layer (ADR 0009).
- **[Sidekiq](https://github.com/sidekiq/sidekiq)** / **[Oban](https://github.com/oban-bg/oban)** — pattern `tasks` + `task_runs` com lease/heartbeat.

## Status & roadmap

### Status por componente: biblioteca vs daemon integrado

`✅ lib` significa que a biblioteca está implementada e testada isoladamente. `✅ integrado`
significa que o daemon (worker/receiver) consome ativamente o componente em runtime.

| Componente | Lib | Integrado | Tasks de remediação |
|-----------|-----|-----------|---------------------|
| Schema + repos (sqlite-vec, FTS5, triggers) | ✅ | ✅ | — |
| Worker runner (lease, retry, reconcile) | ✅ | ✅ | T-006/T-020/T-021 (P0.1, P1.1) |
| Receiver server (HTTP/unix, rate-limit, dedup) | ✅ | ✅ | T-001..T-005 (P0.1) |
| Main entrypoints (`receiver-main.js`, `worker-main.js`) | ✅ | ✅ | T-001..T-013 (P0.1, merged PR #2) |
| Worker trigger event-driven (systemctl + .path fallback) | ✅ | ✅ | T-014..T-018 (P0.2, merged PR #3) |
| Config schema (telegram/review/replica) | ✅ | ✅ | T-019 (P0.3, merged PR #1) |
| Quota policy + defer via `not_before` | ✅ | ✅ | T-024..T-033 (P1.2, merged PR #5) |
| SDK error tipados + auto-refresh + 429 handler | ✅ | ✅ | T-034..T-040 (P1.3, merged PR #6) |
| Workspace ephemeral (git worktree + reconcile cleanup) | ✅ | ✅ | T-041..T-046 (P2.1, merged PR #7) |
| Sandbox em tools (`PreToolUse` allowlist + path policy) | ✅ | ✅ | T-047..T-053 (P2.2, merged PR #10) |
| AGENT.md loader + agent definitions | ✅ | ✅ | T-063..T-068, T-077, T-078 (P2.5a, merged PR #11) |
| Agent profiles (.claude/agents/*.md) | ✅ | ✅ | T-069..T-076 (P2.5b, merged PR #12) |
| External input safety (XML envelope + system prompt) | ✅ | ✅ | T-054..T-057 (P2.3, merged PR #15) |
| Review pipeline fresh-context (sessionId per stage) | ✅ | ✅ | T-058..T-062 (P2.4, merged PR #16) |
| EventKind CHECK constraint + json_valid | ✅ | ✅ | T-079..T-085 (P1.4, merged PR #17) |
| Memória + aprendizado | ✅ | ✅ | (Fase 5 original — em uso via memory inject) |
| Telegram adapter | ✅ | ✅ | (Fase 6 original — `/webhook/telegram` ativa) |
| OAuth refresh + Datasette | ✅ | ✅ | (Fase 7 original — auto-refresh em 401) |
| Multi-host (Litestream) | ✅ | ⚠️ opt-in | (Fase 8 original — config-gated) |
| Two-stage review pipeline | ✅ | ✅ | (Fase 9 + P2.4 fresh context) |
| Allowlist real de egress sandbox 2/3 | ⚠️ roadmap | ✅ fail-closed | T-092..T-096 (P2.6, merged PR #21) |
| Redact em events | ✅ | ✅ | T-097..T-100 (P2.7, merged PR #22) |
| JSON validity em outras colunas TEXT | ✅ | ✅ | T-086..T-091 (P1.5, merged PR #19) |
| CLI ops (panic-stop, diagnose, sessions, reflect) | ✅ | ✅ | T-104..T-115 (P3.2/P3.4, merged PRs #25/#20) |
| Smoke service + SDK real CI | ✅ | ✅ | T-116..T-124 (P3.5/P3.6, merged PRs #24/#26) |
| Ops hardening (CI gates, alerts, backup, restore drill) | ✅ | ✅ | T-125..T-143 (Wave 6, merged PRs #29..#34) |

Backlog de remediação fechado: 143/143 tasks merged. Estado live de cada sub-fase + tasks atômicas em
[STATUS.md](STATUS.md) + [EXECUTION_BACKLOG.md](EXECUTION_BACKLOG.md).

### Roadmap original (9 fases) — bibliotecas

Backlog histórico de implementação inicial em [`docs/BACKLOG.md`](docs/BACKLOG.md).

| Fase | Status lib | Saída |
|------|------------|-------|
| **0** Design | ✅ | ARCHITECTURE + BLUEPRINT + BEST_PRACTICES + 15 ADRs + REQUIREMENTS + BACKLOG |
| **1** Foundation (schema + repos) | ✅ | `src/db/`, `src/domain/`, `src/log/`, `src/config/` |
| **2** Worker + SDK + sessão | ✅ | `src/worker/`, `src/sdk/`, `src/hooks/`, `src/quota/` |
| **3** Receiver + CLI local | ✅ | `src/receiver/`, `src/cli/`, E2E lifecycle |
| **4** Sandbox 2/3 em tools (bwrap, netns) | ✅ | `src/sandbox/` + hooks `PreToolUse` (Bash em level≥2 fail-safe; Estratégia A bwrap-subprocess deferred — ADR 0015) |
| **5** Memória + aprendizado | ✅ | `src/memory/`, hooks→memory, importance, reflector subagent |
| **6** Telegram adapter | ✅ | `src/receiver/routes/telegram.ts` + `src/sanitize/` (XML envelope) |
| **7** OAuth refresh + Datasette | ✅ | `src/auth/`, `deploy/datasette/`, `clawde dashboard` |
| **8** Multi-host (Litestream) | ✅ | `src/replica/`, `deploy/litestream/`, `clawde replica` |
| **9** Two-stage review pipeline | ✅ | `src/review/` (implementer + spec + code-quality) + fresh context (P2.4) |

719 testes (717 pass, 2 skip, 0 fail) / ~16K LOC TS + 15 ADRs + 9 docs estruturais.

## Licença

A definir (provavelmente AGPL-3.0 — alinha com `claude-mem`).

## Desenvolvimento

```bash
bun install
bun run typecheck    # tsc --noEmit
bun run lint         # biome check
bun test             # bun:test
bun run ci           # tudo acima
bun run build        # binário standalone via bun build --compile
```

Convenções:
- Conventional commits (`feat(scope): subject`).
- 1 PR ≤ 300 LOC; squash merge; linear history.
- CI gates obrigatórios em [`BEST_PRACTICES.md`](BEST_PRACTICES.md) §8.4.
- ADR pra qualquer decisão não-trivial.

## Contribuição

Por enquanto, projeto solo. Issues bem-vindos. PRs aceitos.
