# Clawde — War Room Implementation Plan

**Status:** implemented (V1 file-first)  
**Data:** 2026-05-05  
**Executor padrão:** Codex  
**Modo desejado:** máximo de automação possível, com gates explícitos para riscos operacionais  
**Escopo:** implementação, testes, verificação, refatoração e documentação da ideia de War Room no Clawde

**Implementação V1:** `clawde war-room open|status|note|collect|plan|execute|verify|gate|report|close`

---

## 1. Objetivo

Criar uma camada de **War Room operacional** para o Clawde: um modo estruturado de coordenar incidentes, hardening, execuções autônomas, revisões e fechamento de evidências sem depender de memória humana solta no chat.

O War Room deve servir como:

- centro de comando para incidentes e fases de hardening;
- painel de estado para operador, Codex e Claude Code;
- trilha auditável de decisões, evidências, comandos e resultados;
- orquestrador seguro para execução automática;
- ponte entre GitHub issues, GSD plans, `STATUS.md`, eventos do Clawde e documentação de fechamento;
- mecanismo de "pause, diagnose, execute, verify, close" para não deixar automação correr além da qualidade.

Este plano assume que **Codex implementará tudo sozinho**, mas preserva pontos de revisão opcional e gates manuais quando a ação puder afetar segurança, produção, dados ou disponibilidade.

---

## 2. Definição de Produto

### 2.1 O Que é o War Room

War Room é um conjunto de comandos, estado persistente, templates, relatórios e automações para responder a situações como:

- testes manuais revelaram vários bugs e precisamos organizar correção;
- smoke/soak falhou e precisamos capturar evidência antes de mexer;
- quota estourou e tasks ficaram deferidas;
- sandbox, OAuth, DB, Telegram ou worker entraram em estado suspeito;
- Codex e Claude Code precisam dividir trabalho sem conflito;
- operador quer sair por algumas horas e deixar execução segura.

### 2.2 Experiência Esperada

Fluxo ideal:

```text
clawde war-room open --kind hardening --title "TEST-HARDENING round 2"
clawde war-room status
clawde war-room collect --db --git --github --systemd
clawde war-room plan --from docs/TEST-HARDENING-PLAN.md
clawde war-room execute --wave 1 --dry-run
clawde war-room verify
clawde war-room report --format markdown
clawde war-room close --outcome resolved
```

### 2.3 Princípios

1. **Evidência antes de ação**: toda execução relevante começa com snapshot de estado.
2. **Automação com freio**: ações destrutivas ou security-sensitive param em gate.
3. **Fonte de verdade explícita**: War Room referencia arquivos e issues; não substitui `STATUS.md` sem atualizar.
4. **Reprodutibilidade**: todo comando gerado pode ser reexecutado manualmente.
5. **Auditoria simples**: cada decisão relevante vira evento ou nota versionada.
6. **Escopo pequeno por onda**: uma wave deve ser pequena o suficiente para revisar.
7. **Sem self-approval de segurança**: mesmo com Codex implementando sozinho, mudanças de sandbox, retenção, auth, panic ou dados exigem gate manual antes de merge/execução destrutiva.

### 2.4 Não Objetivos da Primeira Versão

- Dashboard web completo.
- Chat multiusuário em tempo real.
- Integração bidirecional sofisticada com GitHub Projects.
- Autonomia irrestrita para executar e mergear qualquer coisa.
- Substituir GSD, GitHub issues ou `STATUS.md`.

---

## 3. Arquitetura Proposta

### 3.1 Componentes

| Componente | Responsabilidade | Primeira implementação |
|---|---|---|
| WarRoomDomain | modelo de sessão, decisão, evidência, wave, gate | `src/war-room/domain.ts` |
| WarRoomStore | persistência em arquivos JSON/Markdown sob `~/.clawde/state/war-room/` | file-first |
| WarRoomEvents | espelhamento seletivo na tabela `events` | usar `EventsRepo` |
| WarRoomCLI | comandos `clawde war-room ...` | `src/cli/commands/war-room.ts` |
| Collectors | coletar git/db/systemd/github/config/logs | `src/war-room/collectors/*` |
| Planner Bridge | ler GSD/planos e criar waves executáveis | `src/war-room/planner.ts` |
| Executor Bridge | rodar comandos permitidos com dry-run e gates | `src/war-room/executor.ts` |
| Reporter | gerar Markdown/JSON de status e fechamento | `src/war-room/report.ts` |
| Runbooks | guias de uso e incidentes | `docs/runbooks/war-room.md` |

### 3.2 Estratégia de Persistência

Começar **file-first** para reduzir risco de migration prematura.

Diretório:

