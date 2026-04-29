# Clawde — Blueprint Estrutural

> Spec executável. Para o "porquê" ver `ARCHITECTURE.md`; para o "como operar" ver `BEST_PRACTICES.md`.
> Versão: 1 (2026-04-29)

## Índice

1. Árvore de pastas do repositório
2. Tipos do domínio (TypeScript interfaces)
3. Contrato HTTP do `clawde-receiver` (OpenAPI mini-spec)
4. Contrato dos hooks Claude Code (JSON I/O)
5. Contrato dos sub-agentes (`.claude/agents/<name>/AGENT.md`)
6. CLI do `clawde` (comandos)
7. Configuração (`clawde.toml` schema)

==================================================================

## 1. Árvore de pastas

```
clawde/
├── package.json                 # deps pinadas, scripts bun
├── bunfig.toml                  # config Bun (test, build)
├── tsconfig.json                # strict mode, NodeNext
├── biome.json                   # lint + format
├── .semgrep/clawde.yml          # regras SAST custom
├── .gitleaks.toml               # padrões de secret scan
├── ARCHITECTURE.md
├── BEST_PRACTICES.md
├── BLUEPRINT.md                 # este arquivo
├── CHANGELOG.md
├── README.md
│
├── src/
│   ├── domain/                  # tipos puros, zero IO
│   │   ├── task.ts              # Task, TaskRun, Priority
│   │   ├── session.ts           # Session, SessionState
│   │   ├── event.ts             # Event, EventKind
│   │   ├── quota.ts             # QuotaLedgerEntry, QuotaWindow
│   │   └── index.ts
│   │
│   ├── db/                      # SQLite (bun:sqlite)
│   │   ├── client.ts            # Database singleton + WAL setup
│   │   ├── repositories/
│   │   │   ├── tasks.ts
│   │   │   ├── task-runs.ts
│   │   │   ├── sessions.ts
│   │   │   ├── events.ts
│   │   │   ├── quota-ledger.ts
│   │   │   └── memory.ts
│   │   └── migrations/
│   │       ├── 001_initial.up.sql
│   │       ├── 001_initial.down.sql
│   │       ├── runner.ts        # apply pending, validate, etc.
│   │       └── index.ts
│   │
│   ├── receiver/                # always-on HTTP daemon
│   │   ├── server.ts            # Bun.serve setup
│   │   ├── routes/
│   │   │   ├── enqueue.ts       # POST /enqueue (unix socket)
│   │   │   ├── webhook-telegram.ts
│   │   │   ├── webhook-github.ts
│   │   │   └── health.ts
│   │   ├── auth/
│   │   │   ├── hmac.ts
│   │   │   └── rate-limit.ts
│   │   └── dedup.ts             # idempotency_key handling
│   │
│   ├── worker/                  # oneshot
│   │   ├── main.ts              # entrypoint (systemd .path triggers)
│   │   ├── lease.ts             # acquire/heartbeat/release
│   │   ├── reconcile.ts         # startup: lease expirado → re-enqueue
│   │   ├── runner.ts            # invoca SDK, stream, persist
│   │   └── workspace.ts         # git worktree add/remove
│   │
│   ├── sdk/                     # wrapper @anthropic-ai/claude-agent-sdk
│   │   ├── client.ts            # session create/resume
│   │   ├── stream.ts            # async iterator handling
│   │   └── parser.ts            # ParsedObservation, ParsedSummary
│   │                            # (padrão copiado de claude-mem)
│   │
│   ├── hooks/                   # callbacks tipados do SDK
│   │   ├── pre-tool-use.ts
│   │   ├── post-tool-use.ts
│   │   ├── stop.ts
│   │   ├── user-prompt-submit.ts  # prompt-guard (port de gsd-prompt-guard)
│   │   └── session-start.ts
│   │
│   ├── memory/                  # indexação nativa
│   │   ├── jsonl-indexer.ts     # batch ~/.claude/projects/*.jsonl
│   │   ├── observations.ts      # write em memory_observations
│   │   ├── search.ts            # FTS5 + (opcional) sqlite-vec
│   │   └── embeddings.ts        # @xenova/transformers WASM
│   │
│   ├── quota/
│   │   ├── ledger.ts            # decremento + window sliding
│   │   ├── thresholds.ts        # NORMAL/AVISO/RESTRITO/CRITICO
│   │   ├── peak-hours.ts        # multiplier por TZ
│   │   └── policy.ts            # decide aceitar/adiar/recusar
│   │
│   ├── sandbox/
│   │   ├── systemd.ts           # gera .service/.path units
│   │   ├── bwrap.ts             # comando bwrap nivel 2
│   │   ├── netns.ts             # nivel 3 (loopback only)
│   │   └── matrix.ts            # carrega .clawde/agents/*/sandbox.toml
│   │
│   ├── auth/
│   │   ├── oauth.ts             # CLAUDE_CODE_OAUTH_TOKEN load
│   │   ├── refresh.ts           # detect 401, run setup-token headless
│   │   └── credentials.ts       # systemd LoadCredential / macOS Keychain
│   │
│   ├── log/
│   │   ├── logger.ts            # JSON estruturado, níveis
│   │   ├── redact.ts            # mascarar tokens/PII
│   │   ├── secrets.ts           # lista de chaves sensíveis
│   │   └── trace.ts             # correlation IDs (ULID)
│   │
│   ├── config/
│   │   ├── load.ts              # parse ~/.clawde/config/clawde.toml
│   │   ├── schema.ts            # zod schema, valida no boot
│   │   └── defaults.ts
│   │
│   ├── cli/                     # `clawde` binary
│   │   ├── main.ts              # entrypoint
│   │   ├── commands/
│   │   │   ├── queue.ts         # clawde queue "..."
│   │   │   ├── logs.ts          # clawde logs --task X
│   │   │   ├── trace.ts
│   │   │   ├── quota.ts
│   │   │   ├── smoke-test.ts
│   │   │   ├── diagnose.ts
│   │   │   ├── panic-stop.ts
│   │   │   ├── panic-resume.ts
│   │   │   ├── forget.ts
│   │   │   └── audit.ts
│   │   └── output.ts            # text / json
│   │
│   └── adapters/                # input externos
│       ├── telegram/
│       │   ├── bot.ts           # grammy
│       │   └── sanitize.ts
│       └── github/
│           └── webhook.ts
│
├── tests/
│   ├── unit/                    # bun test, :memory: db
│   │   ├── domain/
│   │   ├── quota/
│   │   ├── sandbox/
│   │   ├── log/
│   │   └── memory/
│   ├── integration/             # bun test com SDK mockado
│   │   ├── worker.test.ts
│   │   ├── receiver.test.ts
│   │   ├── reconcile.test.ts
│   │   └── lifecycle.test.ts
│   ├── e2e/                     # SDK real (quota separada)
│   │   ├── simple-task.test.ts
│   │   ├── tool-use.test.ts
│   │   ├── session-resume.test.ts
│   │   └── max-turns.test.ts
│   ├── security/
│   │   ├── injection.test.ts
│   │   ├── log-redaction.test.ts
│   │   ├── sandbox-escape.test.ts
│   │   └── webhook-auth.test.ts
│   ├── property/                # fast-check
│   │   ├── sanitize.prop.ts
│   │   └── dedup.prop.ts
│   ├── chaos/
│   │   └── network-flake.test.ts
│   └── fixtures/
│       ├── jsonl/
│       └── prompts/
│
├── .claude/
│   ├── agents/
│   │   ├── implementer/
│   │   │   ├── AGENT.md
│   │   │   └── sandbox.toml
│   │   ├── spec-reviewer/
│   │   ├── code-quality-reviewer/
│   │   ├── verifier/
│   │   └── researcher/
│   └── hooks/                   # links pra src/hooks compilado
│
├── deploy/
│   ├── systemd/
│   │   ├── clawde-receiver.service
│   │   ├── clawde-worker.service
│   │   ├── clawde-worker.path    # watcha state.db mtime
│   │   ├── clawde-smoke.service
│   │   ├── clawde-smoke.timer
│   │   ├── clawde-backup.service
│   │   └── clawde-backup.timer
│   └── config-example/
│       ├── clawde.toml
│       └── alerts.toml
│
├── scripts/
│   ├── restore-drill.sh
│   ├── backup.sh
│   └── pentest-checklist.sh
│
└── docs/
    ├── adr/                     # Architecture Decision Records
    ├── runbooks/                # incident response
    ├── postmortems/
    ├── decisions/               # ADRs específicos de feature
    └── security/                # pentest reports
```

