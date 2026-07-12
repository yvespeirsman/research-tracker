import { extractText, getDocumentProxy } from 'unpdf'

const HTML_FETCH_TIMEOUT_MS = 15_000
const PDF_FETCH_TIMEOUT_MS = 30_000

/** Keeps prompt size (and cost) bounded; ~20k tokens for a typical paper. */
const MAX_FULL_TEXT_CHARS = 80_000

const USER_AGENT = 'research-tracker/0.1 (https://github.com/; personal arXiv tracker)'

function paperHtmlUrl(arxivId: string, version: number): string {
  return `https://arxiv.org/html/${arxivId}v${version}`
}

function paperPdfUrl(arxivId: string, version: number): string {
  return `https://arxiv.org/pdf/${arxivId}v${version}`
}

/**
 * Strips arXiv's LaTeXML HTML rendering down to the paper's plain text body.
 * Exported for testing; callers should use `fetchPaperFullText`.
 */
export function extractPaperText(html: string): string {
  const article = /<article[^>]*>([\s\S]*?)<\/article>/i.exec(html)
  let content = article ? article[1] : html

  content = content
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x[0-9a-fA-F]+;/g, ' ')
    .replace(/&#[0-9]+;/g, ' ')

  return content
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** arXiv's HTML rendering, when it has one. Not every paper does — see `fetchPaperFullText`. */
async function fetchFromHtml(
  arxivId: string,
  version: number,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  let response: Response
  try {
    response = await fetchImpl(paperHtmlUrl(arxivId, version), {
      signal: AbortSignal.timeout(HTML_FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT },
    })
  } catch {
    return null
  }
  if (!response.ok) return null

  const html = await response.text()
  return extractPaperText(html) || null
}

/** Falls back to the PDF (arXiv publishes one for every paper) when there's no HTML rendering. */
async function fetchFromPdf(
  arxivId: string,
  version: number,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  let response: Response
  try {
    response = await fetchImpl(paperPdfUrl(arxivId, version), {
      signal: AbortSignal.timeout(PDF_FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT },
    })
  } catch {
    return null
  }
  if (!response.ok) return null

  try {
    const pdf = await getDocumentProxy(new Uint8Array(await response.arrayBuffer()))
    const { text } = await extractText(pdf, { mergePages: true })
    return text.trim() || null
  } catch {
    // Malformed or unparseable PDF — treat like any other unavailable full text.
    return null
  }
}

async function fetchAndExtract(
  arxivId: string,
  version: number,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const text = (await fetchFromHtml(arxivId, version, fetchImpl)) ?? (await fetchFromPdf(arxivId, version, fetchImpl))
  if (!text) return null

  return text.length > MAX_FULL_TEXT_CHARS
    ? `${text.slice(0, MAX_FULL_TEXT_CHARS)}\n\n[Full text truncated for length.]`
    : text
}

/**
 * Caches successful extractions for this warm process, keyed by arxivId+version.
 * A chat conversation makes one of these calls per turn, and re-downloading and
 * re-parsing a multi-megabyte PDF on every message would make follow-ups slow.
 * Failures aren't cached, so a transient network error doesn't stick around.
 */
const fullTextCache = new Map<string, Promise<string | null>>()

export interface FetchPaperFullTextOptions {
  /** Overridable for tests. Also disables the in-memory cache. */
  fetchImpl?: typeof fetch
}

/**
 * Fetches a paper's full text, preferring arXiv's HTML rendering (cleaner
 * extraction) and falling back to its PDF (parsed with `unpdf`) when no HTML
 * rendering exists — arXiv only generates HTML for submissions from around
 * December 2023 onward, plus a backfilled subset of older ones, but every
 * paper has a PDF. Callers must still handle `null` (e.g. a network failure)
 * and fall back to the abstract.
 */
export async function fetchPaperFullText(
  arxivId: string,
  version: number,
  options: FetchPaperFullTextOptions = {},
): Promise<string | null> {
  const { fetchImpl } = options
  if (fetchImpl) return fetchAndExtract(arxivId, version, fetchImpl)

  const cacheKey = `${arxivId}v${version}`
  const cached = fullTextCache.get(cacheKey)
  if (cached) return cached

  const promise = fetchAndExtract(arxivId, version, fetch)
  fullTextCache.set(cacheKey, promise)
  promise.then((text) => {
    if (text === null) fullTextCache.delete(cacheKey)
  })
  return promise
}
