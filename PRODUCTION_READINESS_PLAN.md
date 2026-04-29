# Clawde - Plano Consolidado de Prontidao

Este plano consolida as observacoes feitas na revisao do Codex e na revisao do
Claude Code. A ordem de prioridade segue:

1. Sistema nao sobe.
2. Dados/quota corrompem ou ficam inconsistentes.
3. Seguranca incompleta.
4. Debito de blueprint/documentacao.

Nota apos comparar com `CONSOLIDATED_FIX_PLAN.md`: os pontos mais fortes
incorporados daqui sao (1) tratar o bug de retry/reconcile como bloqueador
operacional, embora esteja na categoria de dados, (2) separar workspace
ephemeral de sandbox, porque o sandbox tem uma decisao tecnica propria
(`Agent SDK` in-process vs isolamento por subprocess/hooks), e (3) adicionar
validacao real do `@anthropic-ai/claude-agent-sdk`, ja que mocks nao pegam
mudanca de contrato do SDK.

## P0 - Sistema nao sobe

### P0.1 - Criar entrypoints reais de receiver e worker

- Prioridade: sistema nao sobe.
- Arquivos/linhas:
  - `package.json:14-23` - build gera apenas `dist/clawde`.
  - `deploy/systemd/clawde-worker.service:5-9` - aponta para `dist/worker-main.js`.
  - `deploy/systemd/clawde-receiver.service:5-9` - aponta para `dist/receiver-main.js`.
  - `src/receiver/index.ts:1-29` e `src/worker/index.ts:1-23` - hoje exportam biblioteca, mas nao ha `main`.
- Problema:
  - Os units systemd chamam entrypoints que nao existem no `src/` nem sao gerados pelo build atual.
- Fix concreto:
  - Adicionar `src/receiver/main.ts` que carregue config, abra DB, aplique repos, registre `/health`, `/enqueue` e `/webhook/telegram` quando configurado, e trate SIGTERM/SIGHUP.
  - Adicionar `src/worker/main.ts` que carregue config, rode reconcile, monte deps reais e processe uma task ou drene ate limite configurado.
  - Atualizar `package.json` com scripts separados, por exemplo `build:cli`, `build:receiver`, `build:worker`, e `build` chamando os tres.
  - Alinhar os paths dos units systemd com os artefatos realmente gerados.
- Criterio de pronto:
  - `bun run build` gera os tres binarios/scripts esperados.
  - `systemd-run --user` ou teste equivalente consegue iniciar receiver e worker sem erro de arquivo inexistente.
  - Teste de integracao cobre boot minimo de `receiver main` e `worker main` com SDK mockado.

### P0.2 - Corrigir trigger event-driven com SQLite WAL

- Prioridade: sistema nao sobe.
- Arquivos/linhas:
  - `deploy/systemd/clawde-worker.path:4-6` - observa apenas `%h/.clawde/state.db`.
  - `src/db/client.ts:35-46` - ativa WAL por default.
  - `src/receiver/routes/enqueue.ts:114-138` - enqueue grava no SQLite, mas nao aciona worker diretamente.
- Problema:
  - Em WAL, inserts podem alterar `state.db-wal` sem alterar o mtime de `state.db`; o `.path` pode nao disparar apos enqueue.
- Fix concreto:
  - Escolher uma estrategia canonica:
    - Preferida: receiver chama `systemctl --user start clawde-worker.service` apos enqueue bem-sucedido. Isso remove heuristica de mtime e entrega latencia real sub-segundo, desde que o receiver tenha acesso ao user bus do systemd.
    - Alternativa: receiver toca um arquivo sinalizador atomico, por exemplo `%h/.clawde/run/queue.signal`, e `.path` observa esse arquivo.
    - Evitar como solucao principal: observar `state.db-wal`, porque dispara em excesso e continua acoplado a detalhe interno do SQLite.
  - Atualizar/remover o unit `.path` conforme a estrategia escolhida.
  - Emitir evento de enqueue mesmo se o start do worker falhar, mas logar erro operacional.
