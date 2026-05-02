# Plano de implementacao: Propostas para o Clawde

**Status:** proposta executavel, nao implementada.
**Data:** 2026-05-02.
**Branch:** `propostas-para-o-clawde`.
**Complementa:** [`propostas-para-o-clawde.md`](./propostas-para-o-clawde.md).

Este plano transforma a proposta conceitual em uma sequencia de implementacao. A direcao acordada e:

- o Clawde pode ficar mais interativo sem virar chat wrapper;
- Telegram e CLI podem criar tarefas pequenas e diretas;
- toda intervencao vira task, turn, approval ou evento auditavel;
- nao havera inject mid-stream;
- dashboard pode virar centro de controle, mas deve comecar como acompanhamento e crescer sobre primitivas ja testadas no backend.

---

## Principios de implementacao

1. **Core async permanece soberano.**
   Toda acao passa por task/task_run/eventos. Mesmo quando o operador "espera a resposta", o motor continua sendo fila + worker + audit trail.

2. **Interatividade e fachada, nao excecao.**
   `clawde ask`, Telegram quick task e dashboard submit devem usar a mesma infraestrutura.

3. **Acoes sensiveis param em fronteiras.**
   Approval e pre-flight acontecem antes de executar ferramenta ou antes de iniciar task sensivel. Nunca no meio de um SDK stream.

4. **Dashboard nao deve ser segundo backend.**
   O MVP le `state.db` e chama comandos/APIs existentes. Nao deve inventar estados proprios.

5. **Telegram e canal externo, logo e restrito por default.**
   Pode criar tasks, receber resultados, aprovar/negar e conversar por turnos. Nao deve ter acesso amplo a filesystem, secrets, Bash destrutivo ou config critica sem policy/approval.

6. **Cada fase deve ser deployable.**
   Se uma fase resolver a dor real, o projeto pode pausar antes da proxima.

---

## Visao de arquitetura alvo

```text
Operador
  |-- CLI: ask/chat/queue/cancel/approvals
  |-- Telegram: quick task, status, result, approval, multi-turn
  |-- Dashboard: timeline, tasks, approvals, jobs, agents, skills

Entrada
  |-- cria task ou operator_message
  |-- resolve conversation/session
  |-- aplica priority/quick_task policy

Worker
  |-- quota/reconcile
  |-- cancel gate
  |-- optional adversarial pre-flight
  |-- approval gate
  |-- processTask normal
  |-- events append-only

Saida
  |-- CLI render
  |-- Telegram response
  |-- dashboard timeline
  |-- alerts quando necessario
```

---

## Fase 0: ADR e contrato arquitetural

**Objetivo:** codificar a decisao antes de alterar runtime.

**Entregas:**

- ADR "Interactive Layer Without Mid-Stream Injection".
- RFC "Adversarial Pre-flight / Prova de fogo".
- Atualizacao leve de `REQUIREMENTS.md` e `BLUEPRINT.md`.
- Vocabulário oficial:
  - direct mode;
  - quick task;
  - conversation;
  - operator message;
  - approval boundary;
  - adversarial pre-flight;
  - war room;
  - dashboard control center.

**Decisoes que devem ficar explicitas:**

- mid-stream inject e rejeitado;
- CRITICAL em pre-flight bloqueia por default;
- override de CRITICAL exige alterar/recriar a task, nao clicar "ignorar";
- Telegram e canal confiavel apenas para comandos autenticados, nao para permissao ampla;
- dashboard MVP e local-first e loopback-only.

**Impacto:** muito alto.

**Risco:** baixo.

**Riscos especificos:**

- ADR vaga demais e futura implementacao reinterpretar "interativo" como stream mutavel.
- Escopo crescer no papel e virar Big Design Up Front.

**Mitigacao:**

- incluir exemplos negativos;
- incluir invariantes testaveis;
- manter ADR curta e RFC mais detalhada.

**Criterios de aceite:**

- docs explicam por que direct mode nao e chat wrapper;
- docs explicam por que pre-flight nao executa nada;
- docs distinguem war room humano de pre-flight headless.

