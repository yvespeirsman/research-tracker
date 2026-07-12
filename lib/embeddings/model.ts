import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'

/**
 * The library's default cache directory lives inside node_modules, which is
 * part of the deployed bundle and read-only at runtime on Vercel — the first
 * call would fail trying to mkdir it to download and cache the model.
 * `os.tmpdir()` is the one writable path in a serverless function (and just
 * the regular OS temp dir locally), so redirect the cache there.
 */
env.cacheDir = join(tmpdir(), 'transformers-cache')

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