**Convenções:**
- Imports relativos dentro de `src/` (`./domain/task`); imports cross-tree usam path alias `@clawde/*`.
- Cada subpasta de `src/` tem `index.ts` re-exportando API pública. Imports externos a uma subpasta passam **só** pelo `index.ts`.
- Nenhum `process.env.X` fora de `src/config/`.
- Nenhum `console.log` fora de `src/cli/output.ts`.
- Nenhum `child_process.exec` (sempre `execFile` em wrapper testável).

==================================================================

## 2. Tipos do Domínio

Tipos puros, zero IO. Vivem em `src/domain/`. Toda persistência (`db/repositories/`)
recebe e devolve estes tipos. Stringly-typed states ficam atrás de union literais.

### 2.1 Task & TaskRun

```typescript
// src/domain/task.ts

export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export type TaskRunStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'abandoned';

/** Imutável após INSERT. Representa intenção. */
export interface Task {
  readonly id: number;
  readonly priority: Priority;
  readonly prompt: string;
  readonly agent: string;                    // 'default' | nome em .claude/agents/
  readonly sessionId: string | null;         // UUID determinístico opcional
  readonly workingDir: string | null;
  readonly dependsOn: ReadonlyArray<number>; // task IDs
  readonly source: TaskSource;
  readonly sourceMetadata: Record<string, unknown>;
  readonly dedupKey: string | null;
  readonly createdAt: string;                // ISO-8601 UTC ms
}

export type TaskSource =
  | 'cli'
  | 'telegram'
  | 'webhook-github'
  | 'webhook-generic'
  | 'cron'
  | 'subagent';                              // task criada por outra task

/** Cada tentativa de execução. */
export interface TaskRun {
  readonly id: number;
  readonly taskId: number;
  readonly attemptN: number;                 // 1-based
  readonly workerId: string;                 // ex: "host01-pid-12847"
  readonly status: TaskRunStatus;
  readonly leaseUntil: string | null;        // ISO-8601, null quando finalizado
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly result: string | null;
  readonly error: string | null;
  readonly msgsConsumed: number;
}

/** Input pra criar Task. id/createdAt gerados pela camada db. */
export type NewTask = Omit<Task, 'id' | 'createdAt'>;

/** Transições válidas (validadas em src/state/transitions.ts). */
export const TASK_RUN_TRANSITIONS: Record<TaskRunStatus, TaskRunStatus[]> = {
  pending:    ['running', 'abandoned'],
  running:    ['succeeded', 'failed', 'abandoned'],
  succeeded:  [],
  failed:     [],
  abandoned:  ['pending'],
};
```