---

## Fase 1: Direct Mode minimo

**Objetivo:** validar rapidamente a dor de "quero pedir algo simples ao Clawde e receber resposta".

**Entregas:**

- `clawde ask <prompt>`.
- Insercao de task normal com origem `cli:ask`.
- Trigger do worker pelo fluxo existente.
- Long-poll em `task_runs`/`events`.
- Renderizacao de resposta final no stdout.
- Timeout configuravel: se exceder, imprimir task id e deixar async.

**Nao incluir ainda:**

- conversa multi-turn completa;
- Telegram;
- dashboard;
- approval;
- pre-flight.

**Impacto:** muito alto.

**Risco:** baixo/medio.

**Riscos especificos:**

- usuario esperar latencia de chat e receber latencia de worker.
- comando ficar bloqueado sem feedback.
- renderer de resposta depender de shape fragil dos eventos.

**Mitigacao:**

- mostrar status simples enquanto espera;
- timeout claro;
- usar eventos existentes e fallback para resumo bruto;
- documentar "espera por task", nao "stream live".

**Criterios de aceite:**

- `clawde ask "..."` cria task e retorna resultado quando a task termina;
- se a task nao terminar no timeout, comando retorna 0 ou codigo documentado com task id;
- nenhuma task em andamento e modificada;
- eventos permanecem append-only;
- testes cobrem sucesso, falha e timeout.

---

## Fase 2: Quick task policy

**Objetivo:** diferenciar tarefas pequenas e diretas de tarefas normais.

**Entregas:**

- Campo ou metadata `task.kind = quick | normal` ou equivalente.
- Defaults para quick task:
  - timeout curto;
  - prioridade maior que normal, menor que emergencia;
  - ferramentas restritas por agente/policy;
  - sem Bash destrutivo por default;
  - sem operacoes sensiveis sem approval.
- CLI:
  - `clawde ask` cria quick task;
  - `clawde queue` continua normal;
  - flag `--async` ou `--normal` para degradar explicitamente.

**Exemplos que devem caber:**

- alterar documento pequeno;
- preencher template;
- resumir arquivo;
- pesquisar arquivos locais;
- fazer pesquisa web rapida se agente tiver permissao;
- preparar draft;
- criar task maior a partir de uma pergunta.

**Impacto:** alto.

**Risco:** medio.

**Riscos especificos:**

- quick task virar bypass de seguranca.
- prioridade de quick task faminta tasks normais.
- pesquisa web abrir superficie externa sem policy.

**Mitigacao:**

- limite de concorrencia para quick tasks;
- budget de tempo/tokens;
- denylist de operacoes sensiveis;
- agentes quick read-mostly;
- evento `quick_task_escalated` quando vira normal.

**Criterios de aceite:**

- quick task nao altera tasks ja enfileiradas;
- quick task pode furar fila apenas conforme prioridade documentada;
- operacoes sensiveis continuam exigindo approval/pre-flight;
- testes cobrem prioridade, timeout e escalonamento para async.

---

## Fase 3: Cancelamento por task

**Objetivo:** dar freio fino sem acionar panic-stop global.

**Entregas:**

- Campo `task_runs.cancel_requested_at` ou tabela/evento equivalente.
- `clawde cancel <task-id> --reason`.
- Worker checa cancel:
  - antes de iniciar task;
  - entre etapas;
  - em PreToolUse hook quando possivel.
- Evento `task_cancelled`.
- Cleanup garantido.

**Impacto:** alto.

**Risco:** baixo/medio.

**Riscos especificos:**

- cancel nao interromper operacao longa ja em andamento.
- estado final ambiguo entre failed/cancelled.
- cleanup incompleto em worktree/temp files.

**Mitigacao:**

- documentar cancel como best-effort em boundary;
- stopReason explicito `cancelled`;
- testes com worktree cleanup;
- evento com reason e resolved_by.

**Criterios de aceite:**

