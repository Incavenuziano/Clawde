# Clawde — Requisitos

> Escopo ratificado pelo operador antes do bootstrap. Mudança aqui exige ADR
> superseding os relacionados. **Não-objetivos são parte do contrato** — recusas
> conscientes, não esquecimentos.

## Contexto operacional

- **Operador:** 1 pessoa (Incavenuziano).
- **Hosts alvo:** Linux (servidor + laptop). macOS apenas dev local; **não é alvo de produção**.
- **Plano Anthropic:** Max subscription (5x ou 20x), uso headless via OAuth token.
- **Volume esperado:** dezenas a baixas centenas de tasks/dia. Não é multi-tenant.
- **Coexistência:** Clawde + Claude Code interativo lado a lado (ADR 0011).

## Requisitos funcionais

### RF-01 — Enfileiramento de tasks
Receiver HTTP aceita tasks via POST `/enqueue` (unix socket pra CLI, HMAC pra
Telegram/GitHub webhook). Ver `BLUEPRINT.md` §3.

### RF-02 — Execução headless via Agent SDK
Worker oneshot processa tasks usando `@anthropic-ai/claude-agent-sdk`. ADR 0008.

### RF-03 — Sessões persistentes e continuáveis
UUID determinístico via `--session-id`. Sessões compartilhadas com Claude Code
interativo (mesmo `~/.claude/projects/<hash>/`). ADR 0011.

### RF-04 — Audit trail completo append-only
Todo evento operacional registrado em `events` (PRAGMA trigger reforça
imutabilidade). `BEST_PRACTICES.md` §7.

### RF-05 — Memória nativa indexada
JSONL nativos do Claude Code indexados em FTS5 + (opcional) embeddings via
`@xenova/transformers`. ADR 0003 + ADR 0010.

### RF-06 — Aprendizado por reflexão
Reflector sub-agent extrai lições de observations/events; memory-aware prompting
injeta top-K em cada invocação. ADR 0009. **Prioridade alta.**

### RF-07 — Two-stage review obrigatório (tasks `priority>=NORMAL`)
Pipeline `implementer → spec-reviewer → code-quality-reviewer → verifier` em
fresh context. ADR 0004.

### RF-08 — Sandbox em níveis (tools)
3 níveis (systemd hardening / +bwrap / +netns) selecionáveis por agente em
`sandbox.toml`. No estado atual, nível 2/3 é aplicado em tool calls (`Bash`,
`Edit`, `Write`) via hooks; o worker segue in-process com hardening systemd
nível 1. ADR 0015. Linux only (RF não-alvo: macOS prod).

### RF-09 — Quota tracking
`quota_ledger` com sliding window 5h, política por priority, peak hours
multiplicador. `ARCHITECTURE.md` §6.6.

### RF-10 — OAuth refresh proativo
Detecta 401 + check semanal de expiry + auto-refresh quando viável. ADR 0006.

### RF-11 — Backup 3-2-1 + restore drill mensal
Backups hourly/daily/weekly/monthly + drill obrigatório. `BEST_PRACTICES.md` §10.

### RF-12 — CLI completa
`clawde queue|logs|trace|quota|sessions|smoke-test|diagnose|panic-stop|panic-resume|forget|audit|migrate|memory|reflect|config|version`. `BLUEPRINT.md` §6.

## Requisitos não-funcionais

| ID | Requisito | Critério |
|----|-----------|----------|
| RNF-01 | RAM idle do receiver | ≤50MB (95th percentile) |
| RNF-02 | Cold start do worker | ≤3s (sem warmup), ≤5s alerta |
| RNF-03 | Latência receiver → worker fire | ≤1s (event-driven via systemd `.path`) |
| RNF-04 | `state.db` size 1 ano de uso | <500MB; alerta >2GB |
| RNF-05 | Receiver p99 enqueue | <50ms; alerta >200ms |
| RNF-06 | Smoke test diário | <2min, exit 0 = saudável |
| RNF-07 | Restore drill mensal | <5min, sem intervenção manual |
| RNF-08 | Cobertura testes | ≥80% statements em diffs novos |
| RNF-09 | `systemd-analyze security` worker | score ≤2.0 (highly hardened) |
| RNF-10 | Migrations | reversíveis (`up`+`down`), idempotentes |
| RNF-11 | Audit imutabilidade | UPDATE/DELETE em `events` falham via trigger |
| RNF-12 | Logs nunca vazam secrets | `grep` por tokens em logs retorna 0 |

## Não-objetivos explícitos (descarte consciente)

| Não-objetivo | Por quê | ADR/Doc |
|--------------|---------|---------|
| Multi-provider (OpenAI/Google/Ollama/etc) | Vantagem econômica vem de Max; complexity tax não vale | ADR 0012 |
| Multi-user / multi-tenant | Single-user simplifica; ADRs assumem isso | ADR 0002 + 0003 |
| Suporte a macOS em produção | Sandbox bwrap/tools é Linux-only; macOS = dev local | ADR 0015 |
| Substituir Claude Code interativo | Coexistência por design; eixo síncrono ≠ assíncrono | ADR 0011 |
| Channels além de Telegram + webhook genérico | Escopo: WhatsApp/Discord/Slack/Signal não cabem agora | ARCHITECTURE §1.3 |
| Skills hub com 85+ extensões prontas | Não é gateway tipo OpenClaw; agentes custom em `.claude/agents/` | ARCHITECTURE §4.2 |
| Continual fine-tuning de modelo | Research-level; Clawde faz aprendizado por reflexão (ADR 0009) | ADR 0009 |
| RAG completo com Chroma/Qdrant | Overhead de daemon externo; lite-RAG nativo + reflexão entrega | ADR 0003 + 0009 |
| Embedding via API paga (OpenAI/Voyage/Cohere) | Restrição explícita do operador | ADR 0010 |
| Slash commands UI / IDE integration | Domínio do Claude Code, não do Clawde | ADR 0011 |
| Streaming visível live ao operador | Headless por design; logs async substituem | ADR 0011 |
| ESC/cancel mid-stream interativo | Re-enqueue é o equivalente | ADR 0011 |
| Fallback automático pra modelo open-source local | Qualidade insuficiente hoje; reavaliar quando atingir paridade | ADR 0012 |

## Restrições de implementação ratificadas

- **Stack:** TypeScript + Bun + `@anthropic-ai/claude-agent-sdk`. ADR 0001 + 0008.
- **Persistência:** SQLite único (`bun:sqlite` + WAL + `sqlite-vec` + FTS5 trigram).
- **Embeddings:** `Xenova/multilingual-e5-small` via WASM. ADR 0010.
- **Sem deps de runtime externas** (sem Ollama, sem Chroma, sem MCP servers críticos).
- **Sandbox obrigatório** em todo worker (Nível 1 mínimo) e gate de tools para níveis 2/3. ADR 0015.

## Riscos aceitos (registrados, não mitigados além do necessário)

1. **Anthropic muda política Max headless** → pivot pra API key (módulo `src/sdk/`
   isolado). ADR 0012.
2. **Anthropic outage** → downtime total do Clawde; tasks acumulam em `pending`. ADR 0012.
3. **Bun runtime jovem** → edge cases possíveis; pin de versão + smoke test diário. ADR 0001.
4. **macOS dev sem sandbox completo** → trabalho dev em macOS roda nível 1 only; nunca
   processa input externo não-confiável fora de Linux. ADR 0015.

## Versionamento deste documento

- Mudança em RF/RNF requer ADR justificando.
- Mudança em Não-objetivos requer ADR superseding o relacionado.
- Mudança em Restrições/Riscos aceitos: idem.
- Histórico via git log.