```text
~/.clawde/state/war-room/
  active.json
  rooms/
    WR-20260505-001/
      room.json
      timeline.jsonl
      decisions.jsonl
      evidence/
        git-status.txt
        diagnose-all.json
        db-integrity.json
        github-issues.json
      report.md
      closeout.md
```

Motivo:

- facilita inspeção manual;
- evita alterar schema do DB antes de estabilizar o modelo;
- reduz risco de corromper `state.db`;
- permite anexar evidência grande sem inflar SQLite.

Depois da V1, considerar tabelas dedicadas:

- `war_rooms`
- `war_room_events`
- `war_room_evidence`
- `war_room_gates`

### 3.3 Eventos

Adicionar novos `EventKind` apenas quando necessário. Candidatos:

- `war_room.opened`
- `war_room.evidence_collected`
- `war_room.gate_required`
- `war_room.gate_approved`
- `war_room.wave_started`
- `war_room.wave_finished`
- `war_room.closed`

Primeira versão pode registrar eventos genéricos se o schema atual exigir mudanças amplas. Se `EventKind` já é `CHECK` restrito, planejar migration pequena e testes de roundtrip.

### 3.4 CLI Proposto

```text
clawde war-room open --kind <incident|hardening|release|ops> --title <text>
clawde war-room status [--output text|json]
clawde war-room note <text>
clawde war-room collect [--git] [--db] [--systemd] [--github] [--logs] [--all]
clawde war-room plan --from <file> [--phase <id>]
clawde war-room execute --wave <n> [--dry-run] [--confirm]
clawde war-room verify [--ci] [--smoke] [--diagnose]
clawde war-room gate list
clawde war-room gate approve <gate-id> --reason <text>
clawde war-room report [--format markdown|json]
clawde war-room close --outcome <resolved|mitigated|aborted|superseded>
```

### 3.5 Lanes de Automação

| Lane | Pode executar sozinho? | Exemplos |
|---|---:|---|
| Green | Sim | docs, coleta de evidência, status, testes read-only |
| Yellow | Sim com dry-run antes | refactors pequenos, testes, comandos de diagnose |
| Guarded | Não sem gate | panic-stop real, purge, sandbox/auth/retention, deploy service |
| Blocked | Nunca automático | reset destrutivo, apagar backups, modificar secrets |

---

## 4. Fases de Implementação

### Fase WR0 — Preparação e Contrato

Objetivo: transformar esta ideia em contrato técnico antes de codar.

Entregáveis:

- este plano versionado;
- ADR curta explicando War Room file-first;
- issue/backlog interno aprovado;
- matriz de comandos e riscos;
- definição de DoD.

Critério de pronto:

- plano em `main`;
- backlog separado por waves;
- não há ambiguidade sobre comandos guarded;
- operador sabe quais ações nunca serão automáticas.

### Fase WR1 — Modelo e Estado Local

Objetivo: criar núcleo de domínio e persistência file-first.

Arquivos previstos:

- `src/war-room/domain.ts`
- `src/war-room/store.ts`
- `src/war-room/ids.ts`
- `tests/unit/war-room/domain.test.ts`
- `tests/unit/war-room/store.test.ts`

Critério de pronto:

- criar room idempotente;
- recuperar active room;
- gravar timeline append-only;
- fechar room sem perder evidência;
- testes unitários cobrem erro de JSON corrompido, diretório ausente e lock ativo.

### Fase WR2 — CLI Mínimo

Objetivo: operador consegue abrir, consultar, anotar e fechar um War Room.

Arquivos previstos:

- `src/cli/commands/war-room.ts`
- `src/cli/main.ts`
- `tests/integration/war-room-cmd.test.ts`

Critério de pronto:

- `war-room open` cria `active.json`;
- `war-room status` mostra id, kind, title, age, gates e última evidência;
- `war-room note` adiciona item na timeline;
- `war-room close` gera `closeout.md` e remove active pointer;
- output JSON parseável.

### Fase WR3 — Coletores de Evidência

Objetivo: capturar estado do sistema antes e depois de ações.

Coletores:

- `git`: branch, status, log curto, diff stat;
- `db`: integrity, migrations status, counts principais;
- `clawde`: `diagnose all`, quota status, sessions summary;
- `systemd`: status de receiver/worker/timers quando disponível;
- `github`: issues/PRs relevantes via `gh` se autenticado;
- `logs`: últimas linhas de logs conhecidos, com redaction.

Critério de pronto:

- `war-room collect --all` gera arquivos em `evidence/`;
- falha de um coletor não aborta os outros;
- segredos são redigidos;
- relatório lista coletores `ok`, `warn`, `error`.

### Fase WR4 — Gates e Safety Engine

