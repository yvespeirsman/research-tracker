import { ArxivError, countArxivResults } from '@/lib/arxiv'
import { rejectReason } from './sanitize'

export type QueryCheck =
  /** Structurally broken, a duplicate, or rejected outright by arXiv. Do not save. */
  | { status: 'invalid'; reason: string }
  /** Valid syntax, but arXiv has never matched a single paper. Almost always a mistake. */
  | { status: 'empty'; count: 0 }
  /** Valid and matches papers. `count` is the all-time match count. */
  | { status: 'ok'; count: number }

export interface ValidateOptions {
  /** Other expressions on the same topic; a duplicate is rejected. */
  existing?: string[]
  count?: typeof countArxivResults
}

/**
 * Check an expression before it is saved.
 *
 * arXiv answers a malformed query with HTTP 200 and zero results rather than an
 * error, so a typo is indistinguishable from a topic with no new papers. Probing
 * arXiv once at save time is the only way to tell those apart, and it costs one
 * rate-limited request.
 */
export async function validateQuery(
  expression: string,
  options: ValidateOptions = {},
): Promise<QueryCheck> {
  const { existing = [], count = countArxivResults } = options
  const trimmed = expression.trim()

  const syntaxProblem = rejectReason(trimmed)
  if (syntaxProblem) return { status: 'invalid', reason: syntaxProblem }

  if (existing.some((e) => e.trim().toLowerCase() === trimmed.toLowerCase())) {
    return { status: 'invalid', reason: 'This topic already has that expression.' }
  }

  let matches: number
  try {
    matches = await count(trimmed)
  } catch (err) {
    if (err instanceof ArxivError) {
      return { status: 'invalid', reason: 'arXiv rejected this expression.' }
    }
    throw err
  }

  return matches === 0 ? { status: 'empty', count: 0 } : { status: 'ok', count: matches }
}
