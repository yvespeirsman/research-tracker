export { ArxivError, countArxivResults, MAX_RESULTS_CEILING, searchArxiv, type SearchOptions } from './client'
export { extractPaperText, fetchPaperFullText, type FetchPaperFullTextOptions } from './fulltext'
export { monthFromArxivId, normalizeArxivId, parseAtomFeed, parseFeed, type ArxivFeed } from './parse'
export { formatArxivDate, withDateWindow } from './query'
export {
  ARXIV_MIN_INTERVAL_MS,
  createRateLimiter,
  scheduleArxivRequest,
  type Scheduler,
} from './rate-limit'
export type { ArxivPaper } from './types'
