let pipeline: any = null
let embedder: any = null

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2"

async function getEmbedder() {
  if (embedder) return embedder

  // Dynamic import - @xenova/transformers is ESM
  const { pipeline: createPipeline } = await import("@xenova/transformers")
  pipeline = createPipeline
  embedder = await pipeline("feature-extraction", MODEL_NAME)
  return embedder
}

/**
 * Generate an embedding vector for a text string.
 * Uses all-MiniLM-L6-v2 (384-dim, ~23MB, runs on CPU).
 * The model is lazy-loaded on first call and cached.
 */
export async function embed(text: string): Promise<Float32Array> {
  const extractor = await getEmbedder()
  const output = await extractor(text, { pooling: "mean", normalize: true })
  return new Float32Array(output.data)
}

/**
 * Compute cosine similarity between two vectors.
 * Both vectors must be normalized (which all-MiniLM-L6-v2 produces by default).
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
  }
  return dot
}
