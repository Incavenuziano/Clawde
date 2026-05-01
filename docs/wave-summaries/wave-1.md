# Wave 1 Audit — Boot (P0.1, P0.2, P0.3)

**Status**: ✅ Closed (2026-04-29)  
**Reviewer**: Codex  
**Sub-fases**: P0.1, P0.2, P0.3 (3/3 merged) + followup de dependência cruzada (T-008, PR #9)

## PRs

| Sub-fase | PR | Merge commit | LOC | Tasks |
|----------|----|----|----|-------|
| P0.1 | [#2](https://github.com/Incavenuziano/Clawde/pull/2) | `0982850` | +322 / -17 | T-001..T-013 (exceto T-008 bloqueada) |
| P0.2 | [#3](https://github.com/Incavenuziano/Clawde/pull/3) | `6eea826` | +296 / -16 | T-014..T-018 |
| P0.3 | [#1](https://github.com/Incavenuziano/Clawde/pull/1) | `5880af9` | +57 / -4 | T-019 |
| Followup P0.1 | [#9](https://github.com/Incavenuziano/Clawde/pull/9) | `a7b2c4b` | +183 / -12 | T-008 |
| **Total** | 4 | — | **+858 / -49** | **19 tasks** |

## Métricas

- Test baseline ao fim da Wave 1: **569 testes** (registrado como baseline da Wave 2).
- Arquivos alterados (soma por PR): 29.
- Novos artefatos operacionais:
  - entrypoints `src/receiver/main.ts` e `src/worker/main.ts`;
  - unidade systemd de trigger (`.path`) e fallback explícito por evento;
  - expansão de schema de config para `telegram/review/replica`.

## Decisões Notáveis

### P0.1 — Boot explícito e build alinhado

A fase estabeleceu os entrypoints reais de receiver/worker e alinhou scripts de build/deploy para runtime consistente. O followup T-008 (PR #9) completou o comportamento de loop de worker com:
- `--max-tasks`;
- parada no primeiro `defer` para evitar consumo indevido/cascata no mesmo ciclo.

### P0.2 — Trigger event-driven com fallback resiliente

O desenho final mantém o trigger primário (`systemctl start clawde-worker.path`) desacoplado do fallback de signal file. O write do signal file foi isolado para não abortar o primário em falhas de IO/permissão (`EACCES`, disco cheio etc.).

### P0.3 — Schema de config compatível com seções opcionais

Foram adicionados `TelegramConfigSchema`, `ReviewConfigSchema` e `ReplicaConfigSchema`, mantendo as seções opcionais no schema raiz e preservando compatibilidade com `config/clawde.toml.example`.

## Critérios de Validação

### Cobertura de requisitos da Wave

- **P0.1**: entrypoints + wiring inicial + build/deploy base ✅
- **P0.2**: trigger por evento + fallback explícito e resiliente ✅
- **P0.3**: schema expandido com validação de tipos por subseção ✅
- **T-008** (dependência cruzada): quota gate/loop behavior finalizado no followup PR #9 ✅

### Estabilidade

- Aprovações registradas com CI limpa para os PRs da wave (com 1 flaky histórico já conhecido em rodadas específicas, sem regressão estrutural atribuída à Wave 1).

## Resultado

**Wave 1 fechada.**  
O projeto saiu de baseline de scaffolding para um boot operacional com:
- processos e entrypoints executáveis;
- trigger de worker orientado a evento (com fallback seguro);
- configuração tipada pronta para os blocos de integração (`telegram/review/replica`);
- comportamento de loop do worker ajustado para produção inicial (`--max-tasks` + break-on-defer).