### 2.2 Session

```typescript
// src/domain/session.ts

export type SessionState =
  | 'created'
  | 'active'
  | 'idle'
  | 'stale'
  | 'compact_pending'
  | 'archived';

export interface Session {
  readonly sessionId: string;       // UUID v5 determinístico
  readonly agent: string;
  readonly state: SessionState;
  readonly lastUsedAt: string | null;
  readonly msgCount: number;
  readonly tokenEstimate: number;
  readonly createdAt: string;
}

export const SESSION_TRANSITIONS: Record<SessionState, SessionState[]> = {
  created:         ['active'],
  active:          ['idle'],
  idle:            ['active', 'stale'],
  stale:           ['compact_pending', 'archived'],
  compact_pending: ['active', 'archived'],
  archived:        [],
};

/** Geração determinística de session ID. */
export function deriveSessionId(input: {
  agent: string;
  workingDir: string;
  intent?: string;
}): string {
  // UUID v5 com namespace fixo (definido em src/domain/uuid.ts)
  // Implementação concreta no código; aqui apenas contrato.
}
```

### 2.3 Event (audit append-only)

```typescript
// src/domain/event.ts

export type EventKind =
  // receiver
  | 'enqueue'
  | 'auth_fail'
  | 'rate_limit_hit'
  | 'dedup_skip'
  // worker lifecycle
  | 'task_start'
  | 'task_finish'
  | 'task_fail'
  | 'lease_expired'
  | 'quarantine_enter'
  | 'quarantine_exit'
  // claude SDK
  | 'claude_invocation_start'
  | 'claude_invocation_end'
  | 'tool_use'
  | 'tool_result'
  | 'tool_blocked'
  | 'compact_triggered'
  // quota
  | 'quota_threshold_crossed'
  | 'quota_reset'
  | 'peak_multiplier_applied'
  // auth
  | 'oauth_refresh_attempt'
  | 'oauth_refresh_success'
  | 'oauth_expiry_warning'
  // sandbox
  | 'sandbox_init'
  | 'sandbox_violation'
  // migrations / maintenance
  | 'migration_start'
  | 'migration_end'
  | 'migration_fail'
  | 'maintenance_start'
  | 'maintenance_end'
  // security
  | 'prompt_guard_alert'
  | 'panic_stop';

export interface Event {
  readonly id: number;
  readonly ts: string;
  readonly taskRunId: number | null;
  readonly sessionId: string | null;
  readonly traceId: string | null;            // ULID
  readonly spanId: string | null;
  readonly kind: EventKind;
  readonly payload: Record<string, unknown>;  // JSON; redacted via src/log/redact
}

export type NewEvent = Omit<Event, 'id' | 'ts'>;
```

### 2.4 Quota Ledger