Objetivo: impedir que automação execute ações perigosas sem aprovação explícita.

Gates mínimos:

- `panic-stop-real`
- `events-purge`
- `sandbox-change`
- `auth-secret-change`
- `db-migration`
- `main-push`
- `service-restart`

Critério de pronto:

- executor classifica ações por lane;
- guarded actions criam gate pendente;
- `gate approve` exige motivo;
- aprovação fica persistida em `decisions.jsonl`;
- gate expira por tempo configurável.

### Fase WR5 — Planejamento e GSD Bridge

Objetivo: ler planos existentes e criar waves executáveis, sem virar autopilot livre.

Inputs:

- `docs/TEST-HARDENING-PLAN.md`
- `.planning/phases/*/PLAN.md`
- `STATUS.md`
- GitHub issues via `gh issue list`

Outputs:

- `war-room plan` com waves, comandos, gates e critérios;
- `report.md` com execução planejada;
- checkpoints de handoff.

Critério de pronto:

- parser não precisa entender todo Markdown, mas extrai checklists e tabelas básicas;
- usuário consegue ver o que seria executado antes de rodar;
- cada wave tem arquivos-alvo e validação obrigatória.

### Fase WR6 — Executor Automatizado

Objetivo: executar waves Green/Yellow com dry-run obrigatório antes de mudanças.

Capacidades:

- rodar comandos permitidos;
- registrar stdout/stderr resumidos;
- parar no primeiro erro não tolerado;
- atualizar timeline;
- sugerir próximo passo;
- nunca executar guarded sem gate.

Critério de pronto:

- `execute --wave N --dry-run` lista ações;
- `execute --wave N --confirm` roda apenas ações permitidas;
- falha gera evidence bundle;
- comandos têm timeout;
- não há shell injection em argumentos gerados a partir de Markdown.

### Fase WR7 — Verificação e Relatórios

Objetivo: automatizar fechamento com evidências.

Verificações:

- `bun run typecheck`
- `bun run lint`
- `bun test`
- `bun run build:worker`
- `clawde smoke-test`
- `clawde diagnose all`
- testes específicos por fase

Relatórios:

- status do War Room;
- timeline;
- decisões;
- comandos executados;
- falhas e issues abertas;
- próximos gates manuais.

Critério de pronto:

- `war-room verify --ci --diagnose` gera resumo claro;
- `war-room report` produz Markdown bom para colar no GitHub/Claude;
- `war-room close` exige verificação ou `--force --reason`.

### Fase WR8 — Refatoração e Integração

Objetivo: consolidar interfaces e remover duplicação.

Pontos de refactor esperados:

- extrair `CommandRunner` reutilizável;
- padronizar captura de output;
- reaproveitar redaction de logs;
- reaproveitar `diagnose` internamente sem parsing de texto;
- centralizar resolução de `CLAWDE_HOME`/config;
- criar helpers para Markdown table parsing se necessário.

Critério de pronto:

- módulos não acoplam CLI diretamente à persistência;
- testes unitários não dependem de HOME real;
- comandos aceitam injeção de clock/fs/runner;
- comportamento de CLI permanece compatível.

### Fase WR9 — Documentação e Runbooks

Objetivo: tornar War Room utilizável sem conhecer o código.

Arquivos:

- `docs/runbooks/war-room.md`
- `docs/runbooks/incident-response.md`
- `docs/runbooks/hardening-session.md`
- `docs/adr/0017-war-room-file-first.md`
- atualização de `README.md` e `KNOWN_GAPS.md`

Critério de pronto:

- operador consegue abrir e fechar War Room seguindo runbook;
- docs explicam lanes e gates;
- exemplos cobrem incidente, hardening e soak;
- limitações conhecidas registradas.

### Fase WR10 — UAT, Soak e Release

Objetivo: validar experiência real.

UAT:

- operador sozinho em incidente simulado;
- hardening batch com falha de teste;
- execução autônoma docs-only;
- guarded action recusada sem aprovação;
- closeout com relatório final.

Critério de pronto:

- 0 falhas críticas;
- nenhum segredo em relatório;
- relatório final suficiente para reconstruir o que aconteceu;
- docs ajustadas após UAT;
- `STATUS.md` atualizado.

---

## 5. Backlog Atômico

### WR0 — Planejamento