- Criterio de pronto:
  - Teste de integracao demonstra: POST `/enqueue` causa trigger/start do worker em ambiente simulado.
  - Manualmente, dois enqueues consecutivos em WAL acordam o worker sem depender de checkpoint.
  - A decisao fica registrada em ADR nova ou em ADR superseding de `0002-split-daemon`.

### P0.3 - Completar wiring de config real do receiver

- Prioridade: sistema nao sobe.
- Arquivos/linhas:
  - `src/config/schema.ts:35-41` - schema receiver existe.
  - `src/config/schema.ts:82-90` - schema raiz nao inclui `telegram`, `review`, `replica`.
  - `src/receiver/routes/telegram.ts:80-190` - rota existe, mas depende de config injetada.
  - `config/clawde.toml.example:63-85` - exemplos citam `[telegram]` e `[review]`, mas schema nao aceita.
- Problema:
  - Partes opcionais documentadas nao podem ser carregadas de forma validada pelo main ainda inexistente.
- Fix concreto:
  - Estender `ClawdeConfigSchema` com `telegram`, `review` e `replica` opcionais, ou remover dos exemplos ate existir suporte.
  - No `receiver/main.ts`, registrar Telegram apenas se `telegram.secret` e `allowed_user_ids` estiverem presentes.
- Criterio de pronto:
  - `loadConfig()` aceita o arquivo `config/clawde.toml.example`.
  - Teste cobre receiver com Telegram desabilitado e habilitado.

## P1 - Dados/quota corrompem ou ficam inconsistentes

### P1.1 - Corrigir dequeue/retry apos reconcile

- Prioridade: dados/quota corrompem.
- Arquivos/linhas:
  - `src/worker/reconcile.ts:21-40` - cria nova `task_run` pending.
  - `src/db/repositories/tasks.ts:121-138` - `findPending()` retorna apenas tasks sem nenhum run.
  - `src/worker/runner.ts:157-162` - `processNextPending()` depende de `tasksRepo.findPending(1)`.
- Problema:
  - A tentativa criada pelo reconcile pode nunca ser processada, porque a task ja tem historico de runs.
  - Apesar de estar na categoria "dados/quota", tratar como bloqueador pratico de producao: qualquer crash torna retries invisiveis para o worker atual.
- Fix concreto:
  - Mudar o modelo de dequeue para selecionar `task_runs.status='pending'` primeiro, joinando com `tasks`.
  - Separar claramente:
    - `TasksRepo.findNeverRunPending()` para primeira execucao, se ainda necessario.
    - `TaskRunsRepo.findNextPendingRun()` para execucao real.
  - Ajustar `processTask` para aceitar uma `TaskRun` existente ou criar a primeira tentativa numa transacao de claim.
  - Curto prazo aceitavel: alterar `TasksRepo.findPending()` para considerar tasks sem runs OU tasks cujo run mais recente esta `pending`, e fazer `processTask()` reutilizar esse run pending em vez de inserir outro.
- Criterio de pronto:
  - Teste falha antes e passa depois: lease expirado -> reconcile cria attempt 2 -> worker processa attempt 2.
  - Nao ha duplicidade de attempts concorrentes para a mesma task.

### P1.2 - Aplicar quota policy antes de executar

- Prioridade: dados/quota corrompem.
- Arquivos/linhas:
  - `src/quota/policy.ts:65-99` - policy existe, mas fica desconectada.
  - `src/worker/runner.ts:66-74` - worker cria run e pega lease sem gate de quota.
  - `src/worker/runner.ts:184-188` - quota so e registrada durante stream.
- Problema:
  - O sistema mede consumo, mas nao impede execucao quando a janela esta restrita/esgotada.