```typescript
// src/domain/quota.ts

export type Plan = 'pro' | 'max5x' | 'max20x';

export type QuotaState = 'normal' | 'aviso' | 'restrito' | 'critico' | 'esgotado';

export interface QuotaLedgerEntry {
  readonly id: number;
  readonly ts: string;
  readonly msgsConsumed: number;
  readonly windowStart: string;       // arredondado pra hora cheia UTC
  readonly plan: Plan;
  readonly peakMultiplier: number;    // 1.0 default, 1.5-2.0 em peak
  readonly taskRunId: number | null;
}

export interface QuotaWindow {
  readonly windowStart: string;
  readonly plan: Plan;
  readonly msgsConsumed: number;
  readonly state: QuotaState;
  readonly resetsAt: string;          // windowStart + 5h
}

export interface QuotaPolicy {
  /** Decide se uma task pode rodar agora. */
  canAccept(window: QuotaWindow, priority: Priority): {
    accept: boolean;
    deferUntil?: string;              // ISO se accept=false
    reason: string;
  };
}
```

### 2.5 Memory observation

```typescript
// src/domain/memory.ts (continuação)

export type ObservationKind = 'observation' | 'summary' | 'decision';

export interface MemoryObservation {
  readonly id: number;
  readonly sessionId: string | null;
  readonly sourceJsonl: string | null;   // path do arquivo origem
  readonly kind: ObservationKind;
  readonly content: string;
  readonly createdAt: string;
}

export interface MemorySearchResult {
  readonly observation: MemoryObservation;
  readonly score: number;                // FTS5 rank ou cosine similarity
  readonly matchType: 'fts' | 'embedding';
}
```

### 2.6 Workspace

```typescript
// src/domain/workspace.ts

/** Worktree ephemeral por task_run. */
export interface Workspace {
  readonly path: string;                 // /tmp/clawde-<task_run_id>
  readonly baseBranch: string;
  readonly featureBranch: string;        // clawde/<task_id>-<slug>
  readonly taskRunId: number;
  readonly createdAt: string;
}
```

==================================================================

## 3. Contrato HTTP do `clawde-receiver`

Daemon always-on minimal. Bun.serve em `127.0.0.1:18790` (TCP) **e** unix socket
`/run/clawde/receiver.sock` (preferido pra CLI local). Auth por endpoint, rate-limited.

### 3.1 OpenAPI (mini-spec)

```yaml
openapi: 3.0.3
info:
  title: clawde-receiver
  version: 1.0.0
servers:
  - url: http://127.0.0.1:18790
  - url: unix:///run/clawde/receiver.sock

paths:
  /health:
    get:
      summary: Liveness + readiness
      security: []                       # sem auth
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/HealthOk'
        '503':
          description: not ready
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/HealthDegraded'

  /enqueue:
    post:
      summary: Enfileira task (uso interno via unix socket)
      security:
        - unixSocket: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/EnqueueRequest'
      responses:
        '202':
          description: aceito
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/EnqueueResponse'
        '400': { $ref: '#/components/responses/BadRequest' }
        '409': { $ref: '#/components/responses/Conflict' }   # dedup
        '429': { $ref: '#/components/responses/RateLimited' }
        '503': { $ref: '#/components/responses/Unavailable' } # quota crítico

  /webhook/telegram:
    post:
      summary: Telegram bot webhook
      security:
        - telegramSecret: []
      requestBody:
        required: true
        content:
          application/json:
            schema: { type: object }     # Update do Telegram (validado em adapter)
      responses:
        '202': { description: enfileirado ou ignorado }
        '401': { $ref: '#/components/responses/Unauthorized' }

  /webhook/github:
    post:
      summary: GitHub webhook
      security:
        - githubHmac: []
      requestBody:
        required: true
        content:
          application/json:
            schema: { type: object }
      responses:
        '202': { description: enfileirado }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '422': { description: evento ignorado (não acionável) }

components:
  securitySchemes:
    unixSocket:
      type: apiKey
      in: header
      name: Authorization              # placeholder; auth real é fs perms
    telegramSecret:
      type: apiKey
      in: header
      name: X-Telegram-Bot-Api-Secret-Token
    githubHmac:
      type: apiKey
      in: header
      name: X-Hub-Signature-256

  schemas:
    EnqueueRequest:
      type: object
      required: [prompt]
      properties:
        prompt:        { type: string, minLength: 1, maxLength: 16000 }
        priority:      { $ref: '#/components/schemas/Priority' }
        agent:         { type: string, default: 'default' }
        sessionId:     { type: string, nullable: true, format: uuid }
        workingDir:    { type: string, nullable: true }
        dependsOn:     { type: array, items: { type: integer }, default: [] }
        dedupKey:      { type: string, nullable: true, maxLength: 256 }
        sourceMetadata:{ type: object, default: {} }

    EnqueueResponse:
      type: object
      required: [taskId, traceId]
      properties:
        taskId:        { type: integer }
        traceId:       { type: string }                          # ULID
        deduped:       { type: boolean, default: false }

    Priority:
      type: string
      enum: [LOW, NORMAL, HIGH, URGENT]
      default: NORMAL

    HealthOk:
      type: object
      required: [ok, db, quota]
      properties:
        ok:      { type: boolean, enum: [true] }
        db:      { type: string, enum: [ok] }
        quota:   { type: string, enum: [normal, aviso, restrito, critico, esgotado] }
        version: { type: string }

    HealthDegraded:
      type: object
      required: [ok, reason]
      properties:
        ok:     { type: boolean, enum: [false] }
        reason: { type: string, enum: [db_corrupted, quota_exhausted, oauth_expired, maintenance] }
        details:{ type: string }

  responses:
    BadRequest:
      description: payload inválido
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
    Unauthorized:    { description: auth falhou }
    Conflict:        { description: dedup_key duplicada }
    RateLimited:     { description: limite por origem excedido }
    Unavailable:     { description: receiver não aceitando (quota/maintenance) }
```