| ID | Tipo | Tarefa | Arquivos-alvo | Dep | Critério de pronto |
|---|---|---|---|---|---|
| WR-001 | docs | Criar plano mestre War Room | `docs/WAR_ROOM_IMPLEMENTATION_PLAN.md` | - | Plano em `main`, com checklist e backlog |
| WR-002 | docs | Criar ADR file-first | `docs/adr/0017-war-room-file-first.md` | WR-001 | ADR descreve decisão, alternativas e rollback |
| WR-003 | docs | Registrar War Room em `KNOWN_GAPS.md` como gap em execução | `docs/KNOWN_GAPS.md` | WR-001 | KG-8/KG-9 referenciam plano |
| WR-004 | docs | Criar checklist de segurança de automação | `docs/runbooks/war-room-safety.md` | WR-001 | Lanes e gates descritos |

### WR1 — Domínio e Store

| ID | Tipo | Tarefa | Arquivos-alvo | Dep | Critério de pronto |
|---|---|---|---|---|---|
| WR-005 | design | Definir tipos `WarRoom`, `WarRoomKind`, `WarRoomStatus` | `src/war-room/domain.ts` | WR-001 | Tipos exportados e testados |
| WR-006 | design | Definir `WarRoomTimelineEntry` append-only | `src/war-room/domain.ts` | WR-005 | Tipos cobrem note, evidence, gate, command, close |
| WR-007 | impl | Implementar geração de id `WR-YYYYMMDD-NNN` | `src/war-room/ids.ts` | WR-005 | Teste com clock fixo |
| WR-008 | impl | Implementar store file-first | `src/war-room/store.ts` | WR-005 | Cria diretórios e arquivos |
| WR-009 | impl | Implementar active pointer | `src/war-room/store.ts` | WR-008 | `getActive`, `setActive`, `clearActive` |
| WR-010 | test | Testar room open/close | `tests/unit/war-room/store.test.ts` | WR-008 | 100% happy path |
| WR-011 | test | Testar JSON corrompido | `tests/unit/war-room/store.test.ts` | WR-008 | Erro claro, sem apagar arquivo |
| WR-012 | test | Testar concorrência simples | `tests/unit/war-room/store.test.ts` | WR-009 | Segunda abertura ativa falha sem `--force` |

### WR2 — CLI Mínimo

| ID | Tipo | Tarefa | Arquivos-alvo | Dep | Critério de pronto |
|---|---|---|---|---|---|
| WR-013 | impl | Criar comando `war-room open` | `src/cli/commands/war-room.ts`, `src/cli/main.ts` | WR-009 | Cria room ativa |
| WR-014 | impl | Criar comando `war-room status` | `src/cli/commands/war-room.ts` | WR-013 | Text e JSON |
| WR-015 | impl | Criar comando `war-room note` | `src/cli/commands/war-room.ts` | WR-013 | Timeline recebe nota |
| WR-016 | impl | Criar comando `war-room close` | `src/cli/commands/war-room.ts` | WR-015 | Closeout gerado |
| WR-017 | test | Testes integração CLI básico | `tests/integration/war-room-cmd.test.ts` | WR-016 | open/status/note/close passam |
| WR-018 | docs | Documentar comandos mínimos | `docs/runbooks/war-room.md` | WR-016 | Exemplos copiáveis |

### WR3 — Evidência

| ID | Tipo | Tarefa | Arquivos-alvo | Dep | Critério de pronto |
|---|---|---|---|---|---|
| WR-019 | impl | Criar interface `EvidenceCollector` | `src/war-room/collectors/types.ts` | WR-008 | Contrato com status e outputs |
| WR-020 | impl | Coletor git | `src/war-room/collectors/git.ts` | WR-019 | Captura branch/status/log/diffstat |
| WR-021 | impl | Coletor DB | `src/war-room/collectors/db.ts` | WR-019 | integrity, migrations, counts |
| WR-022 | impl | Coletor diagnose | `src/war-room/collectors/diagnose.ts` | WR-019 | Usa função interna, não parsing frágil |
| WR-023 | impl | Coletor systemd | `src/war-room/collectors/systemd.ts` | WR-019 | Warn se systemd indisponível |
| WR-024 | impl | Coletor GitHub | `src/war-room/collectors/github.ts` | WR-019 | Usa `gh` se disponível; warn se não |
| WR-025 | impl | Coletor logs com redaction | `src/war-room/collectors/logs.ts` | WR-019 | Segredos redigidos |
| WR-026 | impl | CLI `war-room collect` | `src/cli/commands/war-room.ts` | WR-020 | `--all`, flags individuais |
| WR-027 | test | Testes coletores com runners fake | `tests/unit/war-room/collectors.test.ts` | WR-026 | Sem depender do host |
| WR-028 | test | Integração collect em temp HOME | `tests/integration/war-room-collect.test.ts` | WR-026 | Evidence files existem |

### WR4 — Gates

