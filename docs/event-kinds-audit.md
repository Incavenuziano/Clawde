# Event Kinds Audit (T-079)

Date: 2026-04-29
Branch: `task/P1.4-event-kind`

## Método

- Busca por emissores reais de evento: `eventsRepo.insert(...)` em `src/`.
- Checagem do union canônico em `src/domain/event.ts` (`EVENT_KIND_VALUES`).

## Kinds emitidos em runtime (grep de callers)

- `enqueue`
- `rate_limit_hit`
- `dedup_skip`
- `auth.telegram_reject`
- `auth.telegram_user_blocked`
- `task_start`
- `task_finish`
- `task_fail`
- `task_deferred`
- `lease_expired`
- `claude_invocation_start`
- `claude_invocation_end`
- `quota_429_observed`
- `sdk_auth_error`
- `review.implementer.end`
- `review.spec.verdict`
- `review.quality.verdict`
- `review.pipeline.complete`
- `review.pipeline.exhausted`
- `agent_invalid`

## Comparação com `EVENT_KIND_VALUES`

Resultado: todos os kinds emitidos acima já existem no union canônico
`EventKind`/`EVENT_KIND_VALUES`.

Observação: o union contém kinds adicionais suportados por contrato de domínio
(por ex. `tool_use`, `tool_result`, `tool_blocked`, `sandbox_*`, `quota_*`,
`hook_*`, `lesson`, `reflection_*`) que podem não ser emitidos por todos os
fluxos no estado atual do código.
