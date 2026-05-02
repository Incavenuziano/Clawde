# Roadmap — Interactive Layer (post-Wave 6)

**Status:** proposta. Não implementada. Aguarda validação do operador.
**Data:** 2026-05-02
**Autores:** Claude Opus 4.7 + Codex (análise dupla, convergente).
**Contexto:** post-deploy do plano de remediação (Waves 1-6 100% merged).

---

## TL;DR

Operador questionou interatividade do Clawde antes do primeiro deploy real. Análise dupla das opções produziu convergência sobre **3 patterns aceitáveis** + **1 pattern explicitamente rejeitado**. Plano de 7 fases (~6-9 semanas total) que faz o Clawde **parecer interativo ao operador sem deixar de ser um motor transacional, pausável, auditável e recuperável**.

> "Clawde não deve virar chat wrapper; deve ganhar uma camada interativa em cima do motor auditável." — síntese da análise.

---

## Contexto

[ADR 0011](../adr/0011-clawde-not-replacement-for-claude-code.md) estabelece o eixo "presença do operador" como axis arquitetural:
- **Operador presente:** Claude Code interativo (síncrono, steered, streaming live).
- **Operador ausente:** Clawde (assíncrono, headless, queue-driven).

REQUIREMENTS §2 explicitamente corta como **não-objetivos**:
- Streaming visível live ao operador
- ESC/cancel mid-stream interativo
- Slash commands UI

Esse roadmap **não revoga ADR 0011**. Adiciona uma camada operador-presente OPCIONAL que não compromete o comportamento operador-ausente. Default behavior continua async.

---

## Decisão arquitetural a codificar (Fase 0)

Antes de qualquer implementação, formalizar via ADR nova ("Interactive Layer Without Mid-Stream Injection"):

### ✅ Aceitar — 4 patterns

#### 1. Multi-turn conversation via session_id (extensão de RF-03)
Cada mensagem operador → backend cria **nova task** com mesmo `session_id`. Worker resume sessão (mantém contexto via SDK), processa, persiste, exit. Operador vê resposta no dashboard ou recebe via Telegram, manda outra mensagem → nova task.

**Por que aceitar:**
- RF-03 já estabelece sessões persistentes. Multi-turn = consumir RF-03 de forma operadorvisível, não nova capacidade.
- Cada turn é uma task async; operador presente é coincidência, não pré-requisito.
- Audit trail preservado: cada turn é INSERT em `tasks`/`task_runs`/`events`.
- Não viola ADR 0011 — o eixo "presente vs ausente" continua válido (presente = mensagens frequentes; ausente = mensagens esparsas).

**Custo:** 2-3 semanas (UI compose + faster trigger HTTP push além do systemd .path + feed live).
**Latência por turn:** 5-15s (worker spawn + SDK invoke + persist). "Email-like", não "chat-like".

#### 2. Pause-for-approval **at boundary** (não mid-stream)
Worker detecta ação sensível (Bash/Write/Edit em agentes flagged) **antes da execução**. Cria `approval_request`, emite `approval.requested` event, marca run como `awaiting_approval`, **sai limpo**. Operador aprova/nega via dashboard/CLI/Telegram. Clawde cria continuação como **novo task_run** (ou follow-up task) com mesmo session_id.

**Por que aceitar:**
- Continuação como novo task_run preserva append-only de events.
- Worker exit limpo respeita lease/heartbeat (sem "task pendurada").
- Crash recovery natural: se operador demorar, reconcile vê run em `awaiting_approval` e não re-enqueue.
- Default policy configurável: `auto-decide após timeout` mantém comportamento async pra operador ausente.

**Não fazer:**
- Parar no meio do stream.
- Injetar texto manual no contexto ativo.
- Tentar "continuar" um SDK stream suspended depois de minutos.
- Depender de memória mutável fora do DB.

**Custo:** 1-2 semanas (schema + hooks + CLI/dashboard endpoints).

#### 3. Fachada síncrona sobre core async
CLI ganha comandos que **bloqueiam esperando task_finish**, mantendo motor assíncrono por baixo:

```bash
clawde ask "resume STATUS.md"        # bloqueia, espera task_finish, imprime resposta
clawde chat <name> "continua de onde paramos"   # multi-turn por nome
clawde queue "tarefa longa" --async  # comportamento atual mantido
```