### 3.2 Headers globais

| Header (request) | Obrigatório | Notas |
|------------------|-------------|-------|
| `X-Clawde-Trace-Id` | não | Se ausente, server gera ULID e ecoa |
| `X-Idempotency-Key` | não | Alternativa a `dedupKey` no body |
| `Content-Type: application/json` | sim em POST | |

| Header (response) | Sempre | Notas |
|-------------------|--------|-------|
| `X-Clawde-Trace-Id` | sim | Eco do request ou gerado |
| `X-Clawde-Version` | sim | semver do receiver |
| `Retry-After` | em 429/503 | Segundos até retry |

### 3.3 Rate limits

| Origem | Limite |
|--------|--------|
| IP remoto (webhook) | 10 req/min, 100 req/h |
| Unix socket | sem limite (acesso já é restrito por fs) |
| Por `dedupKey` | 1x (segunda → 409) |
| Health endpoint | 60 req/min (não conta no rate global) |

Implementação: token bucket em memória do receiver (não vale a pena persistir).

==================================================================

## 4. Contrato dos Hooks Claude Code

Hooks são callbacks tipados executados pelo Agent SDK em pontos definidos do ciclo de vida.
Cada hook recebe payload JSON via stdin, escreve resposta JSON via stdout. Exit code 0 =
ok; ≠0 = erro (registrado em `events.kind='hook_error'`, **não bloqueia** execução salvo
configurado o contrário).

### 4.1 Hook lifecycle

```
sessão criada                 → SessionStart
prompt do usuário recebido    → UserPromptSubmit (pode bloquear via prompt-guard)
LLM decide chamar tool        → PreToolUse (pode bloquear)
tool executa                  → PostToolUse (registra resultado)
sessão termina (ok ou erro)   → Stop
```

### 4.2 Input/Output JSON (todos os hooks)

**Input (stdin) — campos comuns:**
```typescript
interface HookInput {
  hook: 'SessionStart' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse' | 'Stop';
  sessionId: string;
  taskRunId?: number;             // injetado pelo Clawde via env
  traceId?: string;
  ts: string;                     // ISO-8601 UTC
  payload: HookPayload;           // específico por hook
}
```

**Output (stdout) — formato comum:**
```typescript
interface HookOutput {
  ok: boolean;
  /** Se false em PreToolUse/UserPromptSubmit, bloqueia ação. */
  block?: boolean;
  /** Mensagem para registrar em events.payload.message. */
  message?: string;
  /** Eventos extras pra append (além do default do Clawde). */
  extraEvents?: Array<{ kind: string; payload: Record<string, unknown> }>;
}
```

### 4.3 Por hook

#### SessionStart
```typescript
interface SessionStartPayload {
  agent: string;
  workingDir: string;
}
// Uso: warmup memory cache, log início.
// Block: não suportado.
```

#### UserPromptSubmit (prompt-guard)
```typescript
interface UserPromptSubmitPayload {
  prompt: string;
  source?: 'cli' | 'telegram' | 'webhook-github' | 'webhook-generic';
}
// Uso: detectar prompt injection, role-play hijack, override de system.
// Block: true → SDK não envia prompt; cliente recebe erro.
//        Cria event 'prompt_guard_alert' com message.
// Implementação base: port de gsd-prompt-guard.js.
```

