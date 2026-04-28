# ClaudeClaw - Comparativo Arquitetural (OpenClaw vs Hermes vs ClaudeClaw)

> Documento de pesquisa para planejamento do ClaudeClaw
> Data: 2026-04-28
> Versão: 3 (com documentação oficial do Claude Code)

==================================================================

## Resumo Executivo

**ClaudeClaw** é um daemon pessoal de execução de tasks que usa `claude -p` headless via Max subscription, eliminando custo de API por token.

Este documento compara 3 arquiteturas relacionadas:
- **OpenClaw** — Gateway Node.js com múltiplos canais
- **Hermes** — Gateway Python com ecossistema de skills
- **ClaudeClaw** — Poller oneshot via Claude Code headless

===================================================================

## 1. Visão Geral das Arquiteturas

### 1.1 OpenClaw

```
┌────────────────────────────────────────────────────────────────┐
│                       openclaw gateway                          │
│  (Node.js daemon, systemd/launchd, porta 18789)                │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐     ┌──────────────┐    ┌──────────────┐    │
│  │   Channels   │     │   Sessions   │    │    Tools     │    │
│  │  (plugins)   │     │   Manager    │    │   Runtime    │    │
│  └──────────────┘     └──────────────┘    └──────────────┘    │
│        │                   │                    │              │
│  Telegram, WA,         Sessões isoladas      exec, read,      │
│  Discord, Slack,       por agente/canal      edit, cron,      │
│  Signal, etc.          + histórico           browser, etc.    │
│                                                                 │
├────────────────────────────────────────────────────────────────┤
│                     Provider Layer                              │
│  (API calls: Anthropic, OpenAI, Google, Ollama, etc.)          │
└────────────────────────────────────────────────────────────────┘
```