Por baixo:
1. Cria `task` com `conversation_id` / `session_id`.
2. Dispara worker (existing flow).
3. CLI faz long-poll em `task_runs.status`.
4. Quando finish, lê `events` da task + render output.

**Por que aceitar:**
- Zero mudança no engine. Pura camada CLI.
- Operador sente "interação direta"; sistema continua transacional.
- 80% do desejo de interatividade fechado **com infraestrutura existente** + ~1 semana de trabalho.

**Custo:** 1 semana.

#### 4. Cancel mid-flight (emergency stop)
DB flag `task_runs.cancel_requested`. Worker checa entre turns ou em PreToolUse hook. Em cancel: throw AbortError → cleanup → INSERT event `task_cancelled` → exit.

**Por que aceitar:**
- Não é steering — é parar.
- Compatível com lease/heartbeat existing.
- Hooks já existem (P2.2), só adicionar gate.
- Útil em qualquer caso de operador-presente (descobriu que enfileirou errado, quota explodiu, etc.).

**Custo:** 3-5 dias.

### ❌ Rejeitar — 1 pattern

#### Inject mid-stream
Operador injetar texto/instrução em uma task **já rodando**, modificando o contexto do SDK invocation em curso.

**Por que rejeitar (razões consolidadas):**
1. **Quebra reprodutibilidade.** Replay do log não reproduz o estado vivo.
2. **Mistura input humano com output/estado do agente.** Audit chain fica ambíguo: "essa mensagem veio do prompt original ou injection?".
3. **Dificulta crash recovery.** Lease/heartbeat assume task imutável. Worker dies mid-injection → estado parcial.
4. **Abre brecha de prompt injection externo.** Canal pra operador injetar = canal pra atacante (se houver) injetar.
5. **Complica quota accounting + stop reasons.** SDK não tem semântica nativa pra "user message injected mid-stream". Vira workaround frágil.
6. **Reviews e audits ficam menos confiáveis.** Two-stage review (RF-07) e audit trail (RF-04) assumem snapshots imutáveis.

**Alternativa Clawde-native:** `operator_message` entre turnos. Operador pode interromper, mas isso vira evento auditável + novo turn/task com mesmo session_id, **não mutação invisível do contexto ativo**. Cobre a intenção sem violar invariantes.

---

## Plano consolidado (7 fases)

| Fase | Tempo | Conteúdo | Pré-req |
|------|-------|----------|---------|
| **0. ADR + RFC** | 1 dia | Nova ADR "Interactive Layer Without Mid-Stream Injection". Codifica os 4 patterns aceitos + 1 rejeitado com razões. **Pré-requisito de tudo.** | — |
| **1. Schema** | 2-3 dias | Migration 008: `conversations` + `approval_requests` + `task_runs.status` ganha `awaiting_approval`. | Fase 0 |
| **2. CLI fachada síncrona** | 1 sem | `clawde ask`, `clawde chat <name>`. Long-poll sobre `task_runs.status`. | Fase 1 |
| **3. CLI approvals** | 1 sem | `clawde approvals list/approve/deny`, hook PreToolUse → approval queue pra agentes flagged. | Fase 1 |
| **4. CLI cancel** | 3-5 dias | `clawde cancel <task-id>` + worker poll + cleanup hook. | Fase 0 |
| **5. Telegram multi-turn** | 1-2 sem | Conversation key `telegram:<chat>:<thread>` mapeada → session_id. | Fase 1 |
| **6. Dashboard local-first** | 2-3 sem | Bun.serve + WebSocket/SSE sobre `state.db`. **Não fork mission-control.** Visual denso à la Hermes Command Center. Painéis: timeline, tasks, sessions, approvals, panic, agents. | Fases 2+3 |

**Total:** ~6-9 semanas pra cobertura completa. Cada fase deployable separada — pode parar em qualquer ponto se o subset já resolver na prática.

**ROI por fase:**
- Fase 2 (`clawde ask`) provavelmente fecha 60-70% da dor de "preciso de interatividade". Maior retorno por unidade de trabalho.
- Fase 3 (approvals) é o pulo arquitetural mais importante (state machine novo + hooks integrados).
- Fase 6 (dashboard) é "nice to have" se Fases 2+3+5 já cobrirem.

