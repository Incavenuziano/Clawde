# ADR 0003 — Memória nativa em vez de claude-mem como dependência

- **Status:** Accepted
- **Date:** 2026-04-29
- **Decisores:** @Incavenuziano

## Contexto

A v3 do `ARCHITECTURE.md` listava `claude-mem` (Incavenuziano) como **dependência** do
Clawde para memória persistente, posicionado como "FTS5 + Chroma".

Validação contra o código real revelou:
- `claude-mem` usa **Chroma via MCP stdio** como busca primária; FTS5 está em backward-compat
  só (comentário no `SessionSearch.ts`: "TODO remove v7.0").
- Stack: TS/Bun + SQLite + **Chroma + MCP server + uvx** — overhead pesado pra worker oneshot
  (cold start de ~3s adicionais com MCP).
- O próprio `BEST_PRACTICES.md` §10.2 alerta para 3rd-party como ponto de falha — incoerente
  ter `claude-mem` como pilar.
- Claude Code já persiste tudo em JSONL append-only em `~/.claude/projects/<hash>/*.jsonl`
  — base de dados pronta sem novo serviço.

## Decisão

**Não** usar `claude-mem` como dependência. Em vez disso:

1. **Indexação nativa dos JSONL** — job systemd timer (10min) parseia
   `~/.claude/projects/*.jsonl` e popula `memory_observations` + `memory_fts` (FTS5
   trigram tokenizer) no `state.db`.
2. **Hooks Claude Code inline** (`PostToolUse`, `Stop`) escrevem observations estruturadas
   diretamente no SQLite durante execução.
3. **Embeddings opcionais** via `@xenova/transformers` (WASM, sem Python) gravados em
   `memory_observations.embedding BLOB`, busca cosine via `sqlite-vec`.

**Reuso de código** do `claude-mem` (não como dependência runtime):
- Schema `observations`/`summaries` (`src/services/sqlite/migrations/`).
- Parser do SDK (`src/sdk/parser.ts` → `ParsedObservation`/`ParsedSummary`).
- Padrão de migrations versionadas.

## Consequências

**Positivas**
- Zero dependência externa de runtime (sem Chroma, MCP, uvx).
- Worker oneshot mantém cold start ~2-3s (vs ~5-6s com MCP).
- `state.db` único = backup unificado, sem coordenar múltiplas DBs.
- FTS5 trigram funciona multi-idioma (pt, en) sem config extra.
- Embeddings são **opt-in** — se não precisar, não paga o custo de WASM model (~25MB).

**Negativas**
- Reimplementa funcionalidade que `claude-mem` já tem pronta.
- Sem busca semântica out-of-the-box (precisa habilitar embeddings explicitamente).
- Manter parity com formato JSONL nativo (que pode mudar entre versões do CLI) é
  trabalho recorrente. Mitigação: smoke test diário valida parser (§5.5 BEST_PRACTICES).

**Neutras**
- Decisão é reversível: se demanda crescer (busca semântica complexa, milhares de sessões),
  pode-se voltar a integrar `claude-mem` ou outro vetor DB.

## Alternativas consideradas

- **`claude-mem` como dependência runtime** — descartada pelo overhead MCP+Chroma+uvx.
- **Embeddings sempre ligados** — descartado, é overkill pra perfil low-volume.
- **Apenas FTS5 sem embeddings nem mesmo opcional** — descartado, deixa porta aberta sem custo.

## Referências

- `ARCHITECTURE.md` §11.5 (memória nativa), §4.3 (reuso de claude-mem).
- `BLUEPRINT.md` §1 (`src/memory/`) e §2.5 (`MemoryObservation`).
- `claude-mem` (`Incavenuziano/claude-mem`) — fonte de padrões a copiar.
- `@xenova/transformers` — https://github.com/xenova/transformers.js
- `sqlite-vec` — https://github.com/asg017/sqlite-vec
