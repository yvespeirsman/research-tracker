import type { FoundPaper } from './types'

/**
 * Order topics so a budget-truncated run resumes where it stopped, then wraps
 * around to the topics it already covered. Without the wrap, topics before the
 * cursor would be starved whenever the budget runs out every run.
 */
export function rotateToCursor<T extends { id: number }>(
  topics: T[],
  cursor: number | null,
): T[] {
  if (cursor === null) return topics

  const start = topics.findIndex((t) => t.id >= cursor)
  if (start <= 0) return topics

  return [...topics.slice(start), ...topics.slice(0, start)]
}

/**
 * One paper can be surfaced by several of a topic's expanded queries. Keep the
 * first query that found it — that is the most specific attribution we can make
 * cheaply, and it is what `matchedQuery` is for.
 */
export function dedupeFound(found: FoundPaper[]): FoundPaper[] {
  const seen = new Set<string>()
  const out: FoundPaper[] = []
  for (const item of found) {
    if (seen.has(item.paper.arxivId)) continue
    seen.add(item.paper.arxivId)
    out.push(item)
  }
  return out
}