**Características principais:**
- Gateway always-on (Node.js/TypeScript)
- Plugins de canal (Telegram, WhatsApp, Discord, Signal, etc.)
- Sessões isoladas por conversa/agente
- Tools runtime próprio (exec, browser, cron, canvas)
- Skills como .md (agentskills)
- Memória: MEMORY.md + memory/*.md (flat files)
- API paga por token

### 1.2 Hermes

```
┌────────────────────────────────────────────────────────────────┐
│                     Hermes Gateway                              │
│  (Python daemon, FastAPI, SQLite state.db)                     │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐     ┌──────────────┐    ┌──────────────┐    │
│  │  Channels    │     │   SQLite     │    │   Toolsets   │    │
│  │  (plugins)   │     │  state.db    │    │  (40+ tools) │    │
│  └──────────────┘     └──────────────┘    └──────────────┘    │
│                                                                 │
├────────────────────────────────────────────────────────────────┤
│                    Memory Plugins                               │
│  (Honcho, Mem0, Hindsight, SQLite FTS5)                        │
├────────────────────────────────────────────────────────────────┤
│                   Provider Layer                                │
│  (OpenRouter, Anthropic, OpenAI, 200+ models)                  │
└────────────────────────────────────────────────────────────────┘
```

**Características principais:**
- Gateway always-on (Python/FastAPI)
- SQLite com FTS5 (busca full-text nativa)
- Skills Hub (instalação externa via agentskills.io)
- Memory plugins (Honcho, Mem0, Hindsight)
- 40+ tools modulares
- Workflow state tracking (fases, verificação, riscos)
- Terminal backends (local, Docker, SSH, Daytona, Modal)
- Checkpoints para rollback
- API paga por token

### 1.3 ClaudeClaw (Proposto)

```
┌────────────────────────────────────────────────────────────────┐
│                   ClaudeClaw (oneshot)                          │
│  (systemd timer, roda só quando há task pendente)              │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   │
│  │  Task Queue  │     │   claude -p  │     │  claude-mem  │   │
│  │  (SQLite)    │────▶│   headless   │◀───▶│  (HTTP API)  │   │
│  └──────────────┘     └──────────────┘     └──────────────┘   │
│       │                  │                      │              │
│  schema similar       usa Max quota        SQLite FTS5        │
│  ao Hermes state.db   zero custo API       + Chroma           │
│                                                                 │
├────────────────────────────────────────────────────────────────┤
│                 Input Adapters (opcional)                       │
│  (Telegram bot, webhook, CLI — inserem tasks na fila)          │
└────────────────────────────────────────────────────────────────┘
```

**Características principais:**
- Poller oneshot (systemd timer, não always-on)
- `claude -p` headless (Claude Code CLI)
- Max subscription = custo fixo mensal
- Task queue em SQLite
- Memória via `claude-mem` (FTS5 + Chroma)
- Sub-agentes via `.claude/agents/`

==================================================================

## 2. Comparativo Detalhado

| Aspecto | OpenClaw | Hermes | ClaudeClaw | **Recomendado** |
|---------|----------|--------|------------|-----------------|
| **Linguagem** | Node.js/TypeScript | Python | Bash + SQLite | **Bash + SQLite** — mais simples |
| **LLM invocation** | API HTTP | API HTTP | `claude -p` headless | **`claude -p`** — usa Max quota |
| **Custo** | API paga por token | API paga por token | Max subscription (fixo) | **Max subscription** |
| **Daemon** | Gateway always-on | Gateway always-on | Poller oneshot | **Poller oneshot** |
| **Estado/sessões** | JSON + memória | SQLite FTS5 | SQLite (tasks + history) | **SQLite FTS5** |
| **Tools** | Runtime próprio | 40+ tools modulares | `.claude/agents/` | **`.claude/agents/`** |
| **Memory** | MEMORY.md flat files | Plugins (Honcho, Mem0) | `claude-mem` (FTS5 + Chroma) | **SQLite FTS5 + Chroma** |
| **Multi-provider** | Sim | Sim (200+ via OpenRouter) | Não (só Claude Code) | **Só Claude Code** |
| **Quota** | $/token | $/token | 45 msgs/5h (Max) | **Quota Max** |

==================================================================

## 3. O que Hermes tem que OpenClaw não tem

1. **SQLite state.db com FTS5** — sessões, mensagens, busca semântica nativa
2. **Skills Hub** — instalação de skills de repositórios externos (agentskills.io)
3. **Memory plugins** — Honcho (user modeling), Mem0, Hindsight. Não é flat file.
4. **Toolsets configuráveis** — UI para toggle de 20+ categorias de tools
5. **Workflow state tracking** — tabela `workflow_state` com fases, verificação, riscos
6. **Terminal backends** — local, Docker, SSH, Daytona, Singularity, Modal
7. **Checkpoints** — snapshots de estado para rollback
8. **Batch/RL training** — tools para Atropos, trajectory generation

==================================================================

## 4. O que ClaudeClaw deve reusar

### 4.1 Do Hermes

| Componente | Motivo |
|------------|--------|
| **Schema SQLite** (`sessions`, `messages`, `messages_fts`) | Quase pronto para adaptar |
| **Workflow state** | Conceito de fases + verificação é útil |
| **FTS5 pattern** | Busca full-text em mensagens |
| **Checkpoints** | Snapshots antes de tasks arriscadas |

### 4.2 Do OpenClaw

| Componente | Motivo |
|------------|--------|
| **Padrão de daemon systemd** | Estrutura de service file já existe |
| **Concept de channels como plugins** | Pode adaptar como "input adapters" |
| **Isolamento de agentes** | Workspaces separados via `--working-dir` |
| **Skills como .md** | Compatíveis com `.claude/agents/` |
| **Hooks pattern** | Hooks jq/bash para auditoria |

==================================================================

## 5. Diferenças Fundamentais

| | Hermes/OpenClaw | ClaudeClaw |
|--|----------------|------------|
| **Invocação** | API HTTP síncrona | CLI headless (`claude -p`) |
| **Sempre ligado** | Gateway always-on | Só roda quando há task |
| **Contexto** | Mantém em memória | Passa via `-C conversation_id` |
| **Output** | Tool results via API | stdout/stderr do CLI |

==================================================================

## 6. Análise de Gargalos

### 6.1 Gargalos do OpenClaw

| Gargalo | Descrição | Impacto |
|---------|-----------|---------|
| **Custo por token** | API paga por chamada. Uso pesado = conta alta. | $$$ mensal |
| **Gateway always-on** | Daemon Node.js sempre rodando, mesmo sem mensagens. | RAM ~200-400MB parado |
| **Sessões em memória** | Contexto de sessões fica em RAM, não persiste bem em crash. | Perda de contexto |
| **Latência de channels** | Polling de alguns canais (WA, Signal) adiciona delay. | 1-5s latência extra |
| **Provider lock-in** | Maioria das features otimizada para Anthropic. | Migração difícil |
| **Skills não versionadas** | SKILL.md em flat files sem controle de versão. | Difícil rollback |

### 6.2 Gargalos do Hermes

| Gargalo | Descrição | Impacto |
|---------|-----------|---------|
| **Custo por token** | Mesmo problema do OpenClaw — API paga. | $$$ mensal |
| **Python + dependências** | Stack pesado, muitos packages, setup complexo. | ~500MB+ instalado |
| **Gateway always-on** | Também roda daemon contínuo. | RAM ~300-500MB parado |
| **SQLite locks** | FTS5 + múltiplas conexões pode causar `database is locked`. | Falha em concorrência |
| **Overhead de plugins** | 40+ tools carregados mesmo se não usados. | Startup lento |
| **Memory plugins externos** | Honcho/Mem0 dependem de serviços externos. | Ponto de falha adicional |

### 6.3 ClaudeClaw vai ter esses gargalos?

| Gargalo OpenClaw/Hermes | ClaudeClaw tem? | Por quê |
|-------------------------|-----------------|---------|
| **Custo por token** | ❌ Não | Usa Max subscription, custo fixo |
| **Gateway always-on** | ❌ Não | Oneshot via systemd timer |
| **RAM parado** | ❌ Não | Processo morre após cada execução |
| **Sessões em memória** | ❌ Não | Tudo em SQLite, persiste entre runs |
| **SQLite locks** | ⚠️ Parcial | Mitigar com WAL mode |
| **Stack pesado** | ❌ Não | Bash + SQLite + `claude -p` |
| **Overhead de tools** | ❌ Não | `.claude/agents/` carrega só o que precisa |

### 6.4 Gargalos NOVOS que ClaudeClaw terá

| Gargalo | Descrição | Mitigação |
|---------|-----------|-----------|
| **Quota Max** | 45 mensagens / 5 horas. | Fila com prioridade, rate limit |
| **CLI parsing** | Output JSON pode mudar entre versões. | Validação de schema, fallback |
| **Sem streaming** | `claude -p` não tem streaming nativo. | Aceitar latência |
| **Context window** | `-C` só funciona para sessões existentes. | Gerenciar IDs no SQLite |
| **Cold start** | Cada invocação é cold. | Aceitar ~2-3s extra por task |
| **Sem multi-provider** | Só Claude. Se cair, não tem fallback. | Aceitar ou fallback manual |

### 6.5 Resumo de Gargalos

**ClaudeClaw elimina os 2 maiores gargalos:** custo por token e daemon always-on.

**Troca por:** limite de quota (45/5h) e cold start. Para uso pessoal/low-volume, é trade-off favorável.

**Risco principal:** estourar a quota em burst. Solução: fila com prioridade + rate limit inteligente.

==================================================================

## 7. Sessões Continuadas e Cache de Contexto

### 7.1 O Problema do Oneshot

Em teoria, cada run oneshot = carregar histórico como input + gerar output = gasta tokens de INPUT toda vez.

No modelo API (pago por token), isso seria desastroso — recarregar 50k tokens de contexto a cada task.

### 7.2 Como Claude Code Resolve

O Claude Code CLI **não é igual à API raw**. Ele tem:

**1. Sessões persistentes (`-C` / `--continue`)**
```bash
claude -p "tarefa" -C session_id
```
- Retoma sessão existente sem reenviar todo o histórico
- O CLI mantém cache local do contexto da sessão

**2. Cache de contexto no Max subscription**
- Max não cobra por token de input
- O limite é **mensagens** (45/5h), não tokens
- Recarregar contexto não gasta mais do limite

**3. Resumption via session files**
```bash
# Claude Code salva sessões em:
~/.claude/sessions/
```
- O CLI pode retomar de onde parou sem re-processar tudo

### 7.3 Impacto Real para ClaudeClaw

| Cenário | Gasto |
|---------|-------|
| Task nova (sessão nova) | 1 mensagem |
| Task continuando sessão | 1 mensagem (contexto cacheado) |
| Task com histórico longo | 1 mensagem (mesmo custo) |

**Conclusão:** O limite do Max é por **interação**, não por volume de contexto. Oneshot com `-C` não multiplica o gasto.

### 7.4 Riscos Reais

O risco não é "gastar mais do limite", é:

1. **Sessão expira** — se a sessão ficar muito velha, pode perder cache
2. **Contexto muito grande** — se ultrapassar context window (200k), precisa compactar

**Mitigação no ClaudeClaw:**
- Manter sessões ativas por task recorrente
- Compactar histórico quando passar de ~150k tokens
- SQLite guarda resumo, não histórico completo

### 7.5 Arquitetura Recomendada

```
┌────────────────────────────────────────────────────────────────┐
│                   ClaudeClaw Architecture                       │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   │
│  │  Task Queue  │     │   Sessão     │     │   claude -p  │   │
│  │  (SQLite)    │────▶│  Continuada  │────▶│   -C <id>    │   │
│  └──────────────┘     └──────────────┘     └──────────────┘   │
│                              │                                  │
│                    Cache de contexto                            │
│                    mantido pelo CLI                             │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

**Faz sentido:** sessão continuada por longo prazo, usar cache, task queue só como queue.

==================================================================

## 8. Documentação Oficial do Claude Code

### 8.1 Níveis de Documentação

| Nível | Símbolo | Descrição |
|-------|---------|-----------|
| Oficial | 🟢 | Documentado em docs.anthropic.com ou code.claude.com |
| Possivelmente | 🟡 | Documentado em blogs, GitHub, exemplos |
| Não documentado | ⚠️ | Comportamento observado mas não garantido |

### 8.2 Classificação de Funcionalidades

#### 🟢 Oficialmente Documentado

**CLI Básico:**
- `claude` - Iniciar sessão interativa
- `claude -p "query"` - Modo não-interativo (print/SDK)
- `claude -c` - Continuar conversa recente
- `claude -r "<session-id>"` - Resumir sessão específica
- Todos os 80+ flags em https://code.claude.com/docs/en/cli-reference

**Autenticação:**
- `claude auth login` / `logout` / `status`
- `claude setup-token` - Gerar OAuth token 1-ano para CI/CD
- `CLAUDE_CODE_OAUTH_TOKEN` - Variável de ambiente

**Agent SDK:**
- Python SDK: `pip install claude-agent-sdk` (Python 3.10+)
- TypeScript SDK: `npm install @anthropic-ai/claude-agent-sdk`
- Documentação: https://platform.claude.com/docs/en/agent-sdk/overview

**Sessões e Memória:**
- `/add-dir` - Expandir diretórios acessíveis
- `/resume` - Picker interativo de sessões
- `CLAUDE.md` - Instruções persistentes por projeto

**Contexto e Limites:**
- Context window: 200K tokens (Sonnet 4.6, Opus 4.6, Opus 4.7)
- 1M tokens disponível em beta para Opus 4.7

#### 🟡 Documentado em Blog/GitHub

**Automação Headless:**
- `--dangerously-skip-permissions` - Risco documentado em blogs
- `--permission-mode auto` - Auto mode com saída segura
- Containerização como padrão (recomendação documentada)

**Session Persistence:**
- Localização: `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`
- Formato JSONL append-only (sem risco de corrupção)
- Cleanup automático de sessões antigas

**Context Compaction:**
- Triggers a 64-75% de capacidade
- Degradação de performance em 147K-152K tokens
- Prompt Cache TTL: 5 minutos com DISABLE_TELEMETRY

#### ⚠️ Não Documentado (Comportamento Observado)

**Limites de Quotas (abril 2026):**
- Pro ($20/mo): quota base 5h rolling window
- Max 5x ($100/mo): 5x Pro quota
- Max 20x ($200/mo): 20x Pro quota
- Peak hours: 5-11 AM PT (7% dos users afetados, consumo 1.5-2x mais rápido)

**Comportamento de Compactação:**
- Morte espiral documentada: 6 compactações em 3.5 min (Issue #24677)
- System context consuming 86.5% da janela
- Recomendação: monitorar e limpar contexto manualmente

### 8.3 FLAGS CLI COMPLETOS

#### Flags de Sessão
```
-p, --print              Modo não-interativo (SDK/print mode)
-c, --continue           Continuar conversa mais recente
-r, --resume             Resumir sessão por ID/nome
--session-id             Use UUID específico
--fork-session           Nova sessão em vez de reusar
--no-session-persistence Não salvar sessão em disco
```

#### Flags de Modelo e Esforço
```
--model                  {sonnet|opus|haiku|nome-completo}
--effort                 {low|medium|high|xhigh|max}
--fallback-model         Fallback automático se modelo sobrecarregado
```

#### Flags de Sistema Prompt
```
--system-prompt          Substituir todo o prompt padrão
--append-system-prompt   Adicionar ao prompt padrão
--exclude-dynamic-system-prompt-sections  Melhorar cache reuse
```

#### Flags de Permissão e Segurança
```
--permission-mode        {default|auto|plan|acceptEdits|dontAsk|bypassPermissions}
--dangerously-skip-permissions  Eq. a bypassPermissions
--allowedTools           Tools sem prompt (pattern matching)
--disallowedTools        Tools removidas do modelo
```

#### Flags de Saída e Formato
```
--output-format          {text|json|stream-json}
--json-schema            Validar JSON saída contra schema
--max-budget-usd         Limite de gasto em API (print mode)
--max-turns              Limite de turnos agentic (print mode)
```

#### Flags de Contexto e Ferramentas
```
--add-dir                Diretórios adicionais
--tools                  Restringir tools: "Bash,Edit,Read"
--bare                   Modo rápido: skip hooks, skills, plugins
```

### 8.4 SDKs Disponíveis

| SDK | Instalação | Requisitos |
|-----|------------|------------|
| **Python** | `pip install claude-agent-sdk` | Python 3.10+ |
| **TypeScript** | `npm install @anthropic-ai/claude-agent-sdk` | Node.js 18+ |
| **CLI** | `curl -fsSL https://claude.ai/install.sh \| bash` | Bash |

### 8.5 Sessões e Persistência

**Path:** `~/.claude/projects/<project-hash>/<session-id>.jsonl`

**Formato:** JSONL append-only (sem corrupção, sem locking)

**Variável de ambiente:** `CLAUDE_CONFIG_DIR` sobrescreve ~/.claude

**Permissões:**
- Linux: modo 0600 (apenas user pode ler)
- macOS: Keychain encriptado
- Windows: Herda ACLs do perfil

### 8.6 Context Window e Compactação

| Modelo | Context Window | 1M Disponível |
|--------|----------------|---------------|
| Claude Sonnet 4.6 | 200K tokens | Sim (GA) |
| Claude Opus 4.6 | 200K tokens | Sim (GA) |
| Claude Opus 4.7 | 200K tokens | Sim (GA) |

**Buffer:** ~33K tokens (16.5% da janela 200K)

**Pontos críticos:**
- Degradação clara: 147K-152K tokens
- Auto-compaction triggers: 64-75% de capacidade
- Ponto de falha: >180K tokens

### 8.7 Autenticação para Scripts

#### Opção 1: OAuth Token (Recomendado para Max)
```bash
claude setup-token
# Gera token 1-ano
export CLAUDE_CODE_OAUTH_TOKEN="seu-token"
claude -p "tarefa"
```

#### Opção 2: API Key (Pay-as-you-go)
```bash
export ANTHROPIC_API_KEY="sk-..."
claude -p "tarefa"
```

#### Precedência de Autenticação
1. Cloud provider (Bedrock/Vertex/Foundry)
2. `ANTHROPIC_AUTH_TOKEN`
3. `ANTHROPIC_API_KEY`
4. `apiKeyHelper` script
5. `CLAUDE_CODE_OAUTH_TOKEN`
6. OAuth subscription (padrão interativo)

### 8.8 Custos e Limites

| Plano | Preço | Quota |
|-------|-------|-------|
| Claude Pro | $20/mês | Base (5h rolling) |
| Claude Max 5x | $100/mês | 5x Pro |
| Claude Max 20x | $200/mês | 20x Pro |

**5-Hour Rolling Window:** Quota reseta a cada 5 horas

**Peak Hour Penalty (abril 2026):**
- Horário: 5-11 AM PT / 1-7 PM GMT
- Afeta: ~7% dos users
- Consumo: 1.5-2x mais rápido

==================================================================

## 9. Uso Correto de Cada Funcionalidade

### 9.1 Execução Headless Básica

```bash
# Execução simples
claude -p "Implemente a função X"

# Com output JSON
claude -p "Liste os arquivos" --output-format json
```

**Recomendação ClaudeClaw:** Usar `--output-format json` para parsing confiável.

### 9.2 Continuação de Sessões

```bash
# Continuar última sessão do diretório
claude -c

# Continuar sessão específica por ID
claude -p "Continue o trabalho" -C "abc123"

# Continuar por nome
claude -r "minha-feature"
```

**Recomendação ClaudeClaw:** Manter IDs de sessão no SQLite, usar `-C` para contexto.

### 9.3 Modo Bare (Startup Rápido)

```bash
# Skip hooks, skills, plugins, MCP, memory
claude -p "Tarefa simples" --bare
```

**Recomendação ClaudeClaw:** Usar `--bare` para tasks que não precisam de contexto.

### 9.4 Structured Output

```bash
# Validar output contra schema JSON
claude -p "Gere dados" --json-schema '{"type":"object","properties":{"name":{"type":"string"}}}'
```

**Recomendação ClaudeClaw:** Usar para tasks que precisam de output estruturado.

### 9.5 Permission Modes

```bash
# Auto mode (recomendado para automação)
claude -p "Tarefa" --permission-mode auto

# Bypass total (apenas em container isolado!)
claude -p "Tarefa" --dangerously-skip-permissions
```

**Recomendação ClaudeClaw:** Usar `auto` por padrão, `bypass` apenas em containers.

### 9.6 Limitar Execução

```bash
# Máximo 10 turnos
claude -p "Tarefa complexa" --max-turns 10

# Máximo $0.50 de gasto (API mode)
claude -p "Tarefa" --max-budget-usd 0.5
```

**Recomendação ClaudeClaw:** Usar `--max-turns` para evitar loops infinitos.

### 9.7 Autenticação para Scripts

```bash
# Gerar token de longa duração (1 ano)
claude setup-token

# Usar em CI/CD
export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-..."
claude -p "Tarefa automatizada"
```

**Recomendação ClaudeClaw:** Usar `setup-token` e renovar anualmente.

==================================================================

## 10. Pontos de Risco para ClaudeClaw

### 🔴 Riscos Altos (Mitigar obrigatoriamente)

| Risco | Descrição | Mitigação |
|-------|-----------|-----------|
| **Prompt Injection** | PR descriptions podem conter instruções maliciosas | Tratar como DATA, nunca instrução |
| **Morte Espiral de Compactação** | 6 compactações em 3.5 min (Issue #24677) | Timeout, limpar contexto manualmente |
| **Token Expiration** | setup-token expira em 1 ano sem auto-renewal | Renovar 30 dias antes, alerta no cron |

### 🟡 Riscos Médios (Monitorar)

| Risco | Descrição | Mitigação |
|-------|-----------|-----------|
| **Context Window** | Degradação >150K tokens | `--max-turns`, compactação manual |
| **Session DoS** | Acúmulo em ~/.claude/projects/ | Cleanup periódico |
| **Mudança de Quotas** | Terceira-party tools não mais cobertas | Monitorar changelog |
| **CLI Schema Change** | Output JSON pode mudar | Validação defensiva |

### 🟢 Riscos Baixos (Aceitáveis)

| Risco | Descrição | Mitigação |
|-------|-----------|-----------|
| **Cold Start** | ~2-3s extra por task | Aceitar |
| **Sem Streaming** | Latência maior | Aceitar |
| **Sem Multi-Provider** | Só Claude | Aceitar para simplicidade |

### 10.1 Recomendações de Implementação

1. **Sempre usar `--bare` ou `--max-turns`** para scripts curtos
2. **Containerizar todas automações headless**
3. **Monitorar token expiration** (30 dias antes)
4. **Usar `--exclude-dynamic-system-prompt-sections`** para cache reuse
5. **Implementar timeout** em long-running sessions
6. **Validar schema JSON** antes de parsear output

==================================================================

## 11. Decisões de Arquitetura para ClaudeClaw

### 11.1 Core

| Decisão | Escolha | Justificativa |
|---------|---------|---------------|
| Linguagem do poller | Bash | Simples, sem dependências |
| Estado | SQLite único | Atômico, portável, queryável |
| Invocação LLM | `claude -p` headless | Max quota, zero custo API |
| Scheduling | systemd timer (oneshot) | Só consome recursos quando há task |
| Memória | `claude-mem` (FTS5 + Chroma) | Busca full-text + semântica |
| Sub-agentes | `.claude/agents/` | Nativo do Claude Code |
| Sessões | Continuadas com `-C` | Cache de contexto |

### 11.2 Schema SQLite

```sql
-- Tasks queue
CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT DEFAULT 'pending',
    priority INTEGER DEFAULT 0,
    prompt TEXT NOT NULL,
    conversation_id TEXT,
    agent TEXT DEFAULT 'default',
    working_dir TEXT,
    result TEXT,
    error TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    started_at TEXT,
    finished_at TEXT
);

-- Sessions (padrão Hermes)
CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT UNIQUE NOT NULL,
    agent TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
);

-- Messages (padrão Hermes)
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER REFERENCES sessions(id),
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Full-text search (FTS5)
CREATE VIRTUAL TABLE messages_fts USING fts5(
    content,
    content='messages',
    content_rowid='id'
);

-- Workflow state (padrão Hermes)
CREATE TABLE workflow_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER REFERENCES tasks(id),
    phase TEXT,
    verification TEXT,
    risks TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
```

==================================================================

## 12. Próximos Passos

1. **Fase 1:** Criar `state.db` com schema acima + poller básico
2. **Fase 2:** Systemd timer (5 min) + testes manuais
3. **Fase 3:** Integrar `claude-mem` para memória persistente
4. **Fase 4:** Input adapters (Telegram bot, webhook, CLI)
5. **Fase 5:** Quota management + alertas
6. **Fase 6:** Sessão continuada com `-C` + gerenciamento de IDs
7. **Fase 7:** OAuth token rotation (anual)
8. **Fase 8:** Containerização para tasks de alto risco

==================================================================

## 13. Referências

### Documentação Oficial
- **Claude Code CLI Reference:** https://code.claude.com/docs/en/cli-reference
- **Claude Code Authentication:** https://code.claude.com/docs/en/authentication
- **Agent SDK Overview:** https://platform.claude.com/docs/en/agent-sdk/overview
- **Context Windows:** https://platform.claude.com/docs/en/build-with-claude/context-windows

### Repositórios
- **Claude Code:** https://github.com/anthropics/claude-code
- **Agent SDK Python:** https://github.com/anthropics/claude-agent-sdk-python
- **Agent SDK TypeScript:** https://github.com/anthropics/claude-agent-sdk-typescript

### Projetos Relacionados
- **OpenClaw:** https://github.com/openclaw/openclaw
- **Hermes:** https://github.com/harvest-flow/hermes
- **claude-mem:** https://github.com/cachyproject/claude-mem