---

## Schema novo (Fase 1)

Migration 008 (esquema preliminar):

```sql
-- conversations: bind operadores externos a sessions persistentes do SDK
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  origin TEXT NOT NULL,          -- "cli:<name>" | "telegram:<chat>:<thread>" | "dashboard:<uuid>" | "github:<repo>:<pr>"
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_activity_at TEXT,
  state TEXT NOT NULL CHECK (state IN ('active', 'archived', 'compact_pending')),
  lock_pid INTEGER,              -- ownership pra prevenir 2 tasks concorrentes na mesma conversation
  UNIQUE(origin)
);

CREATE INDEX idx_conversations_session ON conversations(session_id);
CREATE INDEX idx_conversations_state ON conversations(state, last_activity_at DESC);

-- approval_requests: gate transacional pra ações sensíveis
CREATE TABLE approval_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_run_id INTEGER NOT NULL REFERENCES task_runs(id),
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  state TEXT NOT NULL CHECK (state IN ('requested', 'approved', 'denied', 'expired')),
  resolved_by TEXT,              -- operator identifier (cli user, telegram chat, dashboard session)
  trigger TEXT NOT NULL,         -- 'tool.bash', 'tool.write', 'tool.edit', etc.
  payload TEXT NOT NULL          -- JSON: {tool, args, agent, agent_dir, context_snippet}
                CHECK (json_valid(payload)),
  follow_up_task_id INTEGER REFERENCES tasks(id)  -- continuação criada se aprovado
);

CREATE INDEX idx_approvals_state ON approval_requests(state, requested_at DESC);
CREATE INDEX idx_approvals_task_run ON approval_requests(task_run_id);

-- task_runs.status ganha 'awaiting_approval'
-- (CHECK constraint update via recreate-table pattern como migration 004)
```

Lock por sessão (Fase 1+5): coluna `conversations.lock_pid` permite worker tomar exclusividade. Reconcile limpa locks de PIDs mortos no startup.

---

## CLI vocabulary (Fases 2-4)

```bash
# Fase 2 — fachada síncrona + multi-turn
clawde ask <prompt>                           # bloqueia, espera task_finish, imprime resposta
clawde chat <name> <prompt>                   # multi-turn por nome (cria conversation se ausente)
clawde queue <prompt> [--async] [--session-id=X]  # comportamento atual

# Fase 2 — sessions
clawde sessions list                          # lista (já existe)
clawde sessions show <id>                     # detalhes (já existe)
clawde sessions fork <id> [--as <new-name>]   # branch nova session com mesmo prompt history
clawde sessions archive <id>                  # marca state=archived
clawde sessions compact <id>                  # força compact_pending

# Fase 3 — approvals
clawde approvals list [--state=requested]     # ver pendentes
clawde approvals show <id>                    # detalhes da request (tool, args, agent)
clawde approvals approve <id> [--reason=X]    # libera; cria follow-up task
clawde approvals deny <id> [--reason=X]       # bloqueia definitivo

# Fase 4 — cancel
clawde cancel <task-id> [--reason=X]          # seta cancel_requested; worker reage no próximo poll
```

---

## Dashboard local-first (Fase 6)

**Decisão: NÃO fork de `builderz-labs/mission-control`.** Esse projeto é multi-tenant/team/governance — pesado pra importar como arquitetura. Pegar **patterns** (control plane adapter, SSE feed, approval UI), não o stack.