- Fix concreto:
  - Injetar `QuotaPolicy` em `RunnerDeps`.
  - Antes de criar/adquirir run, chamar `quotaTracker.currentWindow()` + `policy.canAccept(window, task.priority)`.
  - Se rejeitado, nao criar tentativa failed; registrar evento `quota_threshold_crossed` ou `task_deferred` (novo EventKind) e deixar a task/run pendente para reprocessar apos reset.
  - Definir como representar defer no schema: coluna `not_before` em `tasks` ou `task_runs`, ou fila externa por status.
- Criterio de pronto:
  - Testes cobrem LOW/NORMAL/HIGH/URGENT nos estados `normal`, `aviso`, `restrito`, `critico`, `esgotado`.
  - Em `esgotado`, nenhuma mensagem e debitada no ledger.

### P1.3 - Fechar feedback real de quota/429/Auth do SDK

- Prioridade: dados/quota corrompem.
- Arquivos/linhas:
  - `src/worker/runner.ts:197-200` - erros viram string generica.
  - `src/auth/refresh.ts:86-150` - existe detector de 401/refresh, mas nao esta plugado no Agent SDK call.
  - `src/quota/ledger.ts:34-66` - quota e estimativa local.
- Problema:
  - O sistema nao diferencia 401, 429, rate-limit, outage e erro de execucao comum; quota local pode ficar desalinhada da realidade.
- Fix concreto:
  - Criar erro tipado no `sdk/client.ts`/parser para auth/rate-limit/network.
  - Envolver invocacao com `invokeWithAutoRefresh` para 401.
  - Ao detectar 429/rate-limit, registrar evento especifico, marcar janela como restrita/esgotada temporariamente, e re-enfileirar/deferir sem contar como sucesso.
  - Adicionar metodo tipo `QuotaTracker.markCurrentWindowExhausted()` que insere debito sintetico suficiente para forcar `currentWindow().state === "esgotado"` ate o reset da janela.
- Criterio de pronto:
  - Testes com SDK mockado simulam 401 e 429.
  - 401 dispara refresh uma vez.
  - 429 nao entra em loop, gera defer observavel e faz a proxima task NORMAL ser rejeitada pela policy.

### P1.4 - Reforcar EventKind no schema SQLite

- Prioridade: dados/quota corrompem.
- Arquivos/linhas:
  - `src/domain/event.ts:8-56` - union TypeScript de `EventKind`.
  - `src/db/migrations/001_initial.up.sql:143-152` - `events.kind` e `TEXT NOT NULL`, sem `CHECK`.
  - `src/db/repositories/events.ts:44-63` - repo tipa `EventKind`, mas SQL direto ainda aceita lixo.
- Problema:
  - A borda de type-safety depende do TypeScript; SQLite permite `kind` invalido se inserido por SQL direto, migration, script ou bug.
- Fix concreto:
  - Adicionar migration que valida eventos existentes e recria/adiciona constraint para `kind IN (...)`.
  - Centralizar lista SQL gerada a partir de `EVENT_KIND_VALUES` se possivel, ou manter teste que compara domain vs migration.
- Criterio de pronto:
  - Inserir evento com `kind='typo'` falha no SQLite.
  - Teste garante que todo `EVENT_KIND_VALUES` e aceito pelo schema.

### P1.5 - Tornar ingestao JSON de repositorios resistente a corrupcao local

- Prioridade: dados/quota corrompem.
- Arquivos/linhas:
  - `src/db/repositories/tasks.ts:32-36` - `JSON.parse` direto em `depends_on`/`source_metadata`.
  - `src/db/repositories/events.ts:24-32` - `JSON.parse` direto em payload.
  - `src/db/migrations/001_initial.up.sql:25-36` e `143-152` - campos JSON sao `TEXT`, sem `json_valid`.
- Problema:
  - Um payload corrompido no DB quebra leitura e comandos operacionais.
- Fix concreto:
  - Adicionar `CHECK (json_valid(...))` para colunas JSON em nova migration.
  - Nos repos, transformar erro de parse em erro tipado com id da row, nao crash opaco.
- Criterio de pronto:
  - Migration bloqueia JSON invalido novo.
  - CLI `logs`/`queue` reporta erro claro se houver row legada corrompida.