| ID | Tipo | Tarefa | Arquivos-alvo | Dep | Critério de pronto |
|---|---|---|---|---|---|
| WR-029 | design | Definir `ActionLane` e `Gate` | `src/war-room/gates.ts` | WR-005 | Green/Yellow/Guarded/Blocked |
| WR-030 | impl | Classificador de comandos | `src/war-room/gates.ts` | WR-029 | Detecta purge, panic, service restart |
| WR-031 | impl | Persistir gates pendentes | `src/war-room/store.ts` | WR-029 | Gate id, reason, expiry |
| WR-032 | impl | CLI `gate list` | `src/cli/commands/war-room.ts` | WR-031 | Lista gates |
| WR-033 | impl | CLI `gate approve` | `src/cli/commands/war-room.ts` | WR-031 | Requer reason |
| WR-034 | test | Guarded sem aprovação bloqueia | `tests/unit/war-room/gates.test.ts` | WR-030 | Não executa |
| WR-035 | test | Aprovação expirada bloqueia | `tests/unit/war-room/gates.test.ts` | WR-033 | Expiry respeitado |

### WR5 — Plan Bridge

| ID | Tipo | Tarefa | Arquivos-alvo | Dep | Critério de pronto |
|---|---|---|---|---|---|
| WR-036 | design | Definir `WarRoomPlan` e `Wave` | `src/war-room/planner.ts` | WR-005 | Tipos testáveis |
| WR-037 | impl | Parser simples de checklist Markdown | `src/war-room/markdown.ts` | WR-036 | Extrai checkboxes |
| WR-038 | impl | Parser simples de tabelas Markdown | `src/war-room/markdown.ts` | WR-037 | Extrai linhas de plano |
| WR-039 | impl | `war-room plan --from <file>` | `src/cli/commands/war-room.ts` | WR-038 | Gera plan local |
| WR-040 | impl | Integrar `.planning/phases/*/PLAN.md` | `src/war-room/planner.ts` | WR-039 | Detecta waves e ACs |
| WR-041 | test | Testar parsing com fixture G3 | `tests/unit/war-room/planner.test.ts` | WR-040 | Sem brittle snapshots gigantes |
| WR-042 | docs | Documentar limites do parser | `docs/runbooks/war-room.md` | WR-040 | Limitações claras |

### WR6 — Executor

| ID | Tipo | Tarefa | Arquivos-alvo | Dep | Critério de pronto |
|---|---|---|---|---|---|
| WR-043 | design | Criar `CommandRunner` injetável | `src/war-room/command-runner.ts` | WR-029 | Timeout, cwd, env, capture |
| WR-044 | impl | Implementar dry-run executor | `src/war-room/executor.ts` | WR-043 | Lista ações sem executar |
| WR-045 | impl | Implementar execução Green | `src/war-room/executor.ts` | WR-044 | Roda comandos permitidos |
| WR-046 | impl | Implementar execução Yellow com confirmação | `src/war-room/executor.ts` | WR-045 | Exige `--confirm` |
| WR-047 | impl | Bloquear Guarded sem gate | `src/war-room/executor.ts` | WR-031 | Cria gate e para |
| WR-048 | impl | CLI `war-room execute` | `src/cli/commands/war-room.ts` | WR-047 | Wave + dry-run + confirm |
| WR-049 | test | Testar timeout | `tests/unit/war-room/executor.test.ts` | WR-043 | Processo travado encerrado |
| WR-050 | test | Testar shell injection defense | `tests/unit/war-room/executor.test.ts` | WR-048 | Args não viram shell string |
| WR-051 | test | Integração execute dry-run | `tests/integration/war-room-execute.test.ts` | WR-048 | Sem efeitos colaterais |

### WR7 — Verificação e Reporting

| ID | Tipo | Tarefa | Arquivos-alvo | Dep | Critério de pronto |
|---|---|---|---|---|---|
| WR-052 | impl | Criar `VerificationSuite` | `src/war-room/verify.ts` | WR-043 | CI/smoke/diagnose plugáveis |
| WR-053 | impl | CLI `war-room verify` | `src/cli/commands/war-room.ts` | WR-052 | Text e JSON |
| WR-054 | impl | Gerar `report.md` | `src/war-room/report.ts` | WR-008 | Timeline + decisions + evidence |
| WR-055 | impl | CLI `war-room report` | `src/cli/commands/war-room.ts` | WR-054 | stdout e arquivo |
| WR-056 | impl | Close exige verify ou force reason | `src/cli/commands/war-room.ts` | WR-053 | Gate de qualidade |
| WR-057 | test | Report não vaza segredo | `tests/security/war-room-redaction.test.ts` | WR-054 | Tokens redigidos |
| WR-058 | test | Verify falhando bloqueia close normal | `tests/integration/war-room-close.test.ts` | WR-056 | Requer `--force --reason` |

