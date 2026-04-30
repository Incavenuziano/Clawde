# Architecture Decision Records

Registros das decisões arquiteturais não-triviais do Clawde. Formato baseado em
[MADR](https://adr.github.io/madr/) simplificado.

## Índice

| ADR | Status | Decisão |
|-----|--------|---------|
| [0001](0001-typescript-bun-stack.md) | Accepted | TypeScript + Bun como stack core |
| [0002](0002-split-daemon.md) | Accepted | Split daemon: receiver always-on + worker oneshot |
| [0003](0003-native-memory.md) | Accepted | Memória nativa em vez de claude-mem como dependência |
| [0004](0004-two-stage-review.md) | Accepted | Two-stage review obrigatório via subagents |
| [0005](0005-sandbox-levels.md) | Superseded by 0015 | Sandbox em 3 níveis (systemd / +bwrap / +netns) |
| [0006](0006-proactive-oauth-refresh.md) | Accepted | OAuth refresh proativo (detect 401 + weekly check) |
| [0007](0007-task-runs-separation.md) | Accepted | Separação `tasks` (intenção) vs `task_runs` (tentativa) |
| [0008](0008-agent-sdk-over-subprocess.md) | Accepted | Agent SDK oficial em vez de subprocess do CLI |
| [0009](0009-reflection-and-memory-aware-prompting.md) | Accepted | Reflection layer + memory-aware prompting |
| [0010](0010-embedding-strategy.md) | Accepted | Embedding strategy: multilingual-e5-small via @xenova (sem API externa) |
| [0011](0011-clawde-not-replacement-for-claude-code.md) | Accepted | Clawde não substitui Claude Code (split síncrono/assíncrono) |
| [0012](0012-single-provider-anthropic.md) | Accepted | Single-provider Anthropic + risco aceito |
| [0013](0013-sandbox-bwrap-implementation.md) | Superseded by 0015 | Sandbox Nível 2/3: implementação via bubblewrap |
| [0015](0015-sandbox-tools-not-process.md) | Accepted | Sandbox 2/3 aplicado em tool calls (`Bash`/`Edit`/`Write`) |
| [0016](0016-events-scrub-policy.md) | Accepted | Events legados: auditoria sem scrub destrutivo automático |

## Convenções

- Numeração sequencial, padding 4 dígitos (`0001`, `0002`, ...).
- Status: `Proposed`, `Accepted`, `Deprecated`, `Superseded by NNNN`.
- Decisão **superseded** mantém arquivo, atualiza status. Nunca deletar ADR.
- Cada ADR é imutável após `Accepted`. Mudança = novo ADR que supersede.
- Tamanho-alvo: ≤80 linhas. Se passar, decisão provavelmente é grande demais — quebrar.
