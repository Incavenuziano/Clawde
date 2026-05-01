# Wave 5 Audit — Alinhamento (P3.1, P3.2, P3.4, P3.5, P3.6)

**Status**: ✅ Closed (2026-05-01)  
**Reviewer**: Codex  
**Sub-fases**: P3.1, P3.2, P3.4, P3.5, P3.6 (5/5 merged)

## PRs

| Sub-fase | PR | Merge commit | LOC | Tasks |
|----------|----|----|----|-------|
| P3.1 | [#18](https://github.com/Incavenuziano/Clawde/pull/18) | `7c4daa9` | +63 / -16 | T-101..T-103 |
| P3.2 | [#25](https://github.com/Incavenuziano/Clawde/pull/25) | `a127e44` | +2067 / -23 | T-104a/b/c, T-105..T-111 |
| P3.4 | [#20](https://github.com/Incavenuziano/Clawde/pull/20) | `8ed0371` | +475 / -7 | T-112..T-115 |
| P3.5 | [#24](https://github.com/Incavenuziano/Clawde/pull/24) | `a64d3e8` | +505 / -12 | T-116..T-121 |
| P3.6 | [#26](https://github.com/Incavenuziano/Clawde/pull/26) | `e0063ea` | +93 / -5 | T-122..T-124 |
| **Total** | 5 | — | **+3203 / -63** | **26 tasks** |

## Métricas

- Test count: **640** (fim da Wave 4) → **690** (fim da Wave 5), **+50**.
- Arquivos alterados (soma por PR): 40.
- Novos blocos operacionais:
  - CLI de operação (`diagnose`, `panic-stop`, `panic-resume`, `sessions`, `config`);
  - job de reflexão estruturada (`reflect`) e serviço systemd dedicado;
  - smoke-test com checks de worker/sandbox/SDK e integração em serviço;
  - suíte real-SDK opcional em CI com guards de credencial.

## Decisões notáveis

### P3.2 — CLI operacional completa e testável

A wave ganhou comandos de operação e diagnóstico com desenho testável (controller injetável para systemd e lock de pânico idempotente no stop), além de `config show` com origem por campo (`env > toml > default`), reduzindo ambiguidade de troubleshooting.

### P3.4 — Reflector como fluxo estruturado, não prompt ad hoc

O `reflect` passou a montar prompt determinístico com janela de eventos/observações e enfileirar via receiver com dedup, preservando trilha operacional.

### P3.5 — Smoke alinhado ao runtime real, sem acoplamento indevido a config global

O blocker de regressão E2E foi corrigido: checks que dependiam implicitamente de `HOME`/TOML global passaram a derivar contexto por `dbPath` e ambiente de smoke controlado, restaurando o contrato dos testes de ciclo de vida.

### P3.6 — Real SDK validado sem quebrar runs padrão

Foram adicionados testes reais condicionais (`CLAWDE_TEST_REAL_SDK=1` + token) e workflow dedicado, mantendo o comportamento default estável (skips esperados quando credenciais não existem).

## Critérios de validação

- PRs da wave com revisão cruzada conforme alternância Claude/Codex.
- CI limpa reportada nos merges da wave:
  - P3.2: 685/0 (com flaky histórico oscilando em rodada anterior);
  - P3.6: 690/0 com 2 skips esperados (real-SDK gated).
- Regressão E2E de smoke (introduzida em P3.5 inicial) resolvida antes do merge final.

## Followups abertos

- Documentar de forma explícita a convenção de `CLAWDE_CONFIG=\"\"` usada em ambiente de smoke.
- Endurecer comportamento do workflow real-SDK em forks sem secret (pular explicitamente vs falhar).
- Continuar monitorando o flaky histórico de lease expiry até estabilização completa.

## Resultado

**Wave 5 fechada.**  
A camada operacional ficou significativamente mais madura: comandos de resposta a incidente, diagnóstico e inspeção; rotina de reflexão automatizada; smoke service mais fiel ao runtime; e validação real de SDK no pipeline controlado por credenciais.