## P2 - Seguranca incompleta

### P2.1 - Plugar workspace ephemeral no runner

- Prioridade: seguranca incompleta.
- Arquivos/linhas:
  - `src/worker/workspace.ts:49-81` - create/remove worktree existem.
  - `src/worker/runner.ts:12` - comentario diz que workspace e opcional.
  - `src/worker/runner.ts:178-183` e `229-236` - SDK recebe `workingDirectory` direto; nao ha isolamento real.
- Problema:
  - Workspace esta implementado como componente, mas tasks com `workingDir` rodam direto no checkout principal.
- Fix concreto:
  - Adicionar deps de workspace ao worker main/runner.
  - Para tasks com `workingDir`, criar worktree em `/tmp/clawde-<runId>` e usar esse path como cwd.
  - Garantir cleanup em `finally`, com reconcile para worktrees orfas.
  - Definir politica de persistencia: em sucesso, manter branch/push/registrar path; em falha, remover worktree e preservar eventos suficientes para debug.
- Criterio de pronto:
  - Teste de integracao prova que uma task escreve apenas no worktree, nao no repo original.
  - Worktree e removido apos sucesso/falha.
  - Reconcile remove ou reporta worktrees orfas de runs abandonados.

### P2.2 - Decidir e plugar sandbox real no runner/tools

- Prioridade: seguranca incompleta.
- Arquivos/linhas:
  - `src/sandbox/matrix.ts:40-72` - materializacao de sandbox existe.
  - `src/sandbox/bwrap.ts:131-189` - `runBwrapped()` existe, mas nao e chamado.
  - `src/worker/runner.ts:165-209` - invocacao SDK direta.
- Problema:
  - `materializeSandbox()` nao protege a execucao real. Alem disso, o `Agent SDK` roda in-process, entao nao da para simplesmente envolver uma chamada de biblioteca com bwrap como se fosse subprocess.
- Fix concreto:
  - Registrar uma decisao tecnica antes de implementar:
    - Estrategia A: usar subprocess wrapper (`claude -p`) para agentes nivel 2/3 e executar esse subprocess via `runBwrapped()`. Perde parte da tipagem do SDK, mas ganha isolamento real.
    - Estrategia B: manter SDK in-process e aplicar sandbox nos tool calls/hooks: `PreToolUse` valida allowlist, `Bash` roda em bwrap, `Edit`/`Write` ficam restritos ao worktree/allowed_writes.
  - Recomendacao de curto prazo: Estrategia B, porque preserva SDK oficial e reduz refactor; documentar que sandbox 2/3 vale para ferramentas, nao para o processo host inteiro.
  - Atualizar ADR 0005/0013 ou criar ADR nova com essa decisao.
- Criterio de pronto:
  - Teste Linux com bwrap prova bloqueio de escrita fora do path permitido para comandos Bash/tool calls.
  - Agente nivel 3 com input externo nao consegue rede externa fora da politica configurada.
  - README/REQUIREMENTS deixam claro o limite do sandbox escolhido.

### P2.3 - Injetar `EXTERNAL_INPUT_SYSTEM_PROMPT` nas chamadas do SDK

- Prioridade: seguranca incompleta.
- Arquivos/linhas:
  - `src/sanitize/external-input.ts:92-114` - system prompt existe.
  - `src/receiver/routes/telegram.ts:142-159` - Telegram so embrulha o texto externo no envelope.
  - `src/worker/runner.ts:76-87` - memory context e prependado no prompt.
  - `src/sdk/types.ts:48-56` - `appendSystemPrompt` existe.
  - `src/sdk/client.ts:68-73` - wrapper passa `appendSystemPrompt` ao SDK.
- Problema:
  - O envelope XML ajuda, mas a instrucao para tratar external input como dados nao e enviada na chamada real.
