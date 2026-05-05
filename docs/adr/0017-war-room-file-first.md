# ADR 0017 — War Room file-first

**Status:** accepted  
**Date:** 2026-05-05

## Context

Clawde precisa de uma camada operacional para organizar incidentes, hardening,
execução automática, evidências, gates e fechamento. Esse estado precisa ser
inspecionável por operador solo, Codex e Claude Code sem exigir dashboard ou
migration prematura.

## Decision

War Room V1 persiste estado em arquivos sob:

```text
~/.clawde/state/war-room/
```

Cada sala tem:

- `room.json`
- `timeline.jsonl`
- `decisions.jsonl`
- `evidence/`
- `plan.json`
- `verification.json`
- `report.md`

O DB principal continua como fonte de tasks/events, mas War Room V1 não adiciona
tabelas novas.

## Consequences

Prós:

- fácil de auditar manualmente;
- baixo risco para `state.db`;
- funciona antes de migrations específicas;
- evidencia arquivos grandes sem inflar SQLite;
- permite recover simples se um JSONL ficar parcialmente escrito.

Contras:

- queries históricas são menos poderosas que SQLite;
- concorrência é simples, adequada para operador single-user;
- integração com `events` pode vir em fase posterior.

## Safety

Ações perigosas são classificadas por lanes:

- `green`: execução direta permitida;
- `yellow`: exige `--confirm`;
- `guarded`: cria gate e para;
- `blocked`: nunca executa automaticamente.

War Room não substitui `STATUS.md`, GitHub issues, GSD ou revisão humana em
mudanças de segurança.
