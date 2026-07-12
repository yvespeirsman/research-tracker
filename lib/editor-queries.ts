import type { QuerySource } from '@/app/actions'

export interface EditorQuery {
  key: string
  /** Present only for queries already saved to the database. */
  id?: number
  expression: string
  source: QuerySource
  lastFetchedAt?: Date | null
  paperCount?: number
}

let keySeq = 0
const nextKey = () => `q${keySeq++}`

export function toEditorQueries(
  rows: { id?: number; expression: string; source: QuerySource; lastFetchedAt?: Date | null }[],
  paperCounts?: Map<string, number>,
): EditorQuery[] {
  return rows.map((r) => ({
    key: nextKey(),
    id: r.id,
    expression: r.expression,
    source: r.source,
    lastFetchedAt: r.lastFetchedAt ?? null,
    paperCount: paperCounts?.get(r.expression),
  }))
}
