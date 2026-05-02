# Propostas para o Clawde

**Status:** proposta consolidada, nao implementada.
**Data:** 2026-05-02.
**Base:** `main` em `b3d5b3c`.
**Fontes internas lidas:**
- `ideas/interactive-layer` em `27a4b73`.
- `ideas/adversarial-pre-flight` em `eedb3a1`.

**Plano de implementacao:** [`propostas-para-o-clawde-implementation-plan.md`](./propostas-para-o-clawde-implementation-plan.md).
**Roadmap separado:** [`memory-context.md`](./memory-context.md).

Este documento consolida tres conversas que convergiram para o mesmo eixo:

1. O Clawde precisa parecer mais direto quando o operador esta presente.
2. O Clawde nao deve virar um chat wrapper nem aceitar injecao mid-stream.
3. Acoes de alto risco precisam de uma "prova de fogo" antes da execucao, nao so review depois que o trabalho ja comecou.

O objetivo e definir um proximo roadmap sem desmontar as garantias conquistadas nas Waves 1-6: fila transacional, eventos append-only, sandbox, approval gates, alertas, backups, restore drill, testes e auditoria.

O MVP interativo fica focado em Fases 0-7: ADR/RFC, Direct Mode, cancelamento, conversations, approvals, war room experimental, pre-flight foundations e adversarial pre-flight runtime. Policy hardening para quick tasks, Telegram, jobs/crons e dashboard ficam pos-MVP. Memoria, skills, templates e contexto ficam no roadmap proprio [`memory-context.md`](./memory-context.md).

---

## Decisao central

O Clawde deve ganhar uma **camada interativa sobre o motor assincrono**, nao substituir o motor por chat.

Aceitar:

- tarefas diretas com espera sincrona no CLI;
- conversas multi-turn via `session_id`/`conversation_id`;
- pausa em fronteiras auditaveis para aprovacao humana;
- cancelamento emergencial;
- pre-flight adversarial para acoes sensiveis.

Rejeitar:

- injecao mid-stream em uma invocacao SDK ja rodando;
- steering humano invisivel dentro do contexto ativo;
- dashboard que execute logica propria fora do banco/eventos;
- instalacao global de pacotes enormes de skills/hooks sem curadoria.

Esta decisao preserva a divisao de ADR 0011:

- operador presente: Claude Code continua sendo o melhor lugar para steering fino e pensamento exploratorio;
- operador ausente: Clawde continua sendo o executor headless, auditavel e recuperavel;
- operador semi-presente: Clawde pode parecer interativo por meio de turns pequenos, approvals e polling, sem mutar execucoes em andamento.

---

## Porque nao mid-stream inject

Mid-stream inject parece atraente porque resolve "quero corrigir o agente agora". Na pratica, quebra justamente o que torna o Clawde confiavel:

- replay deixa de reproduzir a execucao;
- eventos deixam de separar prompt original, acao do agente e input humano;
- crash recovery fica ambiguo;
- quota accounting e stop reasons ficam artificiais;
- canais externos poderiam virar vetor de prompt injection;
- reviews deixam de avaliar snapshots estaveis.

A alternativa Clawde-native e simples: qualquer intervencao do operador vira `operator_message` entre turns, com novo `task_run` ou nova task vinculada ao mesmo `conversation_id`. O operador ainda consegue corrigir o rumo; o sistema continua auditavel.

---

## Proposta A: Direct Mode

**Problema:** hoje o Clawde e excelente para tarefas assincronas, mas pesado para pedidos curtos.

**Proposta:** criar uma fachada sincrona sobre o core assincrono.

Comandos:

```bash
clawde ask "resuma STATUS.md"
clawde chat projeto-x "continue a revisao do ultimo ponto"
clawde queue "tarefa longa" --async
```

Modelo operacional:

1. CLI insere uma task normal.
2. CLI aciona o worker pelo fluxo existente.
3. CLI faz long-poll em `task_runs`/`events`.
4. Ao concluir, imprime uma resposta renderizada.
5. Se passar do timeout, devolve o ID e deixa a task continuar assincrona.

**Ganho:** fecha boa parte da sensacao de falta de interatividade sem alterar o worker.

**Custo estimado:** baixo, 1 semana.

---

## Proposta B: Multi-turn sessions