### WR8 — Eventos e Integração Clawde

| ID | Tipo | Tarefa | Arquivos-alvo | Dep | Critério de pronto |
|---|---|---|---|---|---|
| WR-059 | design | Decidir EventKind dedicado vs genérico | `docs/adr/0017-war-room-file-first.md` | WR-001 | Decisão documentada |
| WR-060 | impl | Adicionar EventKind se aprovado | `src/domain/events.ts`, migrations | WR-059 | CHECK + tests atualizados |
| WR-061 | impl | Emitir eventos War Room | `src/war-room/events.ts` | WR-060 | Open/collect/gate/close |
| WR-062 | test | Roundtrip de event kinds | `tests/property/event-kind-roundtrip.test.ts` | WR-060 | Todos inserem/leem |
| WR-063 | test | Timeline file e DB event consistentes | `tests/integration/war-room-events.test.ts` | WR-061 | IDs correlacionáveis |

### WR9 — Documentação

| ID | Tipo | Tarefa | Arquivos-alvo | Dep | Critério de pronto |
|---|---|---|---|---|---|
| WR-064 | docs | Runbook War Room | `docs/runbooks/war-room.md` | WR-018 | Fluxo completo |
| WR-065 | docs | Runbook incidente | `docs/runbooks/incident-response.md` | WR-064 | SEV-like sem burocracia |
| WR-066 | docs | Runbook hardening session | `docs/runbooks/hardening-session.md` | WR-064 | Test-hardening integrado |
| WR-067 | docs | Atualizar README | `README.md` | WR-064 | Link e resumo |
| WR-068 | docs | Atualizar KNOWN_GAPS | `docs/KNOWN_GAPS.md` | WR-064 | KG-8/KG-9 rebaixados/atualizados |
| WR-069 | docs | Templates de closeout | `docs/templates/war-room-closeout.md` | WR-054 | Pronto para copiar |

### WR10 — UAT e Release

| ID | Tipo | Tarefa | Arquivos-alvo | Dep | Critério de pronto |
|---|---|---|---|---|---|
| WR-070 | test | UAT hardening batch | `docs/WAR_ROOM_UAT_LOG.md` | WR-069 | Operador segue runbook |
| WR-071 | test | UAT incidente quota | `docs/WAR_ROOM_UAT_LOG.md` | WR-069 | Diagnose + report suficientes |
| WR-072 | test | UAT guarded action | `docs/WAR_ROOM_UAT_LOG.md` | WR-069 | Sem gate, ação bloqueada |
| WR-073 | test | Soak de 24h com coleta periódica | `docs/WAR_ROOM_UAT_LOG.md` | WR-052 | Sem corrupção, report final |
| WR-074 | chore | Atualizar STATUS | `STATUS.md` | WR-073 | Estado e próximos passos |
| WR-075 | release | Fechar fase War Room V1 | `docs/WAR_ROOM_IMPLEMENTATION_PLAN.md` | WR-074 | Status `implemented` ou followups |

---

## 6. Checklist de Execução

### Checklist Global

- [ ] WR0 aprovado e versionado.
- [ ] Fases WR1-WR2 entregam CLI mínimo.
- [ ] Fase WR3 coleta evidência sem vazar segredo.
- [ ] Fase WR4 bloqueia ações guarded.
- [ ] Fase WR5 lê planos e cria waves.
- [ ] Fase WR6 executa Green/Yellow com dry-run.
- [ ] Fase WR7 gera report e closeout.
- [ ] Fase WR8 integra eventos quando seguro.
- [ ] Fase WR9 documenta operação.
- [ ] Fase WR10 valida com UAT e soak.

### Checklist Por PR

- [ ] Branch pequena e nomeada `task/war-room-<slice>`.
- [ ] Escopo do PR corresponde a uma wave.
- [ ] Sem arquivos não relacionados.
- [ ] Testes unitários adicionados quando há lógica nova.
- [ ] Testes integração adicionados quando há CLI/IO.
- [ ] Testes security adicionados quando há redaction/gates.
- [ ] `bun run typecheck`.
- [ ] `bun run lint`.
- [ ] `bun test`.
- [ ] `bun run build:worker` se tocar runtime/worker/shared build.
- [ ] Docs atualizadas.
- [ ] `STATUS.md` atualizado quando a fase muda de estado.

### Checklist De Segurança

- [ ] Nenhum relatório contém `CLAUDE_CODE_OAUTH_TOKEN`.
- [ ] Nenhum relatório contém secrets de Telegram.
- [ ] `events purge` nunca roda sem gate aprovado.
- [ ] `panic-stop` real nunca roda sem gate aprovado.
- [ ] `systemctl restart/stop` nunca roda sem gate aprovado.
- [ ] Mudanças de sandbox/auth/retention ficam guarded.
- [ ] Comandos derivados de Markdown não passam por shell string.
- [ ] Timeouts existem para comandos externos.