- cancelar pending impede execucao;
- cancelar running para no proximo boundary;
- cleanup roda;
- status final e distinguivel de erro.

---

## Fase 4: Conversations e multi-turn base

**Objetivo:** permitir continuidade sem stream mutavel.

**Entregas:**

- Migration `conversations`.
- Repositorios e CLI basico:
  - `clawde chat <name> <prompt>`;
  - `clawde conversations list/show/archive` ou integrar em `sessions`.
- Resolver `origin -> session_id`.
- Lock por conversation para evitar dois turns simultaneos.
- Reconcile limpa locks mortos.

**Impacto:** muito alto.

**Risco:** medio/alto.

**Riscos especificos:**

- duas mensagens simultaneas na mesma conversa corromperem contexto.
- conversa crescer demais e degradar contexto.
- acoplamento confuso entre `sessions` existentes e `conversations`.

**Mitigacao:**

- lock transacional;
- `compact_pending`;
- limites de tamanho;
- naming claro: session e estado SDK/memoria, conversation e binding externo.

**Criterios de aceite:**

- dois turns no mesmo chat usam a mesma conversation;
- concorrencia na mesma conversation e serializada;
- turns diferentes sao tasks/task_runs distintos;
- replay de eventos preserva ordem.

---

## Fase 5: Approval boundary

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

- continuar task sem reproduzir contexto correto.
- approval virar permissao ampla demais.
- request travar para sempre.
- reconcile reexecutar task awaiting approval por engano.

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
- timeout/expired funciona;
- reconcile nao re-enfileira indevidamente.

---

## Fase 6: War room experimental

**Objetivo:** calibrar a deliberacao adversarial antes de codar o runtime.

**Entregas:**

- Skill ou doc operacional `/war-room` para Claude Code.
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
- Exemplos em docs.

**Impacto:** medio/alto.

**Risco:** baixo.

**Riscos especificos:**

- virar discussao longa demais;
- adversary teatral, sem valor;
- outputs inconsistentes.

**Mitigacao:**

- max rounds;
- schema de resposta;
- exemplos bons e ruins;
- obrigar adversary a listar suposicoes e caminho mais simples.

**Criterios de aceite:**

- war room gera spec que pode virar task;
- consegue marcar `APPROVED`, `NEEDS_HUMAN` ou `BLOCKED`;
- exemplos cobrem migration/purge/task simples.

---

## Fase 7: Adversarial Pre-flight MVP

**Objetivo:** transformar a prova de fogo em gate headless do Clawde.

**Entregas:**

- `src/pre_flight/`.
- Config schema:
  - priorities;
  - tags;
  - agents;
  - max rounds;
  - risk policies.
- Event kinds:
  - `pre_flight_started`;
  - `pre_flight_round`;
  - `pre_flight_approved`;
  - `pre_flight_needs_human`;
  - `pre_flight_blocked`.
- Agentes read-only:
  - planner;
  - adversary;
  - risk-assessor.
- Consensus engine.
- Runner integration antes de `processTask`.
- `NEEDS_HUMAN` usa approval boundary.

**Impacto:** muito alto.

**Risco:** alto.

**Riscos especificos:**

- custo de quota em tasks demais;
- false positive bloqueando trabalho simples;
- false negative aprovando risco real;
- prompt injection na propria task influenciar risk-assessor;
- outputs LLM malformados.

**Mitigacao:**

- ativacao restrita por policy;
- parser/schema rigoroso;
- fallback fail-closed para malformed em tasks sensiveis;
- max rounds baixo;
- logs/eventos completos;
- testes com fixtures adversariais.

**Criterios de aceite:**

- CRITICAL bloqueia por default;
- HIGH vira approval por default;
- max rounds encerra sem loop;
- malformed output tem comportamento documentado;
- nenhuma ferramenta destrutiva roda durante pre-flight;
- eventos permitem auditoria posterior.

---

## Fase 8: Telegram quick tasks e approvals

**Objetivo:** usar Telegram como interface externa segura para tarefas pequenas e decisoes humanas.

**Entregas:**

