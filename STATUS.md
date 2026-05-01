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
| 1 — Boot | 0 | 0 | 0 | 18 | 1 | 19 |
| 2 — Operação | 17 | 4 | 0 | 0 | 0 | 21 |
| 3 — Segurança core | 38 | 0 | 0 | 0 | 0 | 38 |
| 4 — Hardening | 22 | 0 | 0 | 0 | 0 | 22 |
| 5 — Alinhamento | 24 | 0 | 0 | 0 | 0 | 24 |
| 6 — Hardening operacional | 19 | 0 | 0 | 0 | 0 | 19 |
| **Total** | **120** | **4** | **0** | **18** | **1** | **143** |

---

## Branches

Estratégia: **1 branch por sub-fase** (~22 branches no total). Cada branch
agrupa tasks relacionadas em commits atômicos (1 commit por T-NNN), com
1 PR único por sub-fase. Detalhes em [docs/REVIEW_PROTOCOL.md](docs/REVIEW_PROTOCOL.md).

| Sub-fase | Branch | Tasks | Implementer | Reviewer | Estado | PR |
|----------|--------|-------|-------------|----------|--------|----|
| P0.1 | `task/P0.1-entrypoints` | T-001..T-013 | claude | codex | merged, PR #2, 2026-04-29 | #2 |
| P0.2 | `task/P0.2-trigger` | T-014..T-018 | codex | claude | merged, PR #3, 2026-04-29 | #3 |
| P0.3 | `task/P0.3-config-schema` | T-019 | codex | claude | merged, PR #1, 2026-04-29 | #1 |
| P1.1 | `task/P1.1-dequeue-retry` | T-020..T-023 | codex | claude | merged, PR #4, 2026-04-29 | #4 |
| P1.2 | `task/P1.2-quota-not-before` | T-024..T-033 | codex | claude | merged, PR #5, 2026-04-29 | #5 |
| P1.3 | `task/P1.3-sdk-errors` | T-034..T-040 | codex | claude | merged, PR #6, 2026-04-29 | #6 |
| P2.1 | `task/P2.1-workspace-plug` | T-041..T-046 | codex | claude | merged, PR #7, 2026-04-29 | #7 |
| P2.2 | `task/P2.2-sandbox-tools` | T-047..T-053 | codex | code | merged, PR #10, 2026-04-30 | #10 |
| P2.3 | `task/P2.3-external-input` | T-054..T-057 | claude | codex | merged, PR #15, 2026-04-30 | #15 |
| P2.4 | `task/P2.4-review-fresh` | T-058..T-062 | claude | codex | merged, PR #16, 2026-04-30 | #16 |
| P2.5a | `task/P2.5a-agent-loader` | T-063..T-068, T-077, T-078 | codex | claude | merged, PR #11, 2026-04-30 | #11 |
| P2.5b | `task/P2.5b-agent-files` | T-069..T-076 | codex | claude (+ operador em T-075/076) | merged, PR #12, 2026-04-30 | #12 |
| P1.4 | `task/P1.4-event-kind` | T-079..T-085 | codex | claude | merged, PR #17, 2026-04-30 | #17 |
| P1.5 | `task/P1.5-json-validity` | T-086..T-091 | codex | claude | merged, PR #19, 2026-04-30 | #19 |
| P2.6 | `task/P2.6-allowlist-fail` | T-092..T-096 | codex | claude (+ operador) | merged, PR #21, 2026-04-30 | #21 |
| P2.7 | `task/P2.7-redact-events` | T-097..T-100 | codex | claude (+ operador) | merged, PR #22, 2026-04-30 | #22 |
| P3.1 | `task/P3.1-readme-status` | T-101..T-103 | claude | codex | merged, PR #18, 2026-04-30 | #18 |
| P3.2 | `task/P3.2-cli-ops` | T-104a/b/c, T-105..T-111 | claude | codex | merged, PR #25, 2026-04-30 | #25 |
| P3.4 | `task/P3.4-reflect-job` | T-112..T-115 | claude | codex | merged, PR #20, 2026-04-30 | #20 |
| P3.5 | `task/P3.5-smoke-service` | T-116..T-121 | codex | claude | merged, PR #24, 2026-04-30 | #24 |
| P3.6 | `task/P3.6-sdk-real-ci` | T-122..T-124 | codex | claude | merged, PR #26, 2026-05-01 | #26 |
| P6.1 | `task/P6.1-ci-security-gates` | T-125..T-127 | codex | claude (+ operador em T-125) | merged, PR #29, 2026-05-01 | #29 |
| P6.2 | `task/P6.2-db-integrity` | T-128..T-130 | codex | claude | merged, PR #30, 2026-05-01 | #30 |
| P6.3 | `task/P6.3-events-retention` | T-131..T-133 | codex | claude (+ operador em T-132) | merged, PR #31, 2026-05-01 | #31 |
| P6.4 | `task/P6.4-alerts-system` | T-134..T-137 | codex | claude | in-review, codex | — |
| P6.5 | `task/P6.5-backup-cadence` | T-138..T-140 | codex | claude | pending | — |
| P6.6 | `task/P6.6-restore-drill` | T-141..T-143 | codex | claude | pending | — |

