import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'

/** Runs fully locally via ONNX — no API key, no per-call cost. */
export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2'

let extractor: Promise<FeatureExtractionPipeline> | undefined

/** Lazily constructed so importing this module doesn't load the model at build time. */
function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractor) extractor = pipeline('feature-extraction', EMBEDDING_MODEL)
  return extractor
}

/** Embeds a single string. Prefer `embedBatch` when embedding more than one text. */
export async function embedText(text: string): Promise<number[]> {
  const [embedding] = await embedBatch([text])
  return embedding
}

/** Embeds many strings in one forward pass — much cheaper than one call per text. */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []

  const model = await getExtractor()
  const output = await model(texts, { pooling: 'mean', normalize: true })
  const dim = output.dims[output.dims.length - 1]
  const flat = Array.from(output.data as Float32Array)

  const result: number[][] = []
  for (let i = 0; i < texts.length; i++) {
    result.push(flat.slice(i * dim, (i + 1) * dim))
  }
  return result
}

/** Both inputs are L2-normalized (via `normalize: true` above), so the dot product is the cosine similarity. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

/** Per-dimension mean of a set of embeddings — e.g. a centroid for a group of papers. */
export function averageVector(vectors: number[][]): number[] {
  const dim = vectors[0].length
  const sum = new Array(dim).fill(0)
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) sum[i] += v[i]
  }
  return sum.map((s) => s / vectors.length)
}

/**
 * Rescales a vector to unit length. An `averageVector` result isn't
 * normalized like the model's own output, so normalize it before feeding it
 * back into `cosineSimilarity`'s dot-product shortcut.
 */
export function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0))
  return norm === 0 ? v : v.map((x) => x / norm)
}

/**
 * Rescales a cosine similarity into a 0-100 relevance score.
 *
 * MiniLM similarities between a short topic description and a paper abstract
 * cluster in a much narrower band than the 0-1 range suggests: empirically,
 * clearly-unrelated pairs land around 0.1 and clearly-relevant pairs around
 * 0.45+. The bounds below stretch that band across 0-100 so the existing
 * score badge thresholds (>=70 relevant, >=40 borderline) stay meaningful.
 * Tune these bounds if real usage shows scores clustering too tightly.
 */
const SIMILARITY_FLOOR = 0.05
const SIMILARITY_CEILING = 0.55

export function similarityToScore(similarity: number): number {
  const normalized = (similarity - SIMILARITY_FLOOR) / (SIMILARITY_CEILING - SIMILARITY_FLOOR)
  return Math.max(0, Math.min(100, Math.round(normalized * 100)))
}