**Problema:** conversas simples precisam manter continuidade, mas sem virar stream vivo.

**Proposta:** modelar conversas como entidade persistente:

```sql
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  origin TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_activity_at TEXT,
  state TEXT NOT NULL CHECK (state IN ('active', 'archived', 'compact_pending')),
  lock_pid INTEGER
);
```

Exemplos de `origin`:

- `cli:<name>`;
- `telegram:<chat_id>:<thread_id>`;
- `dashboard:<uuid>`;
- `github:<repo>:<pr>`.

Cada turno e uma task nova vinculada a mesma conversa. O worker pode usar o `session_id` existente, memoria resumida e eventos anteriores para continuar. Concorrencia por conversa deve ser bloqueada por lock/reconcile para evitar dois turns simultaneos na mesma sessao.

**Ganho:** conversa persistente, recuperavel e auditavel.

**Custo estimado:** medio, 2-3 semanas incluindo schema, repos e testes.

---

## Proposta C: Pause-for-approve

**Problema:** algumas acoes precisam de consentimento humano antes de acontecer.

**Proposta:** criar approval como estado de fronteira, nao como pausa dentro do stream.

Fluxo:

1. PreToolUse ou policy detecta acao sensivel.
2. Worker cria `approval_request`.
3. Worker persiste evento `approval.requested`.
4. `task_run` vira `awaiting_approval`.
5. Worker sai limpo.
6. Operador aprova/nega via CLI, Telegram ou dashboard.
7. Se aprovado, Clawde cria uma continuacao como novo `task_run` ou follow-up task.

Schema proposto:

```sql
CREATE TABLE approval_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_run_id INTEGER NOT NULL REFERENCES task_runs(id),
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  state TEXT NOT NULL CHECK (state IN ('requested', 'approved', 'denied', 'expired')),
  resolved_by TEXT,
  trigger TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  follow_up_task_id INTEGER REFERENCES tasks(id)
);
```

Comandos:

```bash
clawde approvals list
clawde approvals show <id>
clawde approvals approve <id> --reason "ok, snapshot feito"
clawde approvals deny <id> --reason "risco alto demais"
```

**Ganho:** o operador ganha controle real sem perder auditabilidade.

**Custo estimado:** medio, 1-2 semanas.

---

## Proposta D: Adversarial Pre-flight, a prova de fogo

**Problema:** o review atual pega problemas durante ou depois da execucao. Para operacoes caras, destrutivas, longas ou sensiveis, isso e tarde demais.

**Proposta:** antes de executar determinadas tasks, rodar uma deliberacao adversarial curta. A task so segue se passar na prova de fogo.

### Quando ativar

Nao deve ser default para tudo. Deve ser ativado por policy:

- prioridade `CRITICAL`;
- tags como `needs-review`, `destructive`, `external-system`, `schema-change`;
- agentes com `pre_flight.enabled = true`;
- comandos explicitamente pedidos com `--pre-flight`;
- operacoes que envolvam DB migration, purge, backup/restore, OAuth, secrets, deploy, shell com rede, ou escrita fora do workspace esperado.

### Agentes

O trio sugerido e bom:

- `planner`: cria abordagem, fases, riscos e criterio de sucesso;
- `adversary`: ataca suposicoes, procura caminho mais simples e objeções;
- `risk-assessor`: avalia irreversibilidade, dados, seguranca e sistemas externos.

Os agentes devem ser read-only por default. A prova de fogo nao executa o plano; ela julga se o plano merece execucao.

### Resultado

```typescript
type PreFlightVerdict = "APPROVED" | "NEEDS_HUMAN" | "BLOCKED";
type Risk = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
```

Regras:

- `CRITICAL` bloqueia por padrao;
- override de `CRITICAL` exige operador autenticado via CLI/dashboard, justificativa textual e evento `pre_flight_critical_override`;
- Telegram nunca pode executar override de `CRITICAL`;
- `HIGH` exige humano, salvo policy explicita;
- objeção `BLOCK` nao resolvida exige humano;
- `LOW`/`MEDIUM` sem block pode aprovar;
- max rounds evita loop infinito;
- todo round gera evento auditavel.

Tabela:

| Risco | Block adversarial | Resultado |
|-------|-------------------|-----------|
| CRITICAL | qualquer | `BLOCKED` por padrao; override auditado so via CLI/dashboard |
| HIGH | qualquer | `NEEDS_HUMAN` |
| MEDIUM | sim | `NEEDS_HUMAN` |
| MEDIUM | nao | `APPROVED` |
| LOW | qualquer sem veto critico | `APPROVED` |

### Integracao

Ordem proposta no worker:

1. carregar task;
2. reconciliar lease/quota;
3. se policy pede pre-flight, rodar `runPreFlight`;
4. `BLOCKED`: persistir evento e finalizar;
5. `NEEDS_HUMAN`: criar approval/pending state;
6. `APPROVED`: seguir para execucao normal.

Eventos candidatos:

- `pre_flight_started`;
- `pre_flight_round`;
- `pre_flight_approved`;
- `pre_flight_needs_human`;
- `pre_flight_blocked`.
- `pre_flight_critical_override`.

Config:

```toml
[review.pre_flight]
enabled_for_priorities = ["CRITICAL"]
enabled_for_tags = ["needs-review", "destructive", "external-system"]
auto_approve_risk = ["LOW", "MEDIUM"]
require_approval_risk = ["HIGH"]
block_risk = ["CRITICAL"]
max_rounds = 3
timeout_minutes = 30
```

AGENT.md:

```toml
[pre_flight]
enabled = true
max_rounds = 2
require_approval = "high"
```

**Ganho:** reduz trabalho desperdicado e pega riscos antes da execucao.

**Custo estimado:** medio/alto, 2-3 semanas se incluir schema, eventos, Telegram e testes.

---

## Proposta E: Cancelamento emergencial

**Problema:** panic-stop para o sistema existe, mas cancelar uma task especifica em andamento ainda deve ser um primitivo proprio.

**Proposta:**

- `task_runs.cancel_requested_at`;
- `clawde cancel <task-id> --reason "..."`
- worker checa entre turns e em hooks;
- ao cancelar, persiste `task_cancelled`, limpa recursos e sai.

Isso nao e steering. E freio.

**Custo estimado:** baixo, 3-5 dias.

---

## Proposta F: Dashboard local-first

Dashboard e importante, mas deve ser consequencia dos dados do Clawde, nao um segundo cerebro.

Principios:

- bind em `127.0.0.1` por default;
- zero LLM calls no dashboard;
- estado derivado de `state.db` e eventos;
- SSE/WebSocket apenas para atualizar tela;
- sem multi-tenant no MVP;
- visual denso, operacional, mais Hermes Command Center que landing page.

Paineis MVP:

- overview de receiver/worker/quota/OAuth/DB/backup;
- activity timeline por `events`;
- tasks por estado;
- sessions/conversations;
- approvals;
- panic controls;
- agents e sandbox policy.

Repos inspiradores:

- `openclaw-mission-control`: approvals/governance/timeline;
- `builderz-labs/mission-control`: control plane e feed;
- `hermes-command-center`: linguagem visual e foco operacional;
- `netdata`: leitura rapida de saude;
- `openmct`: plugin/time/telemetry como referencia futura, nao MVP.

**Custo estimado:** alto, 2-3 semanas para MVP util.

---

## Proposta G: Memoria, contexto, skills e templates

Esta proposta continua relevante, mas foi separada do roadmap interativo para manter o MVP focado. O plano proprio esta em [`memory-context.md`](./memory-context.md).

Direcao resumida:

- templates e documentos como capacidades curadas;
- pesquisa local por default quando autorizada;
- pesquisa web apenas opt-in com `--with-web`, agente habilitado, budget e citacoes;
- memoria com IDs/citacoes e progressive disclosure;
- private tags e redaction antes de storage;
- transcript importer experimental, desligado por default;
- reflection aprendendo com approvals negados, pre-flight objections, cancels e falhas recorrentes.

Observacao de licenca: `claude-mem` e AGPL-3.0. Ideias sao aproveitaveis, mas copiar codigo para o Clawde deve ser evitado salvo decisao explicita.

---

## Ordem recomendada

### MVP interativo

1. ADR/RFC.
2. Direct Mode minimo.
3. Cancelamento por task.
4. Conversations e multi-turn base.
5. Approval boundary.
6. War room experimental.
7. Pre-flight foundations.
8. Adversarial Pre-flight runtime.

### Pos-MVP