### Checklist De Fechamento

- [ ] Evidence bundle final existe.
- [ ] `report.md` gerado.
- [ ] `closeout.md` gerado.
- [ ] Issues/PRs relacionados listados.
- [ ] Falhas abertas viraram followups.
- [ ] Próxima ação clara.
- [ ] Room fechada ou explicitamente mantida ativa.

---

## 7. Plano De Testes

### Unitários

- domínio: status transitions, ids, validation;
- store: mkdir, read/write, append-only, active pointer;
- gates: classificação, aprovação, expiração;
- collectors: runners fake e redaction;
- markdown parser: checklists, tabelas, headings;
- executor: dry-run, timeout, error mapping;
- reporter: formato, ordenação, redaction.

### Integração

- CLI open/status/note/close em HOME temporário;
- collect `--git --db --diagnose` em repo real com DB temporário;
- plan a partir de fixtures Markdown;
- execute dry-run sem efeitos;
- guarded action bloqueada;
- verify com comando fake falhando;
- close bloqueado sem verify.

### Segurança

- payload com tokens e URLs sensíveis no log;
- gate bypass attempt via argumento malicioso;
- Markdown tentando injetar `; rm -rf`;
- symlink em evidence dir;
- arquivo JSON corrompido;
- permissões de arquivo em `~/.clawde/state/war-room`.

### E2E Manual/UAT

- abrir War Room para hardening real;
- coletar evidência antes de executar testes;
- gerar report para compartilhar com Claude;
- fechar com resultado `resolved`;
- simular ação guarded e confirmar bloqueio.

### Soak

Rodar durante 24h em ambiente local:

```text
war-room open --kind hardening
war-room collect --all a cada 4h
war-room verify --diagnose a cada 4h
war-room report ao final
```

Critério:

- 0 corrupção de state;
- 0 vazamento de segredo;
- reports consistentes;
- nenhum comando guarded executado sem aprovação.

---

## 8. Plano De Verificação

### Gates Mínimos Locais

```bash
bun run typecheck
bun run lint
bun test
bun run build:worker
```

### Gates Adicionais Por Escopo

| Escopo | Verificação adicional |
|---|---|
| CLI | testes integração do comando + JSON parse |
| Store | testes com HOME temporário + JSON corrompido |
| Collectors | runners fake + host unavailable |
| Security | `tests/security/*` |
| Events/migrations | migration roundtrip + event-kind property |
| Docs | comando copiado dos runbooks roda em dry-run |

### Evidência Obrigatória Por Fase

| Fase | Evidência |
|---|---|
| WR1 | unit tests domain/store |
| WR2 | integração CLI mínimo |
| WR3 | evidence bundle fixture |
| WR4 | guarded action bloqueada |
| WR5 | plan gerado de fixture real |
| WR6 | dry-run + confirm controlado |
| WR7 | report final sem segredo |
| WR8 | events roundtrip |
| WR9 | runbook seguido em UAT |
| WR10 | UAT log + soak summary |

---

## 9. Plano De Refatoração

Refatorações devem acontecer somente quando desbloqueiam a implementação, não como limpeza solta.

### Refactors Prováveis

1. **Command runner comum**
   - Extrair padrão usado em scripts/CLI para `src/system/command-runner.ts` ou `src/war-room/command-runner.ts`.
   - Benefício: timeouts, stdout/stderr, fake runner em testes.

2. **Config/home resolver**
   - Evitar duplicar expansão de `~`, `CLAWDE_HOME`, `CLAWDE_CONFIG`.
   - Benefício: War Room, diagnose, smoke e worker convergem.

3. **Redaction comum**
   - Reusar lógica de redaction de logs em evidence/report.
   - Benefício: segurança de relatório.

4. **Diagnose como API interna**
   - War Room deve chamar funções de diagnose, não parsear texto CLI.
   - Benefício: menos brittleness.

5. **Markdown utilities**
   - Parser pequeno e testado para checklists/tabelas.
   - Benefício: plan bridge confiável sem dependência pesada.

### Anti-Refactors

- Não trocar toda persistência para SQLite antes da V1.
- Não criar framework de workflow genérico demais.
- Não mover GSD para dentro do Clawde.
- Não substituir `STATUS.md`.
- Não transformar War Room em dashboard web antes da CLI estar madura.

---

## 10. Plano De Documentação

### Documentos Novos

