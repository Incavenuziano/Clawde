# Wave 3 Audit — Segurança core (P2.1, P2.2, P2.3, P2.4, P2.5)

**Status**: ✅ Closed (2026-04-30)  
**Reviewer**: Codex  
**Sub-fases**: P2.1, P2.2, P2.3, P2.4, P2.5a, P2.5b (6/6 merged)

## PRs (core da wave)

| Sub-fase | PR | Merge commit | LOC | Tasks |
|----------|----|----|----|-------|
| P2.1 | [#7](https://github.com/Incavenuziano/Clawde/pull/7) | `5dcdd5c` | +350 / -106 | T-041..T-046 |
| P2.2 | [#10](https://github.com/Incavenuziano/Clawde/pull/10) | `5f7e690` | +198 / -18 | T-047..T-053 |
| P2.3 | [#15](https://github.com/Incavenuziano/Clawde/pull/15) | `b5ca098` | +320 / -18 | T-054..T-057 |
| P2.4 | [#16](https://github.com/Incavenuziano/Clawde/pull/16) | `bcc91e3` | +543 / -27 | T-058..T-062 |
| P2.5a | [#11](https://github.com/Incavenuziano/Clawde/pull/11) | `dbf02f7` | +618 / -22 | T-063..T-068, T-077, T-078 |
| P2.5b | [#12](https://github.com/Incavenuziano/Clawde/pull/12) | `028b21d` | +235 / -9 | T-069..T-076 |
| **Total** | 6 | — | **+2264 / -200** | **38 tasks** |

## Followups pós-review da wave

| Followup | PR | Merge commit | LOC | Motivo |
|----------|----|----|----|--------|
| Bash/level alignment | [#13](https://github.com/Incavenuziano/Clawde/pull/13) | `60cfc9c` | +97 / -9 | Resolver mismatch entre perfis e fail-safe de sandbox (`level>=2` sem Bash) |
| Read allowlist | [#14](https://github.com/Incavenuziano/Clawde/pull/14) | `f91b10c` | +144 / -0 | Fechar vetor de exfiltração para agentes com entrada adversarial auto-resposta |
| **Total followups** | 2 | — | **+241 / -9** | hardening pós-review |

## Métricas

- Test count: **586** (fim da Wave 2) → **606** (fim da Wave 3), **+20**.
- Arquivos alterados (soma por PRs core): 58.
- Arquivos alterados (core + followups): 74.
- Novos artefatos centrais:
  - workspace ephemeral + cleanup/reconcile robusto;
  - hooks de sandbox em tool use;
  - injection de contexto externo (guardrails) e review com contexto fresco;
  - loader de agentes via `AGENT.md` + wiring runtime dos gates.

## Decisões notáveis

### P2.1 — Cleanup de workspace garantido por `try/finally`

O bug bloqueante identificado em review foi corrigido para garantir limpeza de worktree em todos os caminhos (sucesso, 429/defer, erro genérico), evitando leak permanente em `/tmp/clawde-<runId>/`.

### P2.2 + P2.5a — Gates de sandbox viraram runtime real

O fluxo saiu de “só em testes” para execução efetiva no runner: `allowedTools`/`disallowedTools`/`maxTurns` mapeados e `makePreToolUseHandler` registrado no loop de stream.

### P2.5b + followups (#13/#14) — Perfil de agentes alinhado ao threat model atual

Após review cruzado, os ajustes pós-wave consolidaram:
- agentes que precisam shell (`implementer`/`verifier`) em `level=1` até existir Estratégia A;
- agentes com input adversarial e auto-resposta (`telegram-bot`, `github-pr-handler`) com `allowed_reads = []` (fail-closed).

## Critérios de validação

- CI verde nos PRs da wave (com o flaky histórico de leases aparecendo de forma intermitente em algumas rodadas, sem regressão estrutural atribuída aos merges da wave).
- Revisão cruzada aplicada em todas as sub-fases (implementação e review alternados entre Claude/Codex).
- Tasks de segurança com aprovação adicional do operador quando aplicável (P2.2, P2.5b e followups de hardening).

## Followups abertos

- Estratégia A (wrapper de subprocesso com isolamento mais forte) para reabilitar `level>=2` com Bash de forma consistente.
- Refinar `allowed_reads` para agentes internos (hoje permissivo por legado em parte dos perfis).
- Cleanup arquitetural menor: remover redundâncias de tipos/arquivos paralelos no stack de agentes.

## Resultado

**Wave 3 fechada.**  
O sistema passou a ter o núcleo de segurança operacional ativo em runtime: workspace efêmero confiável, gates de tools no runner, perfis de agentes carregados de forma tipada e controles pós-review para reduzir exfiltração em fluxos com input adversarial.
