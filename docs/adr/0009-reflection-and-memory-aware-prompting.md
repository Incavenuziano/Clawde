# ADR 0009 — Reflection layer + memory-aware prompting

- **Status:** Accepted
- **Date:** 2026-04-29
- **Decisores:** @Incavenuziano

## Contexto

ADR 0003 estabeleceu memória nativa via FTS5 + observations dos hooks. Discussão posterior
expôs que isso é **lite-RAG passivo** — indexa o passado mas não enseja aprendizado real.
Validação contra `BEST_PRACTICES.md` §6.3 e contra Hermes (Hindsight) mostrou 2 lacunas:

1. **Sem destilação ativa** — observations acumulam mas o sistema nunca extrai padrões/regras
   gerais ("nas últimas N tasks de PR review, sempre perco SQL injection em concat raw").
2. **Memória existe mas não é usada** — sem hook que **automaticamente** injete top-K
   relevante em cada invocação, o agente segue ignorante do próprio passado.

O usuário ratificou: aprendizado é prioridade. Hermes/OpenClaw fazem (a) retrieval bem mas
fracassam em (c) destilação. Clawde pode superar nessa dimensão se adotar reflexão + memory-aware
prompting como camadas explícitas.

## Decisão

Três adições à camada de memória do Clawde:

**1. Reflection job (`clawde-reflect`)**
- Systemd timer, default a cada 6h (configurável `reflection.interval_hours`).
- Sub-agente dedicado em `.claude/agents/reflector/` lê `events` + `messages_fts` recentes
  (janela `reflection.window_hours` default=24).
- Extrai padrões, escreve `memory_observations` com `kind='lesson'` e `importance REAL`.
- Marca observations brutas que viraram lições com `consolidated_into INTEGER` (FK).

**2. Memory-aware prompting (automático)**
- Worker, antes de invocar SDK, chama `searchMemory(taskContext, topK=5)` que retorna
  top-K mix (FTS5 + embedding se ligado + boost por `importance`).
- Resultados envelopados em `<prior_context source="clawde-memory">…</prior_context>` e
  injetados via `--append-system-prompt`.
- Configurável por agente em `AGENT.md` frontmatter (`memoryAware: true|false`,
  `memoryTopK: N`).

**3. Importance scoring + pruning**
- Reflection job atualiza `memory_observations.importance` (0.0-1.0) via LLM-as-judge.
- Score baseado em: recência, frequência de match, citação em outras lessons, uniqueness.
- Job mensal podua observations com `importance < 0.2 AND created_at < 90 days`,
  preservando lessons (sempre).

## Consequências

**Positivas**
- Aprendizado real em (c) destilação — algo que Hermes/OpenClaw fazem fracamente ou não fazem.
- Lessons compoõem ao longo do tempo, viram "sabedoria operacional" do daemon.
- Memory deixa de ser arquivo morto; cada invocação se beneficia.
- Sub-agente `reflector` é reusável: pode ser invocado on-demand via `clawde reflect now`.
- Padrão alinhado com Reflexion (Shinn et al, 2023) e Hindsight do Hermes.

**Negativas**
- **Custo de quota** — reflection consome mensagens Max (1 invocação a cada 6h ≈ 4/dia ≈ 120/mês).
  Mitigação: roda em horário off-peak, prioridade `LOW`.
- **Memory-aware prompting consome contexto** — top-5 observations adicionam ~2-5K tokens
  por invocação. Mitigação: cap configurável + fallback se tarefa simples.
- **Risco de prompt pollution** — lições mal-extraídas podem enviesar o agente. Mitigação:
  spec-reviewer (ADR 0004) revisa output do reflector antes de persistir.
- **Implementação não-trivial** — adicional Fase 5 ganha 4 tasks (ver BACKLOG).

**Neutras**
- Reflexão pode ser pulada inicialmente (`reflection.enabled=false` no config) — feature
  opt-in até estabilizar.

## Alternativas consideradas

- **Memory passiva (ADR 0003 sozinho)** — descartada (motivo central da discussão).
- **RAG completo com Chroma/Qdrant** — descartado por overhead operacional (ADR 0003).
- **CLAUDE.md como repositório estático de lições** — manual, não cresce, não testa
  retroativamente.
- **Continual fine-tuning (RLHF/DPO)** — research-level, descartado pra produção.

## Referências

- ADR 0003 (memória nativa — base sobre a qual esta ADR adiciona).
- ADR 0004 (two-stage review — spec-reviewer revisa output do reflector).
- ADR 0008 (Agent SDK — `reflector` é sub-agente como qualquer outro).
- `BEST_PRACTICES.md` §6.3 (eventos `kind='lesson'`).
- Reflexion — https://arxiv.org/abs/2303.11366
- Hindsight (Hermes `plugins/memory/hindsight/`) — fonte do padrão.