**Stack proposto:**
- `Bun.serve()` — mesma stack do receiver, sem dependência nova.
- WebSocket + SSE sobre `state.db` (file watcher ou poll curto).
- Frontend: SPA local-first (provavelmente Lit/htmx/vanilla TS — zero React/Next.js pra manter binário slim).
- Visual: denso, escuro, operacional. Inspiração: [`Incavenuziano/hermes-command-center`](https://github.com/Incavenuziano/hermes-command-center) (mesmo autor, mesma filosofia single-user/local-first).

**Painéis** (mínimo viável):
1. **Overview** — receiver/worker/quota/OAuth/DB integrity/backup/restore drill em sliders compactos.
2. **Activity timeline** — direto de `events`, filtros por `trace_id`, `task_run_id`, `kind`, severidade.
3. **Tasks** — pending/running/awaiting_approval/deferred/failed/succeeded.
4. **Sessions** — conversations + agente + msg count + stale flags.
5. **Approvals** — pending/resolved, risco, payload resumido, approve/deny inline.
6. **Panic** — botão `panic-stop`, estado do lock, `panic-resume`.
7. **Agents** — AGENT.md preview + sandbox config + allowed tools/reads/writes.

**Princípios de design:**
- **Zero LLM calls no dashboard** (Hermes principle). Tudo derived state de `state.db`.
- **Loopback default** (bind 127.0.0.1), no telemetry, no phone-home.
- **Auth opcional** desabilitada por default (single-user).

---

## Comparativo de inspirações (avaliadas em 2026-05-02)

| Repo | Uso recomendado |
|------|-----------------|
| [openclaw-mission-control](https://github.com/abhi1693/openclaw-mission-control) | **Padrão de approvals/governance.** state machine `pending/approved/rejected` + SSE stream alinhados. Inspirar, não importar stack. |
| [builderz-labs/mission-control](https://github.com/builderz-labs/mission-control) | Padrões de UI pra approvals + activity feed + control plane adapter. Não forkar — overlap funcional + complexidade multi-tenant desnecessária pra single-user. |
| [moazbuilds/claudeclaw](https://github.com/moazbuilds/claudeclaw) | `MULTI_SESSION_SPEC.md` é diretamente útil. Pattern `threadId → sessionId` encaixa, mas porting pra SQLite (não JSON). |
| [earlyaidopters/claudeclaw](https://github.com/earlyaidopters/claudeclaw) + [claudeclaw-os](https://github.com/earlyaidopters/claudeclaw-os) | Inspiração UX "Claude no bolso" + agentes/personas + war room. Menos auditável que Clawde — usar pra ideias, não código. |
| [Incavenuziano/hermes-command-center](https://github.com/Incavenuziano/hermes-command-center) | **Melhor referência visual + local-first.** Mesmo operador, princípios alinhados. |
| [nasa/openmct](https://github.com/nasa/openmct) | Plugin architecture + telemetry/time conductor. Overkill pra agora; pode inspirar dashboard depois (Fase 6+). |
| [netdata/netdata](https://github.com/netdata/netdata) | Filosofia: "operador entende o estado em segundos". Companion externo do host (system metrics), não vendor. |

---

## Decisão pendente

Antes de qualquer Fase iniciar:

1. **Operador valida a ADR formalizada** (Fase 0).
2. **Decide se faz tudo ou subset.** Plausível parar em Fases 0+2+4 (ADR + ask sync + cancel) se isso resolver na prática — Fases 3/5/6 ficam pra quando dor real surgir.
3. **Decide ordem se priorizar diferente** — ROI sugere Fase 2 primeiro, mas pause-for-approval (Fase 3) pode subir se operações destrutivas forem o gap mais sentido.

Sem validação, esse doc fica como **registro arquitetural** da análise feita pós-Wave 6 — recurso pra futuras sessões Claude/Codex (e operador) entenderem o contexto sem reconstruir do zero.

---

## Histórico

- 2026-05-02: Criado pós-deploy-question. Análise dupla Claude (Tier 1 inicial) + Codex (refinamento com schema concreto + warning sobre fork de mission-control). Convergência em 4-aceitar / 1-rejeitar.
- _(adicione entradas conforme decisões/ajustes)_

## Referências

- [ADR 0011](../adr/0011-clawde-not-replacement-for-claude-code.md) — Eixo "presença do operador"
- [REQUIREMENTS.md](../../REQUIREMENTS.md) — RF-03 sessions, RF-04 audit, RF-12 CLI, §2 não-objetivos
- [ARCHITECTURE.md](../../ARCHITECTURE.md) §6 — control flow do worker oneshot
- [BLUEPRINT.md](../../BLUEPRINT.md) §6 — CLI vocabulary atual
- [docs/wave-summaries/wave-6.md](../wave-summaries/wave-6.md) — followups que motivaram esta análise