- Telegram cria quick task.
- Telegram consulta status.
- Telegram recebe resultado resumido.
- Telegram approve/deny com callback seguro.
- Mapeamento `telegram:<chat>:<thread> -> conversation`.
- Policy restrita por default para agentes acionados via Telegram.

**Impacto:** alto.

**Risco:** alto.

**Riscos especificos:**

- input adversarial externo;
- spoofing/callback replay;
- vazamento de dados sensiveis na resposta;
- tarefas longas saturarem canal;
- Telegram virar bypass de approvals.

**Mitigacao:**

- allowlist de chat/operator;
- tokens/callback ids com expiração;
- redaction forte;
- limites de resposta;
- allowed_reads fail-closed para agentes adversariais;
- pre-flight/approval obrigatorio para acoes sensiveis.

**Criterios de aceite:**

- somente operador autorizado consegue criar/aprovar;
- respostas nao incluem secrets;
- quick task demorada vira async com task id;
- approve/deny gera evento com resolved_by.

---

## Fase 9: Jobs e crons como entidade backend

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

---

## Fase 10: Dashboard observacional

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
- frontend consumir queries caras no DB.

**Mitigacao:**

- local-only;
- redaction;
- paginação;
- poll/SSE simples;
- nenhum LLM call;
- nenhum estado proprio.

**Criterios de aceite:**

- dashboard abre localmente;
- mostra timeline/tasks/health;
- nao altera estado;
- testes/smoke verificam rota principal e assets.

---

## Fase 11: Dashboard operacional

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

- dashboard chama as mesmas APIs/repos do CLI;
- confirmations em operacoes sensiveis;
- pre-flight/approval sempre backend-side;
- tokens locais se auth for ativada;
- audit event para toda acao.

**Criterios de aceite:**

- toda acao no dashboard gera evento;
- operacao sensivel nao executa sem approval/pre-flight;
- UI mostra estado `awaiting_approval`, `blocked`, `cancelled`;
- nao ha divergencia entre CLI e dashboard.

---

## Fase 12: Skills, templates e documentos

**Objetivo:** suportar o uso que motivou a pergunta: documentos, templates, pesquisas e rotinas pequenas.

**Entregas:**

- Registro de templates.
- Comandos:
  - `clawde templates list`;
  - `clawde templates render`;
  - `clawde skills list`;
  - `clawde skills enable/disable` se aplicavel.
- Quick agents para:
  - document editor;
  - local researcher;
  - web researcher;
  - report writer.
- Policy por skill/agente.

**Impacto:** alto.

**Risco:** medio.

**Riscos especificos:**

- skill pack externo poluir prompt/permissions;
- template com segredo vazar em output;
- web research sem fonte/citacao;
- edicoes de docs grandes conflitarem com tasks paralelas.

**Mitigacao:**

- curated skills only;
- no full install de ECC/GSD;
- template sandbox;
- citations obrigatorias para web;
- worktree/lock para edicoes.

**Criterios de aceite:**

- gerar documento a partir de template;
- editar doc pequeno via quick task;
- pesquisa local e web tem limites e fontes;
- skills externas sao opt-in e documentadas.

---

## Fase 13: Context hygiene e memoria

**Objetivo:** melhorar continuidade sem inflar contexto.

**Entregas:**

- Memory retrieval com budget.
- Citations em memory observations.
- Private tags.
- Importador experimental de transcript do Claude Code.
- Reflection aprende com:
  - approvals negados;
  - pre-flight objections;
  - cancels;
  - repeated failures.

**Impacto:** medio/alto.

**Risco:** medio.

**Riscos especificos:**

- memoria irrelevante contaminar contexto;
- dados privados persistidos;
- transcript importer trazer lixo ou segredo;
- licenca AGPL do `claude-mem` contaminar codigo se houver copia.

**Mitigacao:**

- ideias apenas, sem copiar codigo AGPL;
- redaction antes de storage;
- progressive disclosure;
- opt-in para importador;
- tests de private tags.

**Criterios de aceite:**

