# ADR 0010 — Embedding strategy: multilingual-e5-small via @xenova (sem API externa)

- **Status:** Accepted
- **Date:** 2026-04-29
- **Decisores:** @Incavenuziano

## Contexto

ADR 0003 mencionou embeddings opcionais via `@xenova/transformers` com modelo
`all-MiniLM-L6-v2` (384 dim, ~25MB WASM). Análise honesta posterior expôs problemas:

- **MiniLM-L6-v2 é treinado majoritariamente em inglês.** Para usuário PT-BR (caso real),
  qualidade de retrieval cai meaningfully.
- Restrição ratificada: **sem API externa paga** (sem OpenAI text-embedding-3, sem Voyage,
  sem Cohere, sem Anthropic-via-aggregator).
- ADR 0003 também impõe: **sem dependência runtime adicional** (sem Ollama daemon, sem
  serviço externo).

Comparação de opções 100% locais sob essas restrições:

| Modelo | Dim | Tamanho | PT-BR | Daemon? | Qualidade |
|--------|-----|---------|-------|---------|-----------|
| `MiniLM-L6-v2` | 384 | ~25MB | ❌ ruim | ❌ in-process WASM | baixa |
| **`multilingual-e5-small`** | 384 | ~120MB | ✅ nativo | ❌ in-process WASM | boa |
| `multilingual-e5-base` | 768 | ~280MB | ✅ nativo | ❌ in-process WASM | melhor |
| `nomic-embed-text` | 768 | ~270MB | EN-tuned | ✅ Ollama | SOTA EN |
| `mxbai-embed-large` | 1024 | ~670MB | parcial | ✅ Ollama | SOTA |
| `bge-m3` | 1024 | ~2.3GB | ✅ + reranker | ✅ Ollama | SOTA multi |

## Decisão

**Modelo padrão:** `Xenova/multilingual-e5-small` (384 dim, ~120MB) via `@xenova/transformers`
(transformers.js, WASM in-process Bun).

**Storage:** `memory_observations.embedding BLOB` (3072 bytes = 384 floats × 4 bytes).
Busca cosine via `sqlite-vec` (extensão SQLite carregada em runtime, sem daemon).

**Política de uso:**
- **Embeddings opt-in** via `memory.embeddings_enabled = true` em `clawde.toml`.
  Padrão: `false` na Fase 5; usuário liga quando memória crescer e FTS5 sozinho ficar fraco.
- Quando ligado, indexer (`clawde-reflect` e batch indexer) gera embedding em INSERT.
- Busca híbrida: FTS5 + cosine, com ranking unificado (RRF — Reciprocal Rank Fusion).
- Score final boost por `importance` (do ADR 0009).

**Upgrade path documentado** (sem mudar arquitetura):
- Trocar pra `Xenova/multilingual-e5-base` (768 dim, ~280MB) editando `memory.embeddings_model`
  + migration que altera schema do BLOB.
- Se demanda crescer pra SOTA: virar Ollama com `mxbai-embed-large` ou `bge-m3` —
  `src/memory/embeddings.ts` ganha backend pluggable.

## Consequências

**Positivas**
- **PT-BR funciona** sem API externa nem daemon.
- WASM in-process Bun: sem IPC, sem coordenação de processo, sem rede.
- Modelo carrega 1x na vida do worker (~120MB RAM extra).
- Alinha com ADR 0003 (sem dep externa de runtime).
- Storage compacto (~3KB por observation).
- `sqlite-vec` é single-file extension, não precisa daemon.

**Negativas**
- Qualidade de embedding < SOTA (nomic, mxbai, bge-m3). Mitigação: aceitável pra
  perfil low-volume + memory-aware prompting reranqueia via importance score.
- Modelo de 120MB pesa no boot do worker oneshot (cold start +500ms). Mitigação:
  pre-load opcional via systemd `clawde-worker-warmup` em hosts always-on.
- WASM CPU-bound (sem GPU). Inference ~50ms por observation; aceitável pra batch
  indexer, não pra real-time de alta carga.
- `sqlite-vec` ainda v0.x, API pode mudar. Mitigação: pin de versão.

**Neutras**
- Nada impede migração futura pra Ollama; arquitetura encapsula no `src/memory/embeddings.ts`.

## Alternativas consideradas

- **Manter `MiniLM-L6-v2`** — descartado (PT-BR ruim).
- **Ollama com `nomic-embed-text` ou `mxbai-embed-large`** — descartado pra v1
  (mata vantagem "stack mínimo" do ADR 0003); fica como upgrade path.
- **Ollama com `bge-m3` (multilingual + reranker)** — mesma razão; é o end-game se
  demanda crescer.
- **API pago (Voyage, OpenAI, Cohere)** — descartado por restrição explícita do usuário.
- **Embeddings desligados sempre** — descartado; perde busca semântica que é base do
  memory-aware prompting de ADR 0009.

## Referências

- ADR 0003 (memória nativa — sem dep externa).
- ADR 0009 (reflection — usa embeddings se ligado).
- `@xenova/transformers` — https://github.com/xenova/transformers.js
- `multilingual-e5-small` model card — https://huggingface.co/intfloat/multilingual-e5-small
- `sqlite-vec` — https://github.com/asg017/sqlite-vec
- Reciprocal Rank Fusion — Cormack et al, 2009.
