# ADR 0016 — Política para scrub de events históricos

- **Status:** Accepted
- **Date:** 2026-04-30
- **Decisores:** @Incavenuziano

## Contexto

P2.7 passou a redigir payloads novos em `events` no momento do `INSERT`.
Ainda pode existir histórico antigo com dados sensíveis. O problema: `events` é
append-only por contrato (triggers de imutabilidade e auditoria).

## Decisão

No MVP, não haverá update destrutivo automático em `events`.

1. manter histórico imutável por padrão;
2. oferecer auditoria (lookup/report) para identificar rows potencialmente
   sensíveis;
3. qualquer scrub destrutivo futuro exige comando/manual mode explícito do
   operador e decisão separada.

## Consequências

- preserva o contrato append-only e evita mutação silenciosa de trilha de audit;
- risco residual no legado é tratado operacionalmente (auditoria + decisão humana);
- evita criar ferramenta de “edição retroativa” sem governança.

## Alternativas consideradas

- scrub automático pós-migração: reduz risco de segredo, mas viola append-only;
- sobrescrever rows antigas in-place: simples tecnicamente, frágil em auditoria.
