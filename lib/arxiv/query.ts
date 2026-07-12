const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** arXiv's `submittedDate` filter wants `YYYYMMDDHHMM`, in UTC. */
export function formatArxivDate(date: Date): string {
  return (
    String(date.getUTCFullYear()) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes())
  )
}

/**
 * Restrict an expression to papers submitted in [since, until].
 *
 * The expression is parenthesized so that a top-level `OR` inside it cannot
 * swallow the `AND submittedDate:` clause — `a OR b AND date` would otherwise
 * bind the date to `b` alone.
 *
 * With no `since` watermark (a brand-new topic) we return the expression
 * unchanged and let arXiv's relevance/date sort bound the result set instead.
 */
export function withDateWindow(
  expression: string,
  since: Date | null,
  until: Date,
): string {
  if (!since) return expression
  return `(${expression}) AND submittedDate:[${formatArxivDate(since)} TO ${formatArxivDate(until)}]`
}