- Fix concreto:
  - Marcar tasks de fonte externa (`telegram`, `webhook-*`) e anexar `EXTERNAL_INPUT_SYSTEM_PROMPT` via `appendSystemPrompt`, nao apenas concatenado no user prompt.
  - Separar `prior_context` de `external_input`; memoria pode ir em system prompt, input externo deve ficar isolado como dados.
  - Cobrir webhook generico quando existir.
- Criterio de pronto:
  - Teste garante que task `source='telegram'` chama `agentClient.stream` com `appendSystemPrompt` contendo `EXTERNAL_INPUT_SYSTEM_PROMPT`.
  - Prompt injection com `</external_input>` continua escapado e nao fecha tag.

### P2.4 - Garantir fresh context no review pipeline

- Prioridade: seguranca incompleta.
- Arquivos/linhas:
  - `src/review/pipeline.ts:79-100` - pipeline chama runner por stage.
  - `src/worker/runner.ts:229-236` - stageRunner reaproveita `task.sessionId` para todos os stages.
  - `docs/adr/0004-two-stage-review.md` - decisao de fresh context por subagent.
- Problema:
  - Se `task.sessionId` vier setado, implementer e reviewers podem compartilhar contexto/sessao, quebrando independencia do review.
- Fix concreto:
  - Alterar `StageRunner`/`runWithReviewPipeline` para nunca passar `sessionId` compartilhado aos reviewers.
  - Opcao segura: cada stage sem `sessionId`, ou session IDs deterministicas por `(taskRunId, role, attemptN)`.
  - Passar o role prompt por `appendSystemPrompt` em vez de concatenar `${systemPrompt}\n\n${prompt}` como user content.
  - Registrar stage session id em eventos de review para auditoria.
- Criterio de pronto:
  - Teste com task que tem `sessionId` confirma que implementer/reviewers recebem sessions distintas ou nulas.
  - Teste confirma que prompts de role entram por `appendSystemPrompt`.
  - Reviewers nao veem historico de conversa do implementer alem do artefato explicitamente envelopado.

### P2.5 - Validar agentes e implementar loader de `AGENT.md`

- Prioridade: seguranca incompleta.
- Arquivos/linhas:
  - `.claude/agents/reflector/AGENT.md:1-37` - contrato existe para um agente.
  - `src/sandbox/agent-config.ts:44-101` - carrega apenas `sandbox.toml`.
  - `src/worker/runner.ts:178-183` - task.agent nao e validado antes da execucao.
  - `src/domain/event.ts:54-56` - ja existe `agent_invalid`.
- Problema:
  - O blueprint promete contrato de agente, mas o runtime nao valida `AGENT.md`, tools permitidas, max turns, modelo, role ou sandbox antes de executar.
- Fix concreto:
  - Criar `src/agents/loader.ts` ou expandir `src/sandbox/agent-config.ts` para parsear frontmatter de `AGENT.md`.
  - Validar task.agent no receiver ou worker antes de executar.
  - Mapear `allowedTools`, `disallowedTools`, `maxTurns` para `RunAgentOptions`.
  - Emitir `agent_invalid` e falhar/deferir task com erro claro quando agente nao existir.
- Criterio de pronto:
  - `clawde agents list` ou comando equivalente lista agentes carregados.
  - Task com agente inexistente nao chama SDK.
  - Task com `reflector` aplica maxTurns/tools definidos no AGENT.md.
  - Teste cobre AGENT.md invalido.

### P2.6 - Corrigir network allowlist que hoje vira host network

- Prioridade: seguranca incompleta.
- Arquivos/linhas:
  - `src/sandbox/matrix.ts:8-11` - comentario admite allowlist futura.
  - `src/sandbox/bwrap.ts:77-84` - `allowlist` usa `--share-net`, equivalente a rede host.
  - `src/sandbox/netns.ts:1-17` - allowlist real esta descrita como infraestrutura externa.
- Problema:
  - Configurar `network='allowlist'` pode dar falsa sensacao de restricao, mas libera rede host.
