# Plano de implementacao: Propostas para o Clawde

**Status:** proposta executavel, nao implementada.
**Data:** 2026-05-02.
**Branch:** `propostas-para-o-clawde`.
**Complementa:** [`propostas-para-o-clawde.md`](./propostas-para-o-clawde.md).
**Roadmap relacionado:** [`memory-context.md`](./memory-context.md).

Este plano transforma a proposta conceitual em uma sequencia de implementacao. A direcao acordada e:

- o Clawde pode ficar mais interativo sem virar chat wrapper;
- CLI e Telegram podem criar tarefas pequenas e diretas;
- toda intervencao vira task, turn, approval ou evento auditavel;
- nao havera inject mid-stream;
- dashboard pode virar centro de controle, mas comeca observacional e cresce sobre primitivas ja testadas no backend;
- skills/templates/memoria sao importantes, mas ficam em roadmap proprio para nao poluir o MVP interativo.

---

## Principios de implementacao

1. **Core async permanece soberano.** Toda acao passa por task/task_run/events. Mesmo quando o operador espera uma resposta, o motor continua sendo fila + worker + audit trail.
2. **Interatividade e fachada, nao excecao.** `clawde ask`, Telegram quick task e dashboard submit devem usar a mesma infraestrutura.
3. **Acoes sensiveis param em fronteiras.** Approval e pre-flight acontecem antes de ferramenta sensivel ou antes da task sensivel. Nunca no meio de um SDK stream.
4. **Dashboard nao deve ser segundo backend.** O MVP le `state.db` e chama APIs/repositorios existentes. Nao deve inventar estados proprios.
5. **Telegram e canal externo restrito.** Pode criar tasks, receber resultados, aprovar/negar e conversar por turnos. Nao pode override CRITICAL nem receber permissao ampla sem policy.
6. **Cada fase deve ser deployable.** O projeto pode parar apos qualquer fase se ela resolver a dor real.

---

## Vocabulario e naming

- **Profile:** `task.profile = quick | normal | long_running`. Define como executar.
- **Priority:** `LOW | NORMAL | HIGH | URGENT` continua definindo atencao/fila.
- **Quick task:** task curta, com limites de tempo/ferramentas, mas ainda auditavel.
- **Conversation:** binding externo (`cli:<name>`, `telegram:<chat>:<thread>`, `dashboard:<uuid>`) para uma session persistente.
- **Operator message:** intervencao entre turns. Nao modifica task em andamento.
- **Approval boundary:** ponto em que uma acao sensivel estaciona e aguarda decisao humana.
- **War room:** deliberacao interativa com operador presente, em Claude Code.
- **Adversarial pre-flight:** gate headless antes de execucao, usando planner/adversary/risk-assessor.

`profile` e ortogonal a `priority`: uma quick task pode ser `HIGH`, e uma long-running task pode ser `LOW`.

---

## State machine: Pre-flight + Approval

O pre-flight e nao deterministico porque depende de LLM calls. Por isso, o veredicto final deve ser persistido e respeitado.

```text
task pending
  |
  v
pre_flight_running
  |-- APPROVED -----> processTask
  |-- BLOCKED ------> finished(blocked)
  |-- NEEDS_HUMAN --> awaiting_approval
                         |-- approved --> continuation/follow-up task, sem novo pre-flight automatico
                         |-- denied ----> finished(denied)
                         |-- expired ---> finished(expired)
```

Regras:

- Pre-flight com veredicto final nunca re-roda automaticamente.
- `NEEDS_HUMAN` cria approval.
- Approval aprovado continua a task ou cria follow-up task sem novo pre-flight automatico.
- Approval `expired` finaliza como expired; operador re-enfileira manualmente se quiser nova tentativa.
- Se o operador alterar restricoes substanciais, isso vira nova task e novo pre-flight.
- Crash antes do veredicto final: abandonar tentativa parcial, registrar restart e rerodar do round 1.
- Crash depois do veredicto final: respeitar o veredicto persistido.
- Reconcile nunca deve re-enfileirar `awaiting_approval` como se fosse pending normal.

Eventos candidatos:

- `pre_flight_started`
- `pre_flight_round`
- `pre_flight_restarted`
- `pre_flight_approved`
- `pre_flight_needs_human`
- `pre_flight_blocked`
- `pre_flight_critical_override`
- `approval_requested`
- `approval_approved`
- `approval_denied`
- `approval_expired`

---

## Politica CRITICAL override

`CRITICAL` bloqueia por padrao, mas existe escape auditado para evitar incentivo a contornos piores.

Regras:

- Override so pode ser feito por operador autenticado via CLI ou dashboard.
- Telegram nao pode executar override CRITICAL.
- Override exige justificativa textual.
- Override vale para uma unica task.
- Override emite `pre_flight_critical_override` com operador, justificativa, task id, pre-flight verdict id e timestamp.
- Override nao altera policy global nem reduz o risco registrado; apenas autoriza aquela execucao especifica.

Comandos futuros possiveis:

```bash
clawde preflight override <task-id> --reason "snapshot validado e janela de manutencao aprovada"
```

---

## Roadmap MVP: Fases 0-7

Estas fases entregam a camada interativa minima, segura e auditavel. Depois da Fase 7, o Clawde ja deve conseguir fazer pedidos diretos, cancelar tasks, manter conversas, pedir approvals e rodar prova de fogo adversarial.

### Fase 0: ADR e RFCs

**Objetivo:** codificar decisoes antes de alterar runtime.

**Entregas:**

- ADR "Interactive Layer Without Mid-Stream Injection".
- RFC "Adversarial Pre-flight / Prova de fogo".
- RFC "Telegram callback verification" como pre-requisito da Fase 8.
- Atualizacao leve de `REQUIREMENTS.md` e `BLUEPRINT.md`.
- Decisao registrada de `task.profile` vs `Priority`.

**Telegram callback RFC deve decidir:**

- HMAC/stateless vs tabela stateful.
- Recomendacao MVP: tabela `telegram_callbacks` stateful.
- Nonce one-time-use.
- TTL obrigatorio.
- Binding por chat/operator/request.
- Rejeicao de callback replay.

**Impacto:** muito alto.

**Risco:** baixo.

**Riscos especificos:**

- ADR vaga demais permitir reinterpretar interatividade como stream mutavel.
- Escopo crescer no papel.

**Mitigacao:**

- incluir exemplos negativos;
- incluir invariantes testaveis;
- manter ADR curta e RFCs focadas.

**Criterios de aceite:**

- docs explicam por que direct mode nao e chat wrapper;
- docs explicam por que pre-flight nao executa nada;
- docs distinguem war room humano de pre-flight headless;
- docs registram CRITICAL override auditado.

### Fase 1: Direct Mode minimo

**Objetivo:** validar rapidamente a dor de "quero pedir algo simples ao Clawde e receber resposta".

**Entregas:**

- `clawde ask <prompt>`.
- Insercao de task normal com origem `cli:ask`.
- Trigger do worker pelo fluxo existente.
- Long-poll em `task_runs`/`events`.
- Renderizacao de resposta final no stdout.
- Timeout configuravel: se exceder, imprimir task id e deixar async.

**Nao incluir ainda:**

- quick task policy completa;
- conversa multi-turn completa;
- Telegram;
- dashboard;
- approval;
- pre-flight.

**Impacto:** muito alto.

**Risco:** baixo/medio.

**Riscos especificos:**

- usuario esperar latencia de chat e receber latencia de worker;
- comando ficar bloqueado sem feedback;
- renderer depender de shape fragil dos eventos.

**Mitigacao:**

- mostrar status simples enquanto espera;
- timeout claro;
- fallback para output bruto;
- documentar "espera por task", nao "stream live".

**Criterios de aceite:**

- `clawde ask "..."` cria task e retorna resultado quando a task termina;
- timeout devolve task id e deixa async;
- nenhuma task em andamento e modificada;
- eventos permanecem append-only;
- testes cobrem sucesso, falha e timeout.

### Fase 2: Cancelamento por task

**Objetivo:** dar freio fino sem acionar panic-stop global.

**Entregas:**