#### PreToolUse
```typescript
interface PreToolUsePayload {
  toolName: string;          // 'Bash', 'Edit', 'Read', etc
  toolInput: Record<string, unknown>;
}
// Uso: validar comando contra allowlist; bloquear writes fora do worktree;
//      verificar sandbox level adequado pra tool em uso.
// Block: true → SDK envia tool_result com erro "blocked by hook".
//        Cria event 'tool_blocked'.
```

#### PostToolUse
```typescript
interface PostToolUsePayload {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput: unknown;
  durationMs: number;
  exitCode?: number;
}
// Uso: gravar memory_observations, update statusline, audit completo.
// Block: ignorado (tool já executou).
```

#### Stop
```typescript
interface StopPayload {
  reason: 'completed' | 'max_turns' | 'error' | 'user_abort';
  msgsConsumed: number;
  totalTurns: number;
  finalText?: string;
}
// Uso: persist summary em memory_observations, decrementar quota_ledger,
//      atualizar sessions.state e msg_count.
// Block: ignorado.
```

### 4.4 Configuração de hooks

`~/.clawde/config/hooks.toml`:
```toml
[hooks.SessionStart]
enabled = true
script = "/opt/clawde/dist/hooks/session-start.js"
timeout_ms = 1000

[hooks.UserPromptSubmit]
enabled = true
script = "/opt/clawde/dist/hooks/prompt-guard.js"
timeout_ms = 500
on_timeout = "block"               # ou "allow" — fail-safe default = block

[hooks.PreToolUse]
enabled = true
script = "/opt/clawde/dist/hooks/pre-tool-use.js"
timeout_ms = 200
on_timeout = "allow"               # tool calls não devem ser bloqueadas por timeout

[hooks.PostToolUse]
enabled = true
script = "/opt/clawde/dist/hooks/post-tool-use.js"
timeout_ms = 2000
on_timeout = "allow"

[hooks.Stop]
enabled = true
script = "/opt/clawde/dist/hooks/stop.js"
timeout_ms = 5000
on_timeout = "allow"
```

### 4.5 Erros e timeouts

- Hook timeout → registra `events.kind='hook_timeout'` com `payload.hook` e `payload.duration_ms`.
- Hook exit ≠0 → registra `events.kind='hook_error'` com stderr truncado.
- Comportamento (block vs allow) controlado por `on_timeout` em config.
- Hook nunca recebe segredos no payload (verificado por teste em `tests/security/log-redaction.test.ts`).

==================================================================

## 5. Contrato dos Sub-agentes

Cada sub-agente vive em `.claude/agents/<name>/`:

```
.claude/agents/implementer/
├── AGENT.md          # frontmatter + system prompt
├── sandbox.toml      # nivel de sandbox + restrições
└── examples/         # opcional: exemplos few-shot
```

### 5.1 `AGENT.md` frontmatter

```markdown
---
name: implementer
role: "Implementa código a partir de spec, segue TDD red-green-refactor"
model: sonnet                       # sonnet | opus | haiku | inherit
allowedTools: [Read, Edit, Write, Bash, Grep, Glob]
disallowedTools: [WebFetch]
maxTurns: 15
sandboxLevel: 2                     # 1 | 2 | 3
inputs:
  - name: spec
    type: string
    required: true
  - name: existing_code
    type: string
    required: false
outputs:
  - name: diff
    type: string
  - name: tests_added
    type: array
contract: |
  Recebe spec + código existente. Devolve diff (formato unified) e lista
  de testes adicionados. Falha se cobertura nova <80%.
---

# System Prompt

You implement code following spec strictly. Always TDD: write failing test first,
then minimum code, then refactor. Atomic commits per behavior. Never silently change
unrelated code.
```

### 5.2 `sandbox.toml`

```toml
level = 2                            # ver ARCHITECTURE.md §10.4
network = "allowlist"                # allowlist | loopback-only | none
allowed_egress = [
  "api.anthropic.com",
  "registry.npmjs.org",
]
allowed_writes = ["./workspace"]     # paths relativos ao bwrap chroot
read_only_mounts = ["/usr", "/etc/ssl"]
max_memory_mb = 1024
max_cpu_seconds = 600
```

### 5.3 Sub-agentes mínimos esperados

| Agente | Role | Sandbox | Pipeline |
|--------|------|---------|----------|
| `implementer` | escreve código + testes a partir de spec | 2 | Stage 1 |
| `spec-reviewer` | valida implementação contra spec | 1 | Stage 2 |
| `code-quality-reviewer` | lint, sec, perf, idiomatic | 1 | Stage 3 |
| `verifier` | roda testes, valida cobertura, integration | 2 | Final |
| `researcher` | leitura/análise de código existente | 1 | Aux |
| `debugger` | investigação de falhas | 2 | Aux |
| `nightly-cleanup` | mantém worktrees, archives sessions | 1 | Cron |