- Fix concreto:
  - Renomear modo atual para `host` ou `host-unrestricted`.
  - Fazer `allowlist` falhar fechado enquanto nftables/netns real nao existir.
  - Atualizar docs e exemplos para evitar promessa falsa.
- Criterio de pronto:
  - Teste garante que `allowlist` sem backend configurado retorna erro, nao `--share-net`.
  - `host` e a unica opcao que compartilha rede host explicitamente.

### P2.7 - Reduzir vazamento de payload de tool use em eventos/logs

- Prioridade: seguranca incompleta.
- Arquivos/linhas:
  - `src/hooks/handlers.ts:52-57` - `tool_use` emite `toolInput` integral.
  - `src/log/redact.ts:1-63` - redacao existe para logs, mas eventos persistem payload bruto.
  - `src/db/migrations/001_initial.up.sql:143-152` - events sao audit append-only.
- Problema:
  - Eventos append-only podem armazenar secrets vindos de tool inputs se handlers forem plugados em producao.
- Fix concreto:
  - Aplicar `redact()` antes de persistir qualquer event payload.
  - Para tool input, gravar resumo allowlisted por ferramenta em vez do input completo.
- Criterio de pronto:
  - Teste grava tool input contendo token falso e confirma que DB tem `[REDACTED]`, nao o segredo.

## P3 - Debito de blueprint/documentacao

### P3.1 - Alinhar fases/status do README com realidade executavel

- Prioridade: debito de blueprint.
- Arquivos/linhas:
  - `README.md:1-40` - declara todas as fases entregues/pronto para uso pessoal.
  - `README.md:151-177` - roadmap diz fases 1-9 concluidas.
  - `src/` - faltam mains e algumas integracoes prometidas.
- Problema:
  - Documentacao vende prontidao maior do que o runtime entrega.
- Fix concreto:
  - Trocar status para "core implementado; deploy operacional em hardening".
  - Linkar este plano como checklist de producao.
  - Separar "implementado como biblioteca" de "integrado no daemon".
- Criterio de pronto:
  - README nao afirma producao antes de P0/P1/P2 essenciais.

### P3.2 - Completar comandos prometidos ou reduzir contrato da CLI

- Prioridade: debito de blueprint.
- Arquivos/linhas:
  - `REQUIREMENTS.md:52-53` - promete `sessions`, `diagnose`, `panic-stop`, `panic-resume`, `forget`, `audit`, `reflect`, `config`.
  - `src/cli/main.ts:110-360` - comandos reais nao incluem todos esses.
- Problema:
  - Contrato de CLI excede a implementacao.
- Fix concreto:
  - Implementar comandos faltantes mais importantes (`diagnose`, `panic-stop`, `sessions`) ou mover para backlog explicito.
  - Atualizar README/requirements para diferenciar MVP vs planejado.
- Criterio de pronto:
  - `clawde help` e REQUIREMENTS concordam.

### P3.3 - Criar agentes prometidos ou ajustar blueprint

- Prioridade: debito de blueprint.
- Arquivos/linhas:
  - `BLUEPRINT.md` lista `implementer`, `spec-reviewer`, `code-quality-reviewer`, `verifier`, `researcher`.
  - `.claude/agents/reflector/AGENT.md:1-37` - unico agente encontrado no repo.
  - `src/review/pipeline.ts:29-33` - pipeline usa tres roles.
- Problema:
  - O pipeline documentado depende de agentes que nao existem como arquivos de contrato.
- Fix concreto:
  - Adicionar AGENT.md + sandbox.toml para roles do pipeline, ou declarar que roles sao prompts internos e nao agentes de disco.
  - Se `verifier` continuar no RF-07, adicionar stage ou remover do requisito.
- Criterio de pronto:
  - Loader de agentes encontra todos os roles configurados.
  - Review pipeline/documentacao/requirements usam a mesma lista de stages.

### P3.4 - Fechar historia de memoria/reflection como job real