- Campo `task_runs.cancel_requested_at` ou tabela/evento equivalente.
- `clawde cancel <task-id> --reason`.
- Worker checa cancel antes de iniciar task, entre etapas e em PreToolUse quando possivel.
- Evento `task_cancelled`.
- Cleanup garantido.

**Impacto:** alto.

**Risco:** baixo/medio.

**Riscos especificos:**

- cancel nao interromper operacao longa ja em andamento;
- estado final ambiguo entre failed/cancelled;
- cleanup incompleto.

**Mitigacao:**

- documentar cancel como best-effort em boundary;
- stopReason `cancelled`;
- testes com cleanup;
- evento com reason e resolved_by.

**Criterios de aceite:**

- cancelar pending impede execucao;
- cancelar running para no proximo boundary;
- cleanup roda;
- status final e distinguivel de erro.

### Fase 3: Conversations e multi-turn base

**Objetivo:** permitir continuidade sem stream mutavel.

**Entregas:**

- Migration `conversations`.
- Resolver `origin -> session_id`.
- CLI basico:
  - `clawde chat <name> <prompt>`;
  - `clawde conversations list/show/archive` ou integracao em `sessions`.
- Lock por conversation para evitar dois turns simultaneos.
- Reconcile limpa locks mortos.
- Backfill para tasks ja criadas por Direct Mode com `origin` string.

**Impacto:** muito alto.

**Risco:** medio/alto.

**Riscos especificos:**

- duas mensagens simultaneas corromperem contexto;
- conversa crescer demais;
- acoplamento confuso entre `sessions` e `conversations`.

**Mitigacao:**

- lock transacional;
- `compact_pending`;
- limites de tamanho;
- naming claro: session e estado SDK/memoria; conversation e binding externo.

**Criterios de aceite:**

- dois turns no mesmo chat usam a mesma conversation;
- concorrencia na mesma conversation e serializada;
- turns diferentes sao tasks/task_runs distintos;
- migration backfilla conversations para tasks pre-existentes com origin string;
- replay de eventos preserva ordem.

### Fase 4: Approval boundary

**Objetivo:** criar o primitivo de decisao humana antes de acoes sensiveis.

**Entregas:**

- Migration `approval_requests`.
- Status `awaiting_approval` ou equivalente em `task_runs`.
- CLI:
  - `clawde approvals list`;
  - `clawde approvals show <id>`;
  - `clawde approvals approve <id>`;
  - `clawde approvals deny <id>`.
- Worker/hook:
  - detecta tool/action sensivel;
  - persiste request;
  - sai limpo;
  - continuation como novo task_run/follow-up task.

**Impacto:** muito alto.

**Risco:** alto.

**Riscos especificos:**

- continuation nao reproduzir contexto correto;
- approval virar permissao ampla;
- request travar para sempre;
- reconcile reexecutar awaiting approval por engano.

**Mitigacao:**

- payload minimo e redigido;
- TTL/expired state;
- continuation explicita;
- testes de crash/reconcile;
- approvals sempre eventados.

**Criterios de aceite:**

- action sensivel pode estacionar task;
- approve cria continuacao auditavel;
- deny finaliza sem executar;
- expired finaliza sem rerodar pre-flight;
- reconcile nao re-enfileira indevidamente.

### Fase 5: War room experimental

**Objetivo:** calibrar deliberacao adversarial antes de codar runtime.

**Entregas:**

- Skill Claude Code em `.claude/skills/war-room/SKILL.md`.
- Playbook humano em `docs/playbooks/war-room.md`.
- Tres papeis:
  - planner;
  - adversary;
  - risk-assessor.
- Output estruturado:
  - plano;
  - objeções;
  - risco;
  - recomendacao;
  - spec refinada.
- Exemplos bons e ruins.

**Fora de escopo:** CLI `clawde war-room`; isso fica para quando o mecanismo virar runtime/pre-flight.

**Impacto:** medio/alto.

**Risco:** baixo.

**Riscos especificos:**

- virar discussao longa demais;
- adversary teatral;
- outputs inconsistentes.

**Mitigacao:**

- max rounds;
- schema de resposta;
- exemplos bons e ruins;
- adversary deve listar suposicoes e caminho mais simples.