### 5.4 Discovery contract

Worker lê `.claude/agents/*/AGENT.md`, valida frontmatter contra `src/domain/agent-schema.ts`
(zod). Falha de validação no startup → quarentena com `events.kind='agent_invalid'`.

==================================================================

## 6. CLI do `clawde`

Binary único compilado via `bun build --compile`. Subcomandos descobríveis via `clawde --help`.

### 6.1 Comandos

```
clawde queue [options] <prompt>
  --priority {LOW|NORMAL|HIGH|URGENT}    default: NORMAL
  --agent <name>                          default: default
  --session-id <uuid>                     reusa sessão
  --working-dir <path>                    default: cwd
  --depends-on <id,id,...>
  --dedup-key <key>
  --output {text|json}                    default: text
  → exit 0 + taskId no stdout, 1 em erro

clawde logs [options]
  --task <id>                             tudo de uma task
  --trace <ulid>                          tudo de uma trace
  --since <duration>                      ex: 1h, 24h, 7d
  --level {TRACE|DEBUG|INFO|WARN|ERROR|FATAL}
  --kind <event-kind>                     filtra events
  --follow / -f                           tail
  --output {text|json}

clawde trace <ulid>
  → consolidação cronológica de events+logs

clawde quota [status|history]
  status   → estado atual da janela (cores: verde/amarelo/vermelho)
  history  → últimas 30 janelas

clawde sessions [list|show|compact|archive]
  list             → todas as sessions com state
  show <id>        → detalhes (msg_count, token_estimate, last_used_at)
  compact <id>     → marca compact_pending; worker compacta na próxima invocação
  archive <id>     → archived; move JSONL pra ~/.clawde/archive/

clawde smoke-test
  → roda checklist de §5.5 do BEST_PRACTICES.md, exit 0 ou 1

clawde diagnose <symptom>
  → diagnóstico interativo (DB integrity, quota, OAuth, sandbox)
  symptoms: db, quota, oauth, sandbox, all

clawde panic-stop
  → para receiver+worker, registra evento, alerta operador
  exit 0 sempre (idempotente)

clawde panic-resume
  → reativa após panic-stop; só funciona se diagnose all retorna ok

clawde forget --user <id>
  → DELETE em tasks/messages do usuário, mantém events com user_id hashed
  --dry-run mostra quantas linhas seriam afetadas

clawde audit [verify|export]
  verify --task <id>         → recomputa hash chain de events da task
  export --since <date> --to <path>  → parquet de events

clawde migrate [up|down|status]
  up [--target <version>]    → aplica migrations pendentes
  down --target <version>    → reverte (perigoso, requer --confirm)
  status                     → mostra current vs latest

clawde config [show|validate|edit]
  show                       → exibe config efetiva (env+toml+defaults merged)
  validate <path>            → valida arquivo TOML contra schema
  edit                       → abre $EDITOR no clawde.toml

clawde version
  → semver + git sha + claude CLI version + build date

clawde --help [<command>]
```

### 6.2 Princípios de UX do CLI

- **Exit codes:** 0 sucesso, 1 erro de uso (input inválido), 2 erro operacional (DB, network),
  3 erro de quota (busy), 4 erro de auth (token), 5 erro fatal.
- **JSON output** em todos os comandos via `--output json` para scripting.
- **Confirmação** em ações destrutivas (`forget`, `migrate down`, `panic-stop` em hosts
  de produção): `--confirm` flag obrigatória.
- **Stdout** = dados; **stderr** = mensagens humanas/progresso. Nunca misturar.
- **Cores** em terminal interativo (TTY), desligadas em pipe.
- **Idempotência:** `panic-stop` chamado 2x = ok; `queue` com `--dedup-key` repetido =
  exit 0 + flag `deduped: true` na resposta.

==================================================================

## 7. Configuração — `clawde.toml`

Arquivo único em `~/.clawde/config/clawde.toml` (override via env `CLAWDE_CONFIG`).
Validado contra zod schema no boot — falha = abort com mensagem clara.

### 7.1 Schema (referência completa)

