# Clawde

> Daemon pessoal de execução de tasks que usa Claude Code headless via Max subscription.
> Receiver always-on minimal + worker oneshot event-driven. Não substitui Claude Code
> interativo — coexistem.

**Status:** Fase de design completa, implementação ainda não começou.
**Branch ativa:** `claude/analyze-anthropic-harness-8uvLd`.

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
| [`docs/adr/`](docs/adr/) | 12 ADRs | Decisões arquiteturais imutáveis (formato MADR simplificado) |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | ~620 | 55 tasks atômicas detalhadas (Fases 1+2+3+5) + roadmap das demais |

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
   │   Agent SDK + sandbox   │  sandbox nivel 1/2/3
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

> ⚠️ **Não há código implementado ainda.** Esta seção descreve a UX-alvo após Fase 3.

```bash
# Setup inicial (uma vez)
bun install
bun run build
clawde setup-token       # gera OAuth headless 1-ano (Max subscription)
clawde migrate up

# Subir daemons (systemd user)
systemctl --user enable --now clawde-receiver clawde-worker.path clawde-smoke.timer

# Enfileirar primeira task
clawde queue --priority NORMAL "explica o que esse repo faz"

# Acompanhar
clawde logs --follow
clawde quota status
```

Configuração em `~/.clawde/config/clawde.toml`. Schema completo em
[`BLUEPRINT.md`](BLUEPRINT.md) §7.

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

| Fase | Status | Saída |
|------|--------|-------|
| **0** Design | ✅ Completo | ARCHITECTURE + BLUEPRINT + BEST_PRACTICES + 12 ADRs + REQUIREMENTS + BACKLOG |
| **1** Foundation (schema + repos) | 🔜 Próxima | 20 tasks (T01–T20) |
| **2** Worker + SDK + sessão | ⏳ | 13 tasks (T21–T33) |
| **3** Receiver + CLI local | ⏳ | 13 tasks (T34–T46) |
| **4** Sandbox 2/3 (bwrap, netns) | ⏳ Roadmap | a detalhar |
| **5** Memória + aprendizado | ⏳ | 9 tasks (T47–T55) detalhadas |
| **6** Telegram adapter | ⏳ Roadmap | a detalhar |
| **7** OAuth refresh + Datasette | ⏳ Roadmap | a detalhar |
| **8** Multi-host (Litestream) | ⏳ Roadmap | a detalhar |
| **9** Two-stage review pipeline | ⏳ Roadmap | a detalhar |

Backlog completo em [`docs/BACKLOG.md`](docs/BACKLOG.md).

## Licença

A definir (provavelmente AGPL-3.0 — alinha com `claude-mem`).

## Contribuição

Por enquanto, projeto solo. Issues bem-vindos. PRs aceitos depois da Fase 3 estar verde
(precisa de baseline funcional pra revisar contribuições com sentido).

Convenções:
- Conventional commits (`feat(scope): subject`).
- 1 PR ≤ 300 LOC; squash merge; linear history.
- CI gates obrigatórios em [`BEST_PRACTICES.md`](BEST_PRACTICES.md) §8.4.
- ADR pra qualquer decisão não-trivial.
