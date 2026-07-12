/** Both inputs are L2-normalized (via `normalize: true` in `embedBatch`), so the dot product is the cosine similarity. */
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
