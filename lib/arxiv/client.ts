import { parseFeed } from './parse'
import { withDateWindow } from './query'
import { scheduleArxivRequest, type Scheduler } from './rate-limit'
import type { ArxivPaper } from './types'

const ARXIV_ENDPOINT = 'https://export.arxiv.org/api/query'

/** arXiv caps a single call at 2000 results. */
export const MAX_RESULTS_CEILING = 2000

const USER_AGENT = 'research-tracker/0.1 (https://github.com/; personal arXiv tracker)'

export class ArxivError extends Error {}

export interface SearchOptions {
  /** Only papers submitted at or after this instant. Null on a query's first run. */
  since?: Date | null
  until?: Date
  maxResults?: number
  signal?: AbortSignal
  /** Overridable for tests. */
  fetchImpl?: typeof fetch
  schedule?: Scheduler
}

/** Issue one request through the shared rate limiter and return the raw feed. */
async function fetchFeed(expression: string, options: SearchOptions, maxResults: number) {
  const {
    since = null,
    until = new Date(),
    signal,
    fetchImpl = fetch,
    schedule = scheduleArxivRequest,
  } = options

  const url = new URL(ARXIV_ENDPOINT)
  url.searchParams.set('search_query', withDateWindow(expression, since, until))
  url.searchParams.set('start', '0')
  url.searchParams.set('max_results', String(Math.min(maxResults, MAX_RESULTS_CEILING)))
  url.searchParams.set('sortBy', 'submittedDate')
  url.searchParams.set('sortOrder', 'descending')

  const xml = await schedule(async () => {
    console.log(`[arxiv] sending query: ${expression}`)
    const response = await fetchImpl(url, {
      signal,
      headers: { 'User-Agent': USER_AGENT },
    })
    if (!response.ok) {
      throw new ArxivError(`arXiv returned HTTP ${response.status} for: ${expression}`)
    }
    return response.text()
  })

  // arXiv reports some failures as a 200 whose feed holds a single "Error" entry
  // rather than as an HTTP status. Such entries have no <published>, so catch
  // them before parsing rather than letting them through as Invalid Date papers.
  if (xml.includes('arxiv.org/api/errors#')) {
    throw new ArxivError(`arXiv rejected the query: ${expression}`)
  }

  return parseFeed(xml)
}

/**
 * Run one arXiv search expression. Every call is funnelled through the shared
 * rate limiter, so concurrent callers serialize rather than violating arXiv's
 * single-connection rule.
 */
export async function searchArxiv(
  expression: string,
  options: SearchOptions = {},
): Promise<ArxivPaper[]> {
  const { papers } = await fetchFeed(expression, options, options.maxResults ?? 100)
  return papers
}

/**
 * How many papers an expression matches, over all time.
 *
 * Used to validate a query before it is saved: arXiv answers a malformed query
 * with HTTP 200 and zero results rather than an error, so a typo is otherwise
 * indistinguishable from a topic that simply has no new papers.
 */
export async function countArxivResults(
  expression: string,
  options: Omit<SearchOptions, 'since' | 'until' | 'maxResults'> = {},
): Promise<number> {
  const { totalResults } = await fetchFeed(expression, { ...options, since: null }, 1)
  return totalResults
}
