/**
 * F5.T48 — Embedding service.
 *
 * Interface tipada + 3 implementações:
 *   - NoopEmbeddingProvider: vetor zero, padrão; embeddings desligados.
 *   - DeterministicHashProvider: pseudo-vetor por hash; pra testes
 *     determinísticos sem download de modelo (não tem qualidade semântica).
 *   - XenovaEmbeddingProvider: @xenova/transformers lazy-loaded com
 *     multilingual-e5-small (ADR 0010). Baixa ~120MB de model na 1ª chamada.
 *     Opt-in via memory.embeddings_enabled=true.
 *
 * Cache LRU local (cap 1000) evita recomputar embeddings idênticos.
 */

export const EMBEDDING_DIM = 384;

export interface EmbeddingProvider {
  /** Returns embedding vector. Comprimento sempre = EMBEDDING_DIM. */
  embed(text: string): Promise<Float32Array>;
  /** Identifier do modelo (pra log/audit). */
  readonly modelId: string;
}

class LruCache<K, V> {
  private readonly cap: number;
  private readonly map = new Map<K, V>();
  constructor(cap: number) {
    this.cap = cap;
  }
  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.cap) {
      const firstKey = this.map.keys().next().value as K;
      this.map.delete(firstKey);
    }
  }
}

/**
 * Vetor zero. Útil quando embeddings_enabled=false — search híbrida cai pra
 * FTS5 only.
 */
export class NoopEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = "noop";
  async embed(_text: string): Promise<Float32Array> {
    return new Float32Array(EMBEDDING_DIM);
  }
}

/**
 * Pseudo-embedding determinístico por hash. NÃO tem qualidade semântica;
 * é um placeholder pra testes (mesma string → mesmo vetor; strings diferentes
 * → vetores diferentes mas sem relação semântica).
 */
export class DeterministicHashProvider implements EmbeddingProvider {
  readonly modelId = "deterministic-hash";
  async embed(text: string): Promise<Float32Array> {
    const out = new Float32Array(EMBEDDING_DIM);
    let h = 0x811c9dc5; // FNV-1a 32-bit init
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      h ^= h << 13;
      h ^= h >>> 17;
      h ^= h << 5;
      // Map to [-1, 1].
      out[i] = ((h | 0) / 0x80000000) * 0.5;
    }
    // L2-normalize (cosine similarity convencional).
    let sum = 0;
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      const v = out[i] ?? 0;
      sum += v * v;
    }
    const norm = Math.sqrt(sum);
    if (norm > 0) {
      for (let i = 0; i < EMBEDDING_DIM; i++) {
        out[i] = (out[i] ?? 0) / norm;
      }
    }
    return out;
  }
}

/**
 * @xenova/transformers backend. Carrega multilingual-e5-small lazy.
 * NÃO importado no top do arquivo — dynamic import na 1ª chamada de embed().
 * Em ambientes sem internet ou sem o package instalado, o construtor
 * funciona; o erro só aparece em embed().
 */
export class XenovaEmbeddingProvider implements EmbeddingProvider {
  readonly modelId: string;
  private cache = new LruCache<string, Float32Array>(1000);
  // biome-ignore lint/suspicious/noExplicitAny: @xenova ainda em flux
  private pipelinePromise: Promise<any> | null = null;

  constructor(modelId = "Xenova/multilingual-e5-small") {
    this.modelId = modelId;
  }

  // biome-ignore lint/suspicious/noExplicitAny: dynamic import returns any
  private async getPipeline(): Promise<any> {
    if (this.pipelinePromise === null) {
      this.pipelinePromise = (async () => {
        const transformers = await import("@xenova/transformers").catch((err) => {
          throw new Error(
            `@xenova/transformers not available (${(err as Error).message}). ` +
              "Install with: bun add @xenova/transformers",
          );
        });
        // biome-ignore lint/suspicious/noExplicitAny: SDK uses any
        return await (transformers as any).pipeline("feature-extraction", this.modelId, {
          quantized: true,
        });
      })();
    }
    return this.pipelinePromise;
  }

  async embed(text: string): Promise<Float32Array> {
    const cached = this.cache.get(text);
    if (cached !== undefined) return cached;

    const pipeline = await this.getPipeline();
    // E5 models expect "query: <text>" or "passage: <text>" prefix.
    const result = await pipeline(`passage: ${text}`, {
      pooling: "mean",
      normalize: true,
    });
    // result.data é Float32Array de tamanho EMBEDDING_DIM (384).
    const vec = new Float32Array(result.data);
    this.cache.set(text, vec);
    return vec;
  }
}

/**
 * Cosine similarity entre 2 vetores. Assume L2-normalized (norm=1).
 */
export function cosineSim(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return dot;
}

let activeProvider: EmbeddingProvider = new NoopEmbeddingProvider();

export function getEmbeddingProvider(): EmbeddingProvider {
  return activeProvider;
}

export function setEmbeddingProvider(provider: EmbeddingProvider): void {
  activeProvider = provider;
}