**Cross-wave dependencies**:
- T-008 do P0.1 foi desbloqueado após merge de P1.2 (T-029) e concluído no followup PR #9 (2026-04-29).
- Wave 3 followups concluídos:
  - PR #13 (`task/wave3-followup-bash-level`) merged, 2026-04-30.
  - PR #14 (`task/wave3-followup-read-allowlist`) merged, 2026-04-30.

**Estados de branch**: `pending` | `in-progress, <quem>` | `in-review, PR #N` | `merged, PR #N, YYYY-MM-DD` | `blocked, after P-X.Y`

---

## Wave 1 — Boot (P0)

### P0.1 — Entrypoints e build alignment
- [x] T-001 — merged, PR #2, 2026-04-29
- [x] T-002 — merged, PR #2, 2026-04-29
- [x] T-003 — merged, PR #3, 2026-04-29 — telegram route wired in receiver/main.ts via P0.2
- [x] T-004 — merged, PR #2, 2026-04-29
- [x] T-005 — merged, PR #2, 2026-04-29
- [x] T-006 — merged, PR #2, 2026-04-29
- [x] T-007 — merged, PR #2, 2026-04-29
- [x] T-008 — merged, PR #9, 2026-04-29 — followup task/P0.1-followup-quota-gate
- [x] T-009 — merged, PR #2, 2026-04-29
- [x] T-010 — merged, PR #2, 2026-04-29
- [x] T-011 — merged, PR #2, 2026-04-29
- [x] T-012 — merged, PR #2, 2026-04-29
- [x] T-013 — merged, PR #2, 2026-04-29

### P0.2 — Trigger event-driven
- [x] T-014 — merged, PR #3, 2026-04-29
- [x] T-015 — merged, PR #3, 2026-04-29
- [x] T-016 — merged, PR #3, 2026-04-29
- [x] T-017 — merged, PR #3, 2026-04-29
- [x] T-018 — merged, PR #3, 2026-04-29

### P0.3 — Schema config
- [x] T-019 — merged, PR #1, 2026-04-29

---

## Wave 2 — Operação consistente (P1.1, P1.2, P1.3)

### P1.1 — findPending considera retries
- [x] T-020 — merged, PR #4, 2026-04-29
- [x] T-021 — merged, PR #4, 2026-04-29
- [x] T-022 — merged, PR #4, 2026-04-29
- [x] T-023 — merged, PR #4, 2026-04-29

### P1.2 — Quota policy com not_before
- [x] T-024 — merged, PR #5, 2026-04-29
- [x] T-025 — merged, PR #5, 2026-04-29
- [x] T-026 — merged, PR #5, 2026-04-29
- [x] T-027 — merged, PR #5, 2026-04-29
- [x] T-028 — merged, PR #5, 2026-04-29
- [x] T-029 — merged, PR #5, 2026-04-29
- [x] T-030 — merged, PR #5, 2026-04-29
- [x] T-031 — merged, PR #5, 2026-04-29
- [x] T-032 — merged, PR #5, 2026-04-29
- [x] T-033 — merged, PR #5, 2026-04-29

### P1.3 — SDK error tipados
- [x] T-034 — merged, PR #6, 2026-04-29
- [x] T-035 — merged, PR #6, 2026-04-29
- [x] T-036 — merged, PR #6, 2026-04-29
- [x] T-037 — merged, PR #6, 2026-04-29
- [x] T-038 — merged, PR #6, 2026-04-29
- [x] T-039 — merged, PR #6, 2026-04-29
- [x] T-040 — merged, PR #6, 2026-04-29

---

## Wave 3 — Segurança core (P2.1 → P2.5)