**Criterios de aceite:**

- war room gera spec que pode virar task;
- consegue marcar `APPROVED`, `NEEDS_HUMAN` ou `BLOCKED`;
- exemplos cobrem migration, purge e task simples.

### Fase 6: Pre-flight foundations

**Objetivo:** preparar schemas, agentes e contrato de estado antes de conectar o gate no runner.

**Entregas:**

- Config schema para pre-flight:
  - priorities;
  - tags;
  - agents;
  - max rounds;
  - risk policies.
- Event kinds de pre-flight/approval.
- Agentes read-only:
  - planner;
  - adversary;
  - risk-assessor.
- Consensus engine testavel sem runner.
- CRITICAL override modelado em tipos/eventos, ainda sem caminho operacional.

**Impacto:** alto.

**Risco:** medio/alto.

**Riscos especificos:**

- outputs LLM malformados;
- custo de quota mal estimado;
- parser permissivo demais;
- agentes poderem executar ferramentas.

**Mitigacao:**

- schema rigoroso;
- agentes read-only;
- fixtures adversariais;
- no runtime wire-up ate tests passarem.

**Criterios de aceite:**

- consensus engine cobre APPROVED, NEEDS_HUMAN, BLOCKED e CRITICAL;
- malformed output tem comportamento documentado;
- agentes nao executam ferramentas destrutivas;
- eventos/tipos suportam restart e critical override.

### Fase 7: Adversarial Pre-flight runtime

**Objetivo:** transformar a prova de fogo em gate headless do Clawde.

**Entregas:**

- `src/pre_flight/`.
- Runner integration antes de `processTask`.
- `NEEDS_HUMAN` usa approval boundary.
- CRITICAL override auditado por CLI/dashboard.

**Impacto:** muito alto.

**Risco:** alto.

**Riscos especificos:**

- custo de quota em tasks demais;
- false positive bloqueando trabalho simples;
- false negative aprovando risco real;
- prompt injection da propria task influenciar risk-assessor;
- outputs LLM malformados.

**Mitigacao:**

- ativacao restrita por policy;
- parser/schema rigoroso;
- fallback fail-closed para malformed em tasks sensiveis;
- max rounds baixo;
- logs/eventos completos;
- fixtures adversariais.

**Criterios de aceite:**

- CRITICAL bloqueia por default;
- override CRITICAL exige operador, justificativa e evento;
- Telegram nao consegue override CRITICAL;
- HIGH vira approval por default;
- max rounds encerra sem loop;
- malformed output tem comportamento documentado;
- nenhuma ferramenta destrutiva roda durante pre-flight;
- eventos permitem auditoria posterior.

---

## Pos-MVP: Fases 8-12

Estas fases transformam a base interativa em interfaces externas e centro de controle. Sao deferiveis: concluir o MVP na Fase 7 ja entrega valor real.

### Fase 8: Policy hardening para quick tasks

**Objetivo:** adicionar limites de quick task depois que Direct Mode gerar uso real.

**Entregas:**

- `task.profile = quick | normal | long_running`.
- `clawde ask` passa a criar profile `quick`.
- Defaults para quick:
  - timeout curto;
  - prioridade configuravel;
  - ferramentas restritas por agente/policy;
  - sem Bash destrutivo por default;
  - sem operacoes sensiveis sem approval.
- Web research fora do default:
  - exige `--with-web`;
  - exige agente/permissao explicita;
  - tem budget de tempo/quota.

**Impacto:** alto.

**Risco:** medio.

**Riscos especificos:**

- quick task virar bypass de seguranca;
- quick tasks famintas tasks normais;
- web research abrir superficie externa e quebrar garantia de rapidez.

**Mitigacao:**

- limite de concorrencia;
- budget de tempo/tokens;
- denylist de operacoes sensiveis;
- agentes quick read-mostly;
- evento `quick_task_escalated` quando vira normal.

**Criterios de aceite:**

- quick task nao altera tasks ja enfileiradas;
- profile nao substitui Priority;
- web research e opt-in e testado;
- operacoes sensiveis continuam exigindo approval/pre-flight.

