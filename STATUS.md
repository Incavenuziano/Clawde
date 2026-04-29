# Clawde — Status do Backlog de Remediação

> Tracking de execução das 124 tasks em [EXECUTION_BACKLOG.md](EXECUTION_BACKLOG.md).
> Atualizado por quem trabalha em cada task — 1 linha por task.
>
> **Estados**: `pending` | `in-progress` | `in-review` | `merged` | `blocked`
>
> **Formato**: `T-NNN — <state>, <quem> [, PR #N] [, <data ISO>] [— nota]`
>
> Quando `in-progress`/`in-review`, citar quem está executando ou revisando.
> Quando `merged`, registrar PR e data. `blocked` requer nota com a dependência.

## Resumo

| Wave | Pending | In-progress | In-review | Merged | Blocked | Total |
|------|---------|-------------|-----------|--------|---------|-------|
| 1 — Boot | 19 | 0 | 0 | 0 | 0 | 19 |
| 2 — Operação | 21 | 0 | 0 | 0 | 0 | 21 |
| 3 — Segurança core | 38 | 0 | 0 | 0 | 0 | 38 |
| 4 — Hardening | 22 | 0 | 0 | 0 | 0 | 22 |
| 5 — Alinhamento | 24 | 0 | 0 | 0 | 0 | 24 |
| **Total** | **124** | **0** | **0** | **0** | **0** | **124** |

---

## Wave 1 — Boot (P0)

### P0.1 — Entrypoints e build alignment
- [ ] T-001 — pending
- [ ] T-002 — pending
- [ ] T-003 — pending
- [ ] T-004 — pending
- [ ] T-005 — pending
- [ ] T-006 — pending
- [ ] T-007 — pending
- [ ] T-008 — pending — blocked-on T-029
- [ ] T-009 — pending
- [ ] T-010 — pending
- [ ] T-011 — pending
- [ ] T-012 — pending
- [ ] T-013 — pending

### P0.2 — Trigger event-driven
- [ ] T-014 — pending
- [ ] T-015 — pending
- [ ] T-016 — pending
- [ ] T-017 — pending
- [ ] T-018 — pending

### P0.3 — Schema config
- [ ] T-019 — pending

---

## Wave 2 — Operação consistente (P1.1, P1.2, P1.3)

### P1.1 — findPending considera retries
- [ ] T-020 — pending
- [ ] T-021 — pending
- [ ] T-022 — pending
- [ ] T-023 — pending

### P1.2 — Quota policy com not_before
- [ ] T-024 — pending
- [ ] T-025 — pending
- [ ] T-026 — pending
- [ ] T-027 — pending
- [ ] T-028 — pending
- [ ] T-029 — pending
- [ ] T-030 — pending
- [ ] T-031 — pending
- [ ] T-032 — pending
- [ ] T-033 — pending

### P1.3 — SDK error tipados
- [ ] T-034 — pending
- [ ] T-035 — pending
- [ ] T-036 — pending
- [ ] T-037 — pending
- [ ] T-038 — pending
- [ ] T-039 — pending
- [ ] T-040 — pending

---

## Wave 3 — Segurança core (P2.1 → P2.5)

### P2.1 — Workspace ephemeral plug
- [ ] T-041 — pending
- [ ] T-042 — pending
- [ ] T-043 — pending
- [ ] T-044 — pending
- [ ] T-045 — pending
- [ ] T-046 — pending

### P2.2 — Sandbox em tools/hooks
- [ ] T-047 — pending
- [ ] T-048 — pending
- [ ] T-049 — pending
- [ ] T-050 — pending
- [ ] T-051 — pending
- [ ] T-052 — pending
- [ ] T-053 — pending

### P2.3 — EXTERNAL_INPUT_SYSTEM_PROMPT injection
- [ ] T-054 — pending
- [ ] T-055 — pending
- [ ] T-056 — pending
- [ ] T-057 — pending

### P2.4 — Review fresh context
- [ ] T-058 — pending
- [ ] T-059 — pending
- [ ] T-060 — pending
- [ ] T-061 — pending
- [ ] T-062 — pending

### P2.5 — AGENT.md loader + criação de agentes
- [ ] T-063 — pending
- [ ] T-064 — pending
- [ ] T-065 — pending
- [ ] T-066 — pending
- [ ] T-067 — pending
- [ ] T-068 — pending
- [ ] T-069 — pending
- [ ] T-070 — pending
- [ ] T-071 — pending
- [ ] T-072 — pending
- [ ] T-073 — pending
- [ ] T-074 — pending
- [ ] T-075 — pending
- [ ] T-076 — pending
- [ ] T-077 — pending
- [ ] T-078 — pending

---

## Wave 4 — Hardening (P1.4, P1.5, P2.6, P2.7)

### P1.4 — EventKind CHECK constraint
- [ ] T-079 — pending
- [ ] T-080 — pending
- [ ] T-081 — pending
- [ ] T-082 — pending
- [ ] T-083 — pending
- [ ] T-084 — pending
- [ ] T-085 — pending

### P1.5 — JSON validity em colunas TEXT
- [ ] T-086 — pending
- [ ] T-087 — pending
- [ ] T-088 — pending
- [ ] T-089 — pending
- [ ] T-090 — pending
- [ ] T-091 — pending

### P2.6 — Allowlist falsa
- [ ] T-092 — pending
- [ ] T-093 — pending
- [ ] T-094 — pending
- [ ] T-095 — pending
- [ ] T-096 — pending

### P2.7 — Redact em events
- [ ] T-097 — pending
- [ ] T-098 — pending
- [ ] T-099 — pending
- [ ] T-100 — pending

---

## Wave 5 — Alinhamento (P3.1, P3.2, P3.4, P3.5, P3.6)

### P3.1 — README/status
- [ ] T-101 — pending
- [ ] T-102 — pending
- [ ] T-103 — pending

### P3.2 — CLI commands operacionais
- [ ] T-104a — pending — subtask de T-104 (panic-stop core: lock + signal)
- [ ] T-104b — pending — subtask de T-104 (event + audit)
- [ ] T-104c — pending — subtask de T-104 (alerta opcional)
- [ ] T-105 — pending
- [ ] T-106 — pending
- [ ] T-107 — pending
- [ ] T-108 — pending
- [ ] T-109 — pending
- [ ] T-110 — pending
- [ ] T-111 — pending

### P3.4 — Reflect job estruturado
- [ ] T-112 — pending
- [ ] T-113 — pending
- [ ] T-114 — pending
- [ ] T-115 — pending

### P3.5 — Smoke service alinhado
- [ ] T-116 — pending
- [ ] T-117 — pending
- [ ] T-118 — pending
- [ ] T-119 — pending
- [ ] T-120 — pending
- [ ] T-121 — pending

### P3.6 — SDK real validation
- [ ] T-122 — pending
- [ ] T-123 — pending
- [ ] T-124 — pending

---

## Wave reviews

Quando todas as tasks de uma wave estiverem `merged`, reviewer da wave (alternar
Claude/Codex — Codex revisa Wave 1, Claude revisa Wave 2, ...) faz audit final
e produz `docs/wave-summaries/wave-N.md`.

- [ ] Wave 1 audit — pending (reviewer: codex)
- [ ] Wave 2 audit — pending (reviewer: claude)
- [ ] Wave 3 audit — pending (reviewer: codex)
- [ ] Wave 4 audit — pending (reviewer: claude)
- [ ] Wave 5 audit — pending (reviewer: codex)

---

*Última atualização: criação inicial 2026-04-29.*