### P2.1 — Workspace ephemeral plug
- [x] T-041 — merged, PR #7, 2026-04-29
- [x] T-042 — merged, PR #7, 2026-04-29
- [x] T-043 — merged, PR #7, 2026-04-29
- [x] T-044 — merged, PR #7, 2026-04-29
- [x] T-045 — merged, PR #7, 2026-04-29
- [x] T-046 — merged, PR #7, 2026-04-29

### P2.2 — Sandbox em tools/hooks
- [x] T-047 — merged, PR #10, 2026-04-30
- [x] T-048 — merged, PR #10, 2026-04-30
- [x] T-049 — merged, PR #10, 2026-04-30
- [x] T-050 — merged, PR #10, 2026-04-30
- [x] T-051 — merged, PR #10, 2026-04-30
- [x] T-052 — merged, PR #10, 2026-04-30
- [x] T-053 — merged, PR #10, 2026-04-30

### P2.3 — EXTERNAL_INPUT_SYSTEM_PROMPT injection
- [x] T-054 — merged, PR #15, 2026-04-30
- [x] T-055 — merged, PR #15, 2026-04-30
- [x] T-056 — merged, PR #15, 2026-04-30
- [x] T-057 — merged, PR #15, 2026-04-30

### P2.4 — Review fresh context
- [x] T-058 — merged, PR #16, 2026-04-30
- [x] T-059 — merged, PR #16, 2026-04-30
- [x] T-060 — merged, PR #16, 2026-04-30
- [x] T-061 — merged, PR #16, 2026-04-30
- [x] T-062 — merged, PR #16, 2026-04-30

### P2.5 — AGENT.md loader + criação de agentes
- [x] T-063 — merged, PR #11, 2026-04-30
- [x] T-064 — merged, PR #11, 2026-04-30
- [x] T-065 — merged, PR #11, 2026-04-30
- [x] T-066 — merged, PR #11, 2026-04-30
- [x] T-067 — merged, PR #11, 2026-04-30
- [x] T-068 — merged, PR #11, 2026-04-30
- [x] T-069 — merged, PR #12, 2026-04-30
- [x] T-070 — merged, PR #12, 2026-04-30
- [x] T-071 — merged, PR #12, 2026-04-30
- [x] T-072 — merged, PR #12, 2026-04-30
- [x] T-073 — merged, PR #12, 2026-04-30
- [x] T-074 — merged, PR #12, 2026-04-30
- [x] T-075 — merged, PR #12, 2026-04-30 (security, dupla review)
- [x] T-076 — merged, PR #12, 2026-04-30 (security, dupla review)
- [x] T-077 — merged, PR #11, 2026-04-30
- [x] T-078 — merged, PR #11, 2026-04-30

---

## Wave 4 — Hardening (P1.4, P1.5, P2.6, P2.7)

### P1.4 — EventKind CHECK constraint
- [x] T-079 — merged, PR #17, 2026-04-30
- [x] T-080 — merged, PR #17, 2026-04-30
- [x] T-081 — merged, PR #17, 2026-04-30
- [x] T-082 — merged, PR #17, 2026-04-30
- [x] T-083 — merged, PR #17, 2026-04-30
- [x] T-084 — merged, PR #17, 2026-04-30
- [x] T-085 — merged, PR #17, 2026-04-30

### P1.5 — JSON validity em colunas TEXT
- [x] T-086 — merged, PR #19, 2026-04-30
- [x] T-087 — merged, PR #19, 2026-04-30
- [x] T-088 — merged, PR #19, 2026-04-30
- [x] T-089 — merged, PR #19, 2026-04-30
- [x] T-090 — merged, PR #19, 2026-04-30
- [x] T-091 — merged, PR #19, 2026-04-30

### P2.6 — Allowlist falsa
- [x] T-092 — merged, PR #21, 2026-04-30
- [x] T-093 — merged, PR #21, 2026-04-30
- [x] T-094 — merged, PR #21, 2026-04-30
- [x] T-095 — merged, PR #21, 2026-04-30
- [x] T-096 — merged, PR #21, 2026-04-30

### P2.7 — Redact em events
- [x] T-097 — merged, PR #22, 2026-04-30
- [x] T-098 — merged, PR #22, 2026-04-30
- [x] T-099 — merged, PR #22, 2026-04-30
- [x] T-100 — merged, PR #22, 2026-04-30

---

## Wave 5 — Alinhamento (P3.1, P3.2, P3.4, P3.5, P3.6)