```toml
# ~/.clawde/config/clawde.toml

[clawde]
home = "~/.clawde"                # base dir
log_level = "INFO"                # TRACE|DEBUG|INFO|WARN|ERROR|FATAL
trace_id_format = "ulid"          # ulid | uuid

[worker]
max_parallel = 1                  # workers simultâneos no host
cli_path = "/usr/local/bin/claude"
cli_min_version = "2.0.0"
default_max_turns = 15
default_timeout_seconds = 1800
lease_seconds = 600               # tempo antes de considerar abandoned
heartbeat_seconds = 60            # update lease_until enquanto running

[receiver]
listen_tcp = "127.0.0.1:18790"
listen_unix = "/run/clawde/receiver.sock"
unix_socket_mode = "0660"
unix_socket_group = "clawde"

[receiver.rate_limit]
per_ip_per_minute = 10
per_ip_per_hour = 100
health_per_minute = 60

[quota]
plan = "max5x"                    # pro | max5x | max20x
window_hours = 5
reserve_urgent_pct = 15
peak_hours_tz = "America/Los_Angeles"
peak_start_local = "05:00"
peak_end_local = "11:00"
peak_multiplier = 1.7

[quota.thresholds]
aviso = 60                        # %
restrito = 80
critico = 95

[sandbox]
default_level = 1
bwrap_path = "/usr/bin/bwrap"
allow_levels_per_agent = true     # AGENT.md pode declarar level
egress_allowlist_path = "~/.clawde/config/egress_allowlist.txt"

[memory]
backend = "native"                # native | claude-mem-deprecated
jsonl_root = "~/.claude/projects"
indexer_interval_minutes = 10
embeddings_enabled = false        # opt-in
embeddings_model = "Xenova/all-MiniLM-L6-v2"

[auth]
oauth_token_source = "systemd-credential"   # systemd-credential | keychain | env
oauth_token_credential = "clawde-oauth"
oauth_expiry_warn_days = 30
oauth_auto_refresh = true

[telegram]
enabled = false
bot_token_source = "systemd-credential"
bot_token_credential = "telegram-bot-token"
secret_token_credential = "telegram-secret"
allowed_user_ids = []             # array vazia = ninguém

[github]
enabled = false
hmac_secret_credential = "github-hmac-secret"
repos_allowlist = []

[backup]
enabled = true
hourly_keep = 24
daily_keep = 7
weekly_keep = 4
monthly_keep = 12
remote = "b2://clawde-backup"     # vazio = só local
remote_credential = "rclone-config"

[alerts]
config_path = "~/.clawde/config/alerts.toml"
default_channel = "telegram"      # telegram | email | none
cooldown_seconds = 3600

[observability]
datasette_enabled = true
datasette_listen = "127.0.0.1:8001"
datasette_readonly = true
```

### 7.2 `alerts.toml` (referência)

```toml
[channels.telegram]
enabled = true
chat_id_credential = "telegram-alert-chat"

[channels.email]
enabled = false
smtp_host = ""
smtp_credential = ""

[triggers]
fatal_log              = { severity = "critical", channels = ["telegram", "email"] }
smoke_test_failed      = { severity = "high",     channels = ["telegram"] }
quota_above_95         = { severity = "high",     channels = ["telegram"] }
oauth_expires_30d      = { severity = "medium",   channels = ["email"] }
migration_failed       = { severity = "critical", channels = ["telegram", "email"] }
sandbox_violation      = { severity = "high",     channels = ["telegram"] }
backup_missed          = { severity = "medium",   channels = ["email"] }
task_fail_rate_high    = { severity = "medium",   channels = ["email"], threshold_pct_per_hour = 10 }
```

### 7.3 Precedência

1. Flag de CLI (`--config <path>` ou `--log-level DEBUG`).
2. Variável de ambiente (`CLAWDE_LOG_LEVEL`, `CLAWDE_CONFIG`).
3. Arquivo TOML.
4. Defaults em `src/config/defaults.ts`.

Inferior é sobrescrito por superior. `clawde config show` mostra resolved.

### 7.4 Reload

- `clawde-receiver`: `systemctl reload clawde-receiver` envia SIGHUP, releitura sem
  restart. Fila pendente preservada.
- `clawde-worker`: nenhum reload (oneshot — próxima invocação relê automático).
- Mudanças em `[sandbox]` exigem regenerar systemd units → `clawde sandbox apply` +
  `systemctl daemon-reload`.

==================================================================

## Apêndice — Definição-de-pronto do Blueprint

Este blueprint está "pronto" quando:
- [ ] Tipos de §2 compilam em isolamento (`tsc --noEmit`).
- [ ] Schema OpenAPI de §3.1 valida em editor OpenAPI sem erros.
- [ ] Lista de hooks/payloads de §4 está consistente com `@anthropic-ai/claude-agent-sdk`
      (verificar versão atual antes de implementar).
- [ ] Toda decisão técnica em §1–§7 tem ADR correspondente em `docs/adr/` (próximo
      entregável).
- [ ] Toda regra do BEST_PRACTICES.md tem implementação rastreável a este blueprint.