- memoria injetada tem limite;
- itens tem IDs/citacoes;
- private content nao entra em storage;
- importer e experimental e desligado por default.

---

## Priorizacao resumida

| Ordem | Fase | Impacto | Risco | Motivo |
|-------|------|---------|-------|--------|
| 1 | ADR/RFC | Muito alto | Baixo | Evita ambiguidade arquitetural. |
| 2 | Direct Mode minimo | Muito alto | Baixo/medio | Maior ROI para tarefas pequenas. |
| 3 | Quick task policy | Alto | Medio | Define limites antes de abrir Telegram/dashboard. |
| 4 | Cancelamento por task | Alto | Baixo/medio | Freio barato e util. |
| 5 | Conversations | Muito alto | Medio/alto | Base para chat/Telegram/dashboard. |
| 6 | Approval boundary | Muito alto | Alto | Base para controle humano e pre-flight. |
| 7 | War room experimental | Medio/alto | Baixo | Calibra agentes sem risco runtime. |
| 8 | Adversarial pre-flight | Muito alto | Alto | Prova de fogo real para acoes sensiveis. |
| 9 | Telegram quick/approvals | Alto | Alto | Interface externa poderosa, deve vir depois das policies. |
| 10 | Jobs/crons backend | Alto | Medio/alto | Prepara dashboard como centro de controle. |
| 11 | Dashboard observacional | Alto | Medio | Visibilidade antes de controle. |
| 12 | Dashboard operacional | Muito alto | Alto | Centro de controle, construido sobre primitivas prontas. |
| 13 | Skills/templates/docs | Alto | Medio | Atende uso pratico de documentos/pesquisa. |
| 14 | Context hygiene/memoria | Medio/alto | Medio | Melhora qualidade continua. |

---

## Ordem alternativa se o foco for seguranca operacional

Se o operador quiser reduzir risco antes de melhorar UX:

1. ADR/RFC.
2. Approval boundary.
3. Cancelamento por task.
4. War room experimental.
5. Adversarial pre-flight.
6. Direct Mode.
7. Telegram.
8. Dashboard.

Essa ordem e mais conservadora, mas demora mais para entregar a sensacao de "Clawde faz pequenas coisas agora".

---

## Recomendacao final

A melhor ordem equilibrada e:

1. ADR/RFC.
2. Direct Mode minimo.
3. Quick task policy.
4. Cancelamento por task.
5. Conversations.
6. Approval boundary.
7. War room experimental.
8. Adversarial pre-flight.
9. Telegram.
10. Jobs/crons backend.
11. Dashboard observacional.
12. Dashboard operacional.
13. Skills/templates.
14. Context hygiene.

Essa ordem entrega valor rapidamente, reduz ansiedade operacional cedo e evita construir um dashboard caro antes de existir backend suficiente para ele controlar.

---

## Perguntas de decisao antes da implementacao

1. `quick_task` pode furar fila sempre ou so quando nao houver task CRITICAL/running?
2. Qual timeout padrao para `clawde ask`: 60s, 120s ou configuravel por profile?
3. Telegram pode criar normal tasks ou apenas quick tasks no MVP?
4. Web research entra no MVP de quick tasks ou fica atras de agente explicitamente habilitado?
5. Pre-flight `CRITICAL` deve ser bloqueio absoluto ou permitir override por operador com re-enqueue?
6. Dashboard MVP deve ser read-only puro ou ja incluir criar/cancelar tasks?
7. Jobs/crons devem usar systemd timers gerados ou scheduler interno no Clawde?

Recomendacoes iniciais:

- quick task pode ter prioridade alta, mas nao deve interromper CRITICAL/running;
- `clawde ask` timeout default de 120s;
- Telegram MVP cria quick task e approvals, normal task somente com comando explicito;
- web research opt-in por agente;
- CRITICAL bloqueia sem override direto;
- dashboard MVP read-only + links/commands, depois operacional;
- jobs/crons primeiro como backend entity que enfileira tasks; systemd fica para timers de sistema ja existentes.
