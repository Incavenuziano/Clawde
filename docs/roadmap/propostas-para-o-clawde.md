# Propostas para o Clawde

**Status:** proposta consolidada, nao implementada.
**Data:** 2026-05-02.
**Base:** `main` em `b3d5b3c`.
**Fontes internas lidas:**
- `ideas/interactive-layer` em `27a4b73`.
- `ideas/adversarial-pre-flight` em `eedb3a1`.

**Plano de implementacao:** [`propostas-para-o-clawde-implementation-plan.md`](./propostas-para-o-clawde-implementation-plan.md).

Este documento consolida tres conversas que convergiram para o mesmo eixo:

1. O Clawde precisa parecer mais direto quando o operador esta presente.
2. O Clawde nao deve virar um chat wrapper nem aceitar injecao mid-stream.
3. Acoes de alto risco precisam de uma "prova de fogo" antes da execucao, nao so review depois que o trabalho ja comecou.

O objetivo e definir um proximo roadmap sem desmontar as garantias conquistadas nas Waves 1-6: fila transacional, eventos append-only, sandbox, approval gates, alertas, backups, restore drill, testes e auditoria.

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

- `CRITICAL` bloqueia automaticamente;
- `HIGH` exige humano, salvo policy explicita;
- objeção `BLOCK` nao resolvida exige humano;
- `LOW`/`MEDIUM` sem block pode aprovar;
- max rounds evita loop infinito;
- todo round gera evento auditavel.

Tabela:

| Risco | Block adversarial | Resultado |
|-------|-------------------|-----------|
| CRITICAL | qualquer | `BLOCKED` |
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

## Proposta G: Memoria e contexto para Claude Code e Clawde

Os repos externos apontam para uma lacuna importante: nao basta armazenar memoria; e preciso controlar quanto e como ela entra no contexto.

Inspiracoes:

- `claude-mem`: progressive disclosure, citations, `<private>` tags, timeline, transcript ingestion;
- `get-shit-done`: `STATE.md`, fase, handoff, context rot control;
- `everything-claude-code`: catalogo de skills, continuous learning e security scan;
- `andrej-karpathy-skills`: regras simples de comportamento;
- `system-prompts-and-models-of-ai-tools`: pesquisa e red-team, nunca copia direta.

Direcao para o Clawde:

- memoria com IDs/citacoes;
- busca em camadas: resumo curto -> timeline -> detalhe;
- marcadores privados que nunca entram em storage/eventos;
- importador opcional de transcript do Claude Code;
- reflection que aprende de pre-flight objections recorrentes;
- budget de tokens por memoria injetada.

Direcao para o Claude Code do operador:

- nao instalar pacotes gigantes globalmente;
- adotar um perfil minimo e curado;
- usar GSD/ECC como biblioteca de padroes, nao como layer obrigatoria;
- incorporar os principios Karpathy no onboarding;
- usar prompts vazados apenas para red-team e testes adversariais.

Observacao de licenca: `claude-mem` e AGPL-3.0. Ideias sao aproveitaveis, mas copiar codigo para o Clawde deve ser evitado salvo decisao explicita.

---

## Ordem recomendada

### Fase 0: ADR de interatividade e prova de fogo

Criar ADR "Interactive Layer Without Mid-Stream Injection".

Conteudo:

- aceita direct mode, multi-turn, approvals, cancel, pre-flight;
- rejeita mid-stream injection;
- define invariantes de auditabilidade;
- define quando pre-flight e obrigatorio.

**Tempo:** 1 dia.

### Fase 1: Schema foundations

Adicionar:

- `conversations`;
- `approval_requests`;
- status `awaiting_approval`;
- campos/eventos para cancel;
- event kinds de pre-flight.

**Tempo:** 3-5 dias.

### Fase 2: Direct Mode CLI

Implementar:

- `clawde ask`;
- `clawde chat`;
- long-poll;
- renderizacao de resposta;
- timeout que degrada para async.

**Tempo:** 1 semana.

### Fase 3: Cancel + approvals CLI

Implementar:

- `clawde cancel`;
- `clawde approvals list/show/approve/deny`;
- hook de approval em fronteiras;
- testes de crash/reconcile.

**Tempo:** 1-2 semanas.

### Fase 4: Adversarial Pre-flight

Implementar:

- `src/pre_flight`;
- agentes `planner`, `adversary`, `risk-assessor`;
- consenso;
- eventos;
- config;
- Telegram/CLI para `NEEDS_HUMAN`.

**Tempo:** 2-3 semanas.

### Fase 5: Telegram multi-turn

Implementar:

- mapeamento `chat/thread -> conversation`;
- replies como turns;
- approve/deny por Telegram;
- timeouts.

**Tempo:** 1-2 semanas.

### Fase 6: Dashboard

Implementar MVP local-first:

- timeline;
- tasks;
- sessions;
- approvals;
- panic;
- health.

**Tempo:** 2-3 semanas.

### Fase 7: Context hygiene e memoria

Implementar incrementalmente:

- transcript importer;
- citations;
- private tags;
- progressive memory retrieval;
- reflection usando pre-flight outcomes.

**Tempo:** continuo.

---

## Prioridade pratica

Se quiser o maior retorno rapido:

1. ADR.
2. `clawde ask`.
3. `clawde cancel`.
4. `approval_requests`.
5. pre-flight.

Se quiser reduzir risco operacional primeiro:

1. ADR.
2. `approval_requests`.
3. pre-flight.
4. cancel.
5. direct mode.

Minha recomendacao: comecar pelo caminho de retorno rapido, mas desenhar o schema ja sabendo que approvals e pre-flight vem logo depois. `clawde ask` vai mostrar rapidamente se a camada interativa resolve a dor real sem grande investimento em UI.

---

## Backlog candidato

### P7.0 ADR and RFC

- T-144: ADR interactive layer sem mid-stream injection.
- T-145: RFC pre-flight adversarial com policy de ativacao.
- T-146: atualizar REQUIREMENTS/BLUEPRINT com direct mode e approval boundaries.

### P7.1 Direct Mode

- T-147: schema `conversations`.
- T-148: `clawde ask` com long-poll.
- T-149: `clawde chat <name>`.
- T-150: testes de timeout async fallback.

### P7.2 Approval and cancel boundaries

- T-151: schema `approval_requests`.
- T-152: `awaiting_approval` em `task_runs`.
- T-153: CLI approvals.
- T-154: `clawde cancel`.
- T-155: worker cancel/approval gates.

### P7.3 Adversarial Pre-flight

- T-156: schemas/config/event kinds de pre-flight.
- T-157: agentes planner/adversary/risk-assessor.
- T-158: consensus engine.
- T-159: runner integration antes de `processTask`.
- T-160: Telegram/CLI human handoff.
- T-161: testes de veto critico, high risk, max rounds e approval timeout.

### P7.4 Telegram multi-turn

- T-162: conversation resolver para Telegram.
- T-163: replies como turns.
- T-164: approve/deny inline.

### P7.5 Dashboard MVP

- T-165: Bun.serve local dashboard.
- T-166: events timeline.
- T-167: tasks/sessions/approvals views.
- T-168: panic controls.

### P7.6 Context and memory hygiene

- T-169: memory retrieval budget.
- T-170: citations nos memory observations.
- T-171: private tags.
- T-172: transcript importer experimental.

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

1. Quer seguir pelo caminho de retorno rapido (`ask`/`cancel`) ou pelo caminho de reducao de risco (`approval`/`pre-flight`)?
2. A prova de fogo deve bloquear `CRITICAL` sem override humano ou permitir override manual excepcional?
3. Telegram deve ser canal de approve/deny ja no MVP ou CLI basta na primeira iteracao?
4. Dashboard entra neste ciclo ou so depois que direct mode e approvals estiverem provados?

Recomendacao: bloquear `CRITICAL` sem override por config; permitir override apenas mudando a propria task/policy e reenfileirando. A prova de fogo deve ser um freio real, nao uma formalidade.