| Arquivo | Objetivo |
|---|---|
| `docs/runbooks/war-room.md` | Uso operacional principal |
| `docs/runbooks/incident-response.md` | Incidentes reais |
| `docs/runbooks/hardening-session.md` | Sessões de teste/hardening |
| `docs/templates/war-room-closeout.md` | Template de fechamento |
| `docs/adr/0017-war-room-file-first.md` | Decisão de arquitetura |
| `docs/WAR_ROOM_UAT_LOG.md` | Registro de UAT |

### Documentos A Atualizar

| Arquivo | Mudança |
|---|---|
| `README.md` | Link para War Room e comandos básicos |
| `STATUS.md` | Estado da fase |
| `docs/KNOWN_GAPS.md` | KG-8/KG-9 atualizados |
| `docs/TEST-HARDENING-PLAN.md` | Referência a War Room em futuras rodadas |
| `docs/GSD_EXECUTION_STRATEGY.md` | War Room como camada operacional entre GSD e execução |

---

## 11. Estratégia De GitHub

### Branches Recomendadas

| Branch | Conteúdo |
|---|---|
| `task/war-room-plan` | WR0 docs |
| `task/war-room-core-store` | WR1 |
| `task/war-room-cli-minimum` | WR2 |
| `task/war-room-evidence` | WR3 |
| `task/war-room-gates` | WR4 |
| `task/war-room-plan-execute` | WR5-WR6 |
| `task/war-room-reporting` | WR7 |
| `task/war-room-events-docs` | WR8-WR9 |
| `task/war-room-uat` | WR10 |

### Issues Recomendadas

Criar issues somente se o operador quiser rastreamento GitHub granular. Sugestão:

- `War Room V1: core store and CLI`
- `War Room V1: evidence collectors`
- `War Room V1: safety gates`
- `War Room V1: plan/execute bridge`
- `War Room V1: reporting and docs`
- `War Room V1: UAT and soak`

### Política De Merge

- Docs-only: pode ir direto para `main` se operador autorizou.
- Código Green/Yellow: PR normal, CI obrigatório.
- Guarded: PR + aprovação explícita do operador.
- Security-sensitive: não auto-merge.

---

## 12. Riscos E Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| War Room vira autopilot amplo demais | alto | lanes e gates; waves pequenas |
| Relatório vaza segredo | crítico | redaction central + tests security |
| Parser Markdown executa comando inesperado | alto | dry-run, argv sem shell, allowlist |
| Store file-first corrompe JSON | médio | append-only JSONL + backups |
| Duplicação com GSD | médio | War Room orquestra estado; GSD planeja fases |
| UI/CLI cresce demais | médio | V1 só comandos essenciais |
| Eventos exigem migration arriscada | médio | adiar EventKind dedicado até WR8 |
| Automação derruba serviço real | alto | systemd actions guarded |

---

## 13. Roadmap De Entrega

### MVP Técnico

Escopo mínimo que já vale uso real:

- WR1 store;
- WR2 CLI mínimo;
- WR3 collect git/db/diagnose;
- WR4 gates;
- WR7 report básico.

Estimativa: 2 a 4 dias de implementação concentrada.

### V1 Operacional

Escopo recomendado antes de usar como camada oficial:

- MVP técnico;
- plan bridge;
- executor dry-run;
- verify;
- docs/runbooks;
- UAT.

Estimativa: 5 a 8 dias, dependendo da profundidade dos coletores GitHub/systemd.

### Pós-V1

- dashboard TUI ou web;
- integração Telegram;
- GitHub issues automáticas;
- tabelas SQLite dedicadas;
- replay de incidentes;
- métricas históricas.

---

## 14. Definition Of Done

War Room V1 estará pronto quando:

- [ ] `clawde war-room open/status/note/collect/report/close` funcionam.
- [ ] Evidence bundle é criado e legível.
- [ ] Relatório final tem timeline, decisões, evidências e próximos passos.
- [ ] Ações guarded são bloqueadas sem aprovação.
- [ ] Testes locais passam.
- [ ] Runbooks existem e foram seguidos em UAT.
- [ ] Nenhum segredo aparece em report/evidence.
- [ ] `STATUS.md` e `README.md` apontam para a funcionalidade.
- [ ] O operador consegue usar em uma sessão real sem consultar o código.

---

## 15. Próxima Ação Recomendada

Executar WR0 completo:

1. manter este plano em `main`;
2. criar ADR `0017-war-room-file-first.md`;
3. criar `docs/runbooks/war-room-safety.md`;
4. abrir branch `task/war-room-core-store`;
5. implementar WR1 com testes unitários;
6. só então iniciar CLI mínimo.

O ponto importante: **não começar pelo executor**. Começar por estado, evidência e gates cria o trilho seguro para a automação vir depois.