- Prioridade: debito de blueprint.
- Arquivos/linhas:
  - `deploy/systemd/clawde-reflect.service:8-12` - apenas enfileira prompt generico.
  - `.claude/agents/reflector/AGENT.md:1-37` - espera janelas `events_window` e `observations_window`.
  - `src/memory/inject.ts:47-101` - injecao existe.
- Problema:
  - O reflector espera dados estruturados, mas o service so pede "Reflect on events from last 24h".
- Fix concreto:
  - Criar comando `clawde reflect` que consulta events/observations recentes, monta prompt conforme contrato do reflector, executa e persiste lessons.
  - Ou ajustar AGENT.md para aceitar busca propria via tools, se essa for a direcao.
- Criterio de pronto:
  - Rodar `clawde reflect --since 24h` cria `memory_observations.kind='lesson'` ou reporta `lessons: []`.

### P3.5 - Atualizar smoke-test para cobrir daemon real

- Prioridade: debito de blueprint.
- Arquivos/linhas:
  - `src/cli/commands/smoke-test.ts:1-16` - comentario diz que worker dry-run/version checks vem depois.
  - `deploy/systemd/clawde-smoke.service:5-8` - chama `dist/cli-main.js`, desalinhado com build atual.
- Problema:
  - Smoke test atual cobre DB/migrations/receiver opcional, mas nao prova que worker/SDK/sandbox sobem.
- Fix concreto:
  - Adicionar checks: binarios existem, receiver health, worker dry-run com SDK mock/noop, bwrap disponivel quando config exigir, OAuth token status.
  - Alinhar service com artefato de CLI real.
- Criterio de pronto:
  - `clawde smoke-test --receiver-url ...` falha se worker main nao existir ou sandbox exigido estiver indisponivel.

### P3.6 - Adicionar validacao contra Agent SDK real

- Prioridade: debito de blueprint.
- Arquivos/linhas:
  - `tests/mocks/sdk-mock.ts` - todos os fluxos de worker usam mock deterministico.
  - `package.json:32-35` - `@anthropic-ai/claude-agent-sdk` esta pinado, mas seu shape real pode mudar.
  - `src/sdk/parser.ts:34-82` - parser e defensivo, mas pode retornar `null` silenciosamente se o contrato mudar.
  - `src/cli/commands/smoke-test.ts:1-16` - smoke test ainda nao valida SDK real.
- Problema:
  - A suite atual valida a arquitetura ao redor do SDK, mas nao garante que o wrapper ainda entende o formato real emitido pelo `@anthropic-ai/claude-agent-sdk`.
- Fix concreto:
  - Criar `tests/integration/sdk-real.test.ts` skipado por default e habilitado por `CLAUDE_CODE_OAUTH_TOKEN` ou flag explicita.
  - Prompt minimo: pedir resposta curta e deterministica, `maxTurns: 1`, e validar `finalText` + `error === null`.
  - Adicionar opcao no smoke test para ping real do SDK quando token estiver configurado, registrando evento de sucesso/falha.
  - Em CI, rodar esse teste apenas em PRs que toquem `src/sdk/**`, `package.json` ou `bun.lock`, usando secret apropriado.
- Criterio de pronto:
  - Teste real passa em ambiente com OAuth token.
  - Mudanca no parser ou bump do SDK exige rodar validacao real.
  - Falha do SDK real fica visivel como smoke failure, nao como task "succeeded" sem texto.

## Ordem sugerida de execucao

1. P0.1, P0.2, P0.3.
2. P1.1, P1.2, P1.3.
3. P2.1, P2.2, P2.3, P2.4, P2.5.
4. P1.4, P1.5, P2.6, P2.7.
5. P3 completo, com P3.6 antes de qualquer upgrade do SDK.

Quando P0 + P1.1 + P1.2 estiverem prontos, o Clawde passa de "biblioteca testada"
para "daemon que sobe e processa fila com consistencia basica". Quando P2.1-P2.5
estiverem prontos, passa a fazer sentido chamar de uso pessoal unattended.