---

### Fase 9: Telegram quick tasks e approvals

**Objetivo:** usar Telegram como interface externa segura.

**Pre-requisito:** RFC "Telegram callback verification" aprovado.

**Entregas:**

- Telegram cria quick task.
- Telegram consulta status.
- Telegram recebe resultado resumido.
- Telegram approve/deny com callback seguro.
- Mapeamento `telegram:<chat>:<thread> -> conversation`.
- Policy restrita por default para agentes acionados via Telegram.

**Callback security MVP:**

- tabela stateful de callbacks;
- nonce one-time-use;
- TTL obrigatorio;
- binding por chat/operator/request;
- rejeicao de replay;
- nenhum override CRITICAL via Telegram.

**Impacto:** alto.

**Risco:** alto.

**Riscos especificos:**

- input adversarial externo;
- spoofing/callback replay;
- vazamento de dados sensiveis;
- Telegram virar bypass de approvals.

**Mitigacao:**

- allowlist de chat/operator;
- redaction forte;
- limites de resposta;
- allowed_reads fail-closed para agentes adversariais;
- pre-flight/approval obrigatorio para acoes sensiveis.

**Criterios de aceite:**

- somente operador autorizado consegue criar/aprovar;
- callback replay falha;
- respostas nao incluem secrets;
- quick task demorada vira async com task id;
- approve/deny gera evento com resolved_by.

### Fase 10: Jobs e crons como entidade backend

**Objetivo:** preparar o dashboard para criar rotinas sem editar systemd manualmente.

**Entregas:**

- Modelo `scheduled_jobs` ou equivalente.
- CLI:
  - `clawde jobs list`;
  - `clawde jobs create`;
  - `clawde jobs pause/resume`;
  - `clawde jobs run-now`.
- Tipos iniciais:
  - prompt recorrente;
  - smoke/check;
  - report/template;
  - maintenance task.
- Pre-flight obrigatorio para jobs destrutivos.

**Impacto:** alto.

**Risco:** medio/alto.

**Riscos especificos:**

- duplicar systemd timers existentes;
- jobs rodarem sem operador perceber;
- job mal configurado gerar loop/quota burn.

**Mitigacao:**

- MVP apenas wrapper sobre task enqueue;
- rate limits;
- next_run visivel;
- events para cada firing;
- require approval para jobs sensiveis.

**Criterios de aceite:**

- job recorrente cria task auditavel;
- pause/resume funciona;
- run-now nao altera schedule sem evento;
- quota gate se aplica.

### Fase 11: Dashboard observacional

**Objetivo:** dar visibilidade antes de dar controle.

**Entregas:**

- `clawde dashboard` ou service local.
- Bind `127.0.0.1` por default.
- Timeline de eventos.
- Tasks por status.
- Sessions/conversations.
- Health:
  - receiver;
  - worker;
  - quota;
  - OAuth;
  - DB integrity;
  - backup/restore drill.
- Read-only no MVP, exceto talvez links para CLI commands.

**Impacto:** alto.

**Risco:** medio.

**Riscos especificos:**

- virar app grande antes de o backend estar pronto;
- expor dados sensiveis em localhost sem controle;
- frontend consumir queries caras.

**Mitigacao:**

- local-only;
- redaction;
- paginacao;
- poll/SSE simples;
- nenhum LLM call;
- nenhum estado proprio.

**Criterios de aceite:**

- dashboard abre localmente;
- mostra timeline/tasks/health;
- nao altera estado;
- smoke verifica rota principal e assets.

### Fase 12: Dashboard operacional

**Objetivo:** transformar o dashboard em centro de controle incremental.

**Entregas:**

- Criar quick task.
- Criar normal task.
- Cancelar task.
- Approve/deny.
- Ver e acionar jobs.
- Ver agentes e policies.
- Criar task a partir de template.

**Impacto:** muito alto.

**Risco:** alto.

**Riscos especificos:**

- dashboard virar bypass de CLI policies;
- CSRF/local attack;
- operacoes destrutivas com clique acidental;
- UI esconder risco real.

**Mitigacao:**