### P3.1 — README/status
- [x] T-101 — merged, PR #18, 2026-04-30
- [x] T-102 — merged, PR #18, 2026-04-30
- [x] T-103 — merged, PR #18, 2026-04-30

### P3.2 — CLI commands operacionais
- [x] T-104a — merged, PR #25, 2026-04-30 — panic lock helpers
- [x] T-104b — merged, PR #25, 2026-04-30 — SystemdController
- [x] T-104c — merged, PR #25, 2026-04-30 — clawde panic-stop
- [x] T-105 — merged, PR #25, 2026-04-30 — clawde panic-resume
- [x] T-106 — merged, PR #25, 2026-04-30 — clawde diagnose
- [x] T-107 — merged, PR #25, 2026-04-30 — clawde sessions list
- [x] T-108 — merged, PR #25, 2026-04-30 — clawde sessions show
- [x] T-109 — merged, PR #25, 2026-04-30 — clawde config show
- [x] T-110 — merged, PR #25, 2026-04-30 — clawde config validate
- [x] T-111 — merged, PR #25, 2026-04-30 — cut forget+audit de RF-12

### P3.4 — Reflect job estruturado
- [x] T-112 — merged, PR #20, 2026-04-30
- [x] T-113 — merged, PR #20, 2026-04-30
- [x] T-114 — merged, PR #20, 2026-04-30
- [x] T-115 — merged, PR #20, 2026-04-30

### P3.5 — Smoke service alinhado
- [x] T-116 — merged, PR #24, 2026-04-30
- [x] T-117 — merged, PR #24, 2026-04-30
- [x] T-118 — merged, PR #24, 2026-04-30
- [x] T-119 — merged, PR #24, 2026-04-30
- [x] T-120 — merged, PR #24, 2026-04-30
- [x] T-121 — merged, PR #24, 2026-04-30

### P3.6 — SDK real validation
- [x] T-122 — merged, PR #26, 2026-05-01
- [x] T-123 — merged, PR #26, 2026-05-01
- [x] T-124 — merged, PR #26, 2026-05-01

---

## Wave 6 — Hardening operacional (gaps do BEST_PRACTICES)

### P6.1 — CI security gates
- [x] T-125 — merged, PR #29, 2026-05-01 — gitleaks (security)
- [x] T-126 — merged, PR #29, 2026-05-01 — bun audit
- [x] T-127 — merged, PR #29, 2026-05-01 — coverage gate

### P6.2 — DB integrity automation
- [x] T-128 — merged, PR #30, 2026-05-01
- [x] T-129 — merged, PR #30, 2026-05-01
- [x] T-130 — merged, PR #30, 2026-05-01

### P6.3 — Events retention
- [x] T-131 — merged, PR #31, 2026-05-01
- [x] T-132 — merged, PR #31, 2026-05-01 — purge (security)
- [x] T-133 — merged, PR #31, 2026-05-01

### P6.4 — Alerts system
- [x] T-134 — in-review, codex
- [x] T-135 — in-review, codex
- [x] T-136 — in-review, codex
- [x] T-137 — in-review, codex

### P6.5 — Backup cadenciado
- [ ] T-138 — pending
- [ ] T-139 — pending
- [ ] T-140 — pending

### P6.6 — Restore drill
- [ ] T-141 — pending
- [ ] T-142 — pending
- [ ] T-143 — pending

---

## Wave reviews

Quando todas as tasks de uma wave estiverem `merged`, reviewer da wave (alternar
Claude/Codex — Codex revisa Wave 1, Claude revisa Wave 2, ...) faz audit final
e produz `docs/wave-summaries/wave-N.md`.

- [x] Wave 1 audit — done (reviewer: codex, docs/wave-summaries/wave-1.md, PR #27, 2026-05-01)
- [x] Wave 2 audit — done (reviewer: claude, docs/wave-summaries/wave-2.md)
- [x] Wave 3 audit — done (reviewer: codex, docs/wave-summaries/wave-3.md, PR #28, 2026-05-01)
- [x] Wave 4 audit — done (reviewer: claude, docs/wave-summaries/wave-4.md, PR #23, 2026-04-30)
- [x] Wave 5 audit — done (reviewer: codex, docs/wave-summaries/wave-5.md, PR #28, 2026-05-01)
- [ ] Wave 6 audit — pending (reviewer: claude)

---

*Última atualização: 2026-05-01.*