1. Policy hardening para quick tasks.
2. Telegram quick tasks e approvals.
3. Jobs/crons como entidade backend.
4. Dashboard observacional.
5. Dashboard operacional.

### Roadmap separado

Memoria, contexto, skills, templates, web research e transcript importer ficam em [`memory-context.md`](./memory-context.md).

---

## Prioridade pratica

Maior retorno rapido:

1. ADR/RFC.
2. `clawde ask`.
3. `clawde cancel`.
4. conversations.
5. approvals.
6. war room.
7. pre-flight.

Ordem safety-first:

1. ADR/RFC.
2. approvals.
3. war room.
4. pre-flight.
5. cancel.
6. direct mode.
7. Telegram.
8. dashboard.

Minha recomendacao: comecar pelo caminho de retorno rapido, mas manter approval/pre-flight como proximos marcos obrigatorios. Quick task policy deve vir depois do Direct Mode minimo gerar uso real.

---

## Backlog candidato

### P7.0 ADR and RFC

- T-144: ADR interactive layer sem mid-stream injection.
- T-145: RFC pre-flight adversarial com policy de ativacao.
- T-146: RFC Telegram callback verification.
- T-147: atualizar REQUIREMENTS/BLUEPRINT com direct mode, task.profile e approval boundaries.

### P7.1 Direct Mode

- T-148: `clawde ask` com long-poll.
- T-149: testes de sucesso/falha/timeout async fallback.

### P7.2 Cancel

- T-150: `clawde cancel`.
- T-151: worker cancel gate.
- T-152: stopReason/status `cancelled`.

### P7.3 Conversations

- T-153: migration `conversations`.
- T-154: `clawde chat <name>`.
- T-155: locks/reconcile/backfill de origins pre-existentes.

### P7.4 Approval boundary

- T-156: schema `approval_requests`.
- T-157: `awaiting_approval` em `task_runs`.
- T-158: CLI approvals.
- T-159: worker approval gate e continuation.

### P7.5 War room

- T-160: `.claude/skills/war-room/SKILL.md`.
- T-161: `docs/playbooks/war-room.md`.
- T-162: exemplos migration/purge/task simples.

### P7.6 Pre-flight foundations

- T-163: schemas/config/event kinds de pre-flight.
- T-164: agentes planner/adversary/risk-assessor.
- T-165: consensus engine e state machine com approvals.
- T-166: testes de veto critico, high risk, max rounds e malformed output.

### P7.7 Adversarial Pre-flight runtime

- T-167: runner integration antes de `processTask`.
- T-168: CRITICAL override auditado por CLI/dashboard.
- T-169: testes de override, crash/reconcile e approval timeout.

### P7.8 Quick task policy

- T-170: `task.profile = quick | normal | long_running`.
- T-171: `clawde ask` passa a criar profile `quick`.
- T-172: web research opt-in com `--with-web` e agente habilitado.
- T-173: budgets/limits/escalation para quick tasks.

---

## Criterios de aceite globais

Qualquer implementacao dessas propostas deve preservar:

- `bun run typecheck` limpo;
- `bun run lint` limpo;
- `bun test` limpo;
- eventos append-only para decisoes humanas e automaticas;
- crash recovery testado;
- nenhuma injecao mid-stream;
- nenhuma nova permissao externa sem config explicita;
- docs atualizados junto com behavior runtime.

---

## Decisao pendente do operador

Antes de implementar, o operador deve escolher:

1. `clawde ask` timeout default deve ser 60s, 120s ou configuravel por profile?
2. Quick tasks podem furar fila sempre ou so quando nao houver task CRITICAL/running?
3. Telegram pode criar normal tasks ou apenas quick tasks no MVP?
4. Web research entra apenas com `--with-web` e agente explicitamente habilitado?
5. CRITICAL override deve exigir reautenticacao local no dashboard?
6. Dashboard MVP deve ser read-only puro ou ja incluir criar/cancelar tasks?
7. Jobs/crons devem usar systemd timers gerados ou scheduler interno no Clawde?

Recomendacao: `clawde ask` timeout default de 120s; quick tasks nao interrompem CRITICAL/running; Telegram MVP cria quick tasks e approvals; web research e opt-in; CRITICAL override exige operador local e justificativa; dashboard MVP read-only; jobs/crons primeiro como entidade backend que enfileira tasks.