- dashboard chama mesmas APIs/repos do CLI;
- confirmations em operacoes sensiveis;
- pre-flight/approval sempre backend-side;
- audit event para toda acao.

**Criterios de aceite:**

- toda acao no dashboard gera evento;
- operacao sensivel nao executa sem approval/pre-flight;
- UI mostra `awaiting_approval`, `blocked`, `cancelled`;
- nao ha divergencia entre CLI e dashboard.

---

## Priorizacao resumida

| Ordem | Fase | Impacto | Risco | Motivo |
|-------|------|---------|-------|--------|
| 1 | ADR/RFC | Muito alto | Baixo | Evita ambiguidade arquitetural. |
| 2 | Direct Mode minimo | Muito alto | Baixo/medio | Maior ROI para tarefas pequenas. |
| 3 | Cancelamento por task | Alto | Baixo/medio | Freio barato e util. |
| 4 | Conversations | Muito alto | Medio/alto | Base para chat/Telegram/dashboard. |
| 5 | Approval boundary | Muito alto | Alto | Base para controle humano e pre-flight. |
| 6 | War room experimental | Medio/alto | Baixo | Calibra agentes sem risco runtime. |
| 7 | Pre-flight foundations | Alto | Medio/alto | Separa contrato/testes antes do runner. |
| 8 | Adversarial pre-flight runtime | Muito alto | Alto | Prova de fogo real para acoes sensiveis. |
| 9 | Quick task policy | Alto | Medio | Endurece Direct Mode com dados de uso real. |
| 10 | Telegram quick/approvals | Alto | Alto | Interface externa poderosa, depois das policies. |
| 11 | Jobs/crons backend | Alto | Medio/alto | Prepara dashboard como centro de controle. |
| 12 | Dashboard observacional | Alto | Medio | Visibilidade antes de controle. |
| 13 | Dashboard operacional | Muito alto | Alto | Centro de controle construido sobre primitivas prontas. |

---

## Ordem alternativa safety-first

Se o operador quiser reduzir risco antes de melhorar UX:

1. ADR/RFC.
2. Approval boundary.
3. War room experimental.
4. Pre-flight foundations.
5. Adversarial pre-flight runtime.
6. Cancelamento por task.
7. Direct Mode minimo.
8. Telegram.
9. Dashboard.

Essa ordem e mais conservadora, mas demora mais para entregar a sensacao de "Clawde faz pequenas coisas agora".

---

## Recomendacao final

A melhor ordem equilibrada e:

1. ADR/RFC.
2. Direct Mode minimo.
3. Cancelamento por task.
4. Conversations.
5. Approval boundary.
6. War room experimental.
7. Pre-flight foundations.
8. Adversarial pre-flight runtime.
9. Quick task policy.
10. Telegram.
11. Jobs/crons backend.
12. Dashboard observacional.
13. Dashboard operacional.

Essa ordem entrega valor rapidamente, reduz ansiedade operacional cedo e evita construir um dashboard caro antes de existir backend suficiente para ele controlar.

---

## Perguntas de decisao antes da implementacao

1. `clawde ask` timeout default deve ser 60s, 120s ou configuravel por profile?
2. Quick tasks podem furar fila sempre ou so quando nao houver task CRITICAL/running?
3. Telegram pode criar normal tasks ou apenas quick tasks no MVP?
4. Web research entra apenas com `--with-web` e agente explicitamente habilitado?
5. CRITICAL override deve exigir reautenticacao local no dashboard?
6. Dashboard MVP deve ser read-only puro ou ja incluir criar/cancelar tasks?
7. Jobs/crons devem usar systemd timers gerados ou scheduler interno no Clawde?

Recomendacoes iniciais:

- `clawde ask` timeout default de 120s;
- quick task pode ter prioridade alta, mas nao deve interromper CRITICAL/running;
- Telegram MVP cria quick task e approvals, normal task somente com comando explicito;
- web research opt-in por `--with-web` e agente habilitado;
- CRITICAL override exige justificativa e operador local;
- dashboard MVP read-only, depois operacional;
- jobs/crons primeiro como backend entity que enfileira tasks; systemd fica para timers de sistema existentes.
