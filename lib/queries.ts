import 'server-only'
import { and, asc, count, countDistinct, desc, eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { papers, topicPapers, topicQueries, topics } from '@/drizzle/schema'
import { monthFromArxivId } from '@/lib/arxiv'
import { averageVector, cosineSimilarity, normalize } from '@/lib/embeddings'

export interface TopicSummary {
  id: number
  name: string
  description: string
  queryCount: number
  /** Queries added since the last run, which will backfill on the next one. */
  pendingQueryCount: number
  /** Most recent watermark across the topic's queries. */
  lastFetchedAt: Date | null
  unreadCount: number
}

/**
 * Topics with their unread counts, for the home page.
 *
 * Counting unread papers and queries in one query would multiply the two joins
 * together, so each is counted distinctly.
 */
export async function listTopicSummaries(): Promise<TopicSummary[]> {
  const db = getDb()

  const rows = await db
    .select({
      id: topics.id,
      name: topics.name,
      description: topics.description,
      queryCount: countDistinct(topicQueries.id),
      pendingQueryCount: sql<number>`count(distinct ${topicQueries.id}) filter (where ${topicQueries.lastFetchedAt} is null)`.mapWith(
        Number,
      ),
      lastFetchedAt: sql<Date | null>`max(${topicQueries.lastFetchedAt})`,
      unreadCount: countDistinct(topicPapers.id),
    })
    .from(topics)
    .leftJoin(topicQueries, eq(topicQueries.topicId, topics.id))
    .leftJoin(
      topicPapers,
      and(eq(topicPapers.topicId, topics.id), eq(topicPapers.state, 'unread')),
    )
    .where(eq(topics.active, true))
    .groupBy(topics.id)
    .orderBy(topics.id)

  return rows.map((row) => ({
    ...row,
    lastFetchedAt: row.lastFetchedAt ? new Date(row.lastFetchedAt) : null,
  }))
}

export async function getTopic(id: number) {
  const db = getDb()
  const [row] = await db.select().from(topics).where(eq(topics.id, id)).limit(1)
  return row ?? null
}

export interface TopicQueryRow {
  id: number
  expression: string
  source: 'llm' | 'manual'
  lastFetchedAt: Date | null
}

/** A topic's search expressions, oldest first, for the query editor. */
export async function listTopicQueries(topicId: number): Promise<TopicQueryRow[]> {
  const db = getDb()

  return db
    .select({
      id: topicQueries.id,
      expression: topicQueries.expression,
      source: topicQueries.source,
      lastFetchedAt: topicQueries.lastFetchedAt,
    })
    .from(topicQueries)
    .where(eq(topicQueries.topicId, topicId))
    .orderBy(asc(topicQueries.id))
}

/** How many papers a given expression has surfaced for this topic. */
export async function countPapersByQuery(topicId: number): Promise<Map<string, number>> {
  const db = getDb()

  const rows = await db
    .select({ matchedQuery: topicPapers.matchedQuery, n: count(topicPapers.id) })
    .from(topicPapers)
    .where(eq(topicPapers.topicId, topicId))
    .groupBy(topicPapers.matchedQuery)

  const result = new Map<string, number>()
  for (const row of rows) {
    if (row.matchedQuery) result.set(row.matchedQuery, row.n)
  }
  return result
}

export interface InboxPaper {
  paperId: number
  arxivId: string
  version: number
  title: string
  abstract: string
  authors: string[]
  categories: string[]
  publishedAt: Date
  absUrl: string
  pdfUrl: string | null
  relevanceScore: number | null
  matchedQuery: string | null
  state: 'unread' | 'read' | 'saved' | 'dismissed'
  label: string | null
  notes: string | null
}

export type InboxSort = 'score' | 'date'

/** Papers shown per page on the topic dashboard. */
export const INBOX_PAGE_SIZE = 10

export interface PaginationOptions {
  /** 1-indexed. */
  page: number
  pageSize: number
}

/** `websearch_to_tsquery` matcher against a paper's title+abstract, for full-text search within a topic. */
function searchMatch(search: string) {
  return sql`${papers.searchVector} @@ websearch_to_tsquery('english', ${search})`
}

function inboxWhere(
  topicId: number,
  states: InboxPaper['state'][],
  label?: string | null,
  runId?: number,
  search?: string,
) {
  return and(
    eq(topicPapers.topicId, topicId),
    sql`${topicPapers.state} = ANY(ARRAY[${sql.join(
      states.map((s) => sql`${s}`),
      sql`, `,
    )}]::paper_state[])`,
    label === undefined ? undefined : label === null ? sql`${topicPapers.label} is null` : eq(topicPapers.label, label),
    runId === undefined ? undefined : eq(topicPapers.firstSeenRunId, runId),
    search === undefined ? undefined : searchMatch(search),
  )
}

/**
 * The most recent ingest run that linked any paper to this topic, or `null`
 * if none has (either nothing has been ingested yet, or every link predates
 * the `firstSeenRunId` column). Powers the "New" tab: papers linked
 * by this exact run are what the topic's last refresh actually surfaced.
 */
export async function getLatestRunId(topicId: number): Promise<number | null> {
  const db = getDb()

  const [row] = await db
    .select({ runId: sql<number | null>`max(${topicPapers.firstSeenRunId})` })
    .from(topicPapers)
    .where(eq(topicPapers.topicId, topicId))

  return row?.runId ?? null
}

/**
 * A topic's papers. `sort: 'score'` (the default) puts the most relevant
 * first — unscored papers sort last rather than first, since a NULL score
 * means embedding/scoring hasn't run yet, not that the paper is bad. `sort:
 * 'date'` puts the most recently submitted first.
 *
 * Pass `pagination` to limit/offset the result for the dashboard; omit it to
 * get every matching paper, which the integration tests rely on.
 *
 * `label` narrows to papers with that exact label; pass `null` for papers
 * with no label at all. Omit it (the default) to not filter by label.
 *
 * `runId` narrows to papers first linked to the topic by that specific
 * ingest run — see `getLatestRunId`.
 *
 * `search` narrows to papers whose title or abstract matches the given
 * full-text query, and takes over ordering: matches rank highest first,
 * with `sort` breaking ties rather than driving the order outright.
 */
export async function listInbox(
  topicId: number,
  states: InboxPaper['state'][],
  sort: InboxSort = 'score',
  pagination?: PaginationOptions,
  label?: string | null,
  runId?: number,
  search?: string,
): Promise<InboxPaper[]> {
  const db = getDb()

  const tieBreak =
    sort === 'date'
      ? [desc(papers.publishedAt), sql`${topicPapers.relevanceScore} DESC NULLS LAST`]
      : [sql`${topicPapers.relevanceScore} DESC NULLS LAST`, desc(papers.publishedAt)]

  const orderBy = search
    ? [
        sql`ts_rank(${papers.searchVector}, websearch_to_tsquery('english', ${search})) DESC`,
        ...tieBreak,
      ]
    : tieBreak

  const query = db
    .select({
      paperId: papers.id,
      arxivId: papers.arxivId,
      version: papers.version,
      title: papers.title,
      abstract: papers.abstract,
      authors: papers.authors,
      categories: papers.categories,
      publishedAt: papers.publishedAt,
      absUrl: papers.absUrl,
      pdfUrl: papers.pdfUrl,
      relevanceScore: topicPapers.relevanceScore,
      matchedQuery: topicPapers.matchedQuery,
      state: topicPapers.state,
      label: topicPapers.label,
      notes: topicPapers.notes,
    })
    .from(topicPapers)
    .innerJoin(papers, eq(papers.id, topicPapers.paperId))
    .where(inboxWhere(topicId, states, label, runId, search))
    .orderBy(...orderBy)

  if (!pagination) return query

  return query
    .limit(pagination.pageSize)
    .offset((pagination.page - 1) * pagination.pageSize)
}

/** A single paper's full topic-scoped view, for the paper detail page. */
export async function getInboxPaper(topicId: number, paperId: number): Promise<InboxPaper | null> {
  const db = getDb()

  const [row] = await db
    .select({
      paperId: papers.id,
      arxivId: papers.arxivId,
      version: papers.version,
      title: papers.title,
      abstract: papers.abstract,
      authors: papers.authors,
      categories: papers.categories,
      publishedAt: papers.publishedAt,
      absUrl: papers.absUrl,
      pdfUrl: papers.pdfUrl,
      relevanceScore: topicPapers.relevanceScore,
      matchedQuery: topicPapers.matchedQuery,
      state: topicPapers.state,
      label: topicPapers.label,
      notes: topicPapers.notes,
    })
    .from(topicPapers)
    .innerJoin(papers, eq(papers.id, topicPapers.paperId))
    .where(and(eq(topicPapers.topicId, topicId), eq(topicPapers.paperId, paperId)))
    .limit(1)

  return row ?? null
}

/** How many papers match a state (and optional label/run/search) filter, for computing page count. */
export async function countInbox(
  topicId: number,
  states: InboxPaper['state'][],
  label?: string | null,
  runId?: number,
  search?: string,
): Promise<number> {
  const db = getDb()

  const [row] = await db
    .select({ n: count() })
    .from(topicPapers)
    .innerJoin(papers, eq(papers.id, topicPapers.paperId))
    .where(inboxWhere(topicId, states, label, runId, search))

  return row?.n ?? 0
}

export interface SimilarPaper {
  paperId: number
  arxivId: string
  title: string
  absUrl: string
  /** Cosine similarity to the source paper's embedding, in [-1, 1]. */
  similarity: number
}

/**
 * The papers in a topic most similar to a given one, ranked by cosine
 * similarity between their embeddings. Restricted to this topic's paper set
 * rather than every paper in the database, since "similar" is only useful
 * relative to what the user is already looking at.
 *
 * Papers without an embedding yet (scoring pending) are excluded, including
 * the source paper itself — in which case an empty list comes back.
 */
export async function findSimilarPapers(
  topicId: number,
  paperId: number,
  limit = 10,
): Promise<SimilarPaper[]> {
  const db = getDb()

  const rows = await db
    .select({
      paperId: papers.id,
      arxivId: papers.arxivId,
      title: papers.title,
      absUrl: papers.absUrl,
      embedding: papers.embedding,
    })
    .from(topicPapers)
    .innerJoin(papers, eq(papers.id, topicPapers.paperId))
    .where(eq(topicPapers.topicId, topicId))

  const target = rows.find((r) => r.paperId === paperId)?.embedding
  if (!target) return []

  return rows
    .filter((r): r is typeof r & { embedding: number[] } => r.paperId !== paperId && r.embedding !== null)
    .map((r) => ({
      paperId: r.paperId,
      arxivId: r.arxivId,
      title: r.title,
      absUrl: r.absUrl,
      similarity: cosineSimilarity(target, r.embedding),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
}

export interface LabelSuggestion {
  paperId: number
  arxivId: string
  title: string
  absUrl: string
  /** Cosine similarity to the centroid of papers already carrying this label, in [-1, 1]. */
  similarity: number
}

/**
 * Unlabeled papers in a topic that look like they belong under `label`,
 * ranked by cosine similarity to the centroid embedding of the papers already
 * carrying that label. Returns nothing if the label has no embedded papers
 * yet — there's no signal to suggest from.
 */
export async function suggestPapersForLabel(
  topicId: number,
  label: string,
  limit = 5,
): Promise<LabelSuggestion[]> {
  const db = getDb()

  const rows = await db
    .select({
      paperId: papers.id,
      arxivId: papers.arxivId,
      title: papers.title,
      absUrl: papers.absUrl,
      embedding: papers.embedding,
      label: topicPapers.label,
    })
    .from(topicPapers)
    .innerJoin(papers, eq(papers.id, topicPapers.paperId))
    .where(eq(topicPapers.topicId, topicId))

  const labeledEmbeddings = rows
    .filter((r) => r.label === label && r.embedding !== null)
    .map((r) => r.embedding as number[])
  if (labeledEmbeddings.length === 0) return []

  const centroid = normalize(averageVector(labeledEmbeddings))

  return rows
    .filter((r): r is typeof r & { embedding: number[] } => r.label === null && r.embedding !== null)
    .map((r) => ({
      paperId: r.paperId,
      arxivId: r.arxivId,
      title: r.title,
      absUrl: r.absUrl,
      similarity: cosineSimilarity(centroid, r.embedding),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
}

/** A topic's distinct paper labels, for the label picker's suggestions. */
export async function listTopicLabels(topicId: number): Promise<string[]> {
  const db = getDb()

  const rows = await db
    .selectDistinct({ label: topicPapers.label })
    .from(topicPapers)
    .where(and(eq(topicPapers.topicId, topicId), sql`${topicPapers.label} is not null`))
    .orderBy(asc(topicPapers.label))

  return rows.map((r) => r.label).filter((l): l is string => l !== null)
}

export type ReportFilter =
  | { type: 'label'; label: string }
  | { type: 'recent'; days: number }

export interface ReportPaper {
  paperId: number
  arxivId: string
  title: string
  abstract: string
  authors: string[]
  publishedAt: Date
  absUrl: string
  label: string | null
}

/**
 * Hard cap on how many papers feed a single report. Bounds LLM input cost
 * regardless of how much traffic a topic or label has; when a filter matches
 * more than this, the most relevant papers are kept.
 */
export const MAX_REPORT_PAPERS = 60

/**
 * Papers to synthesize into a report, scoped either to a label or to the last
 * `days` days of a topic. Dismissed papers are excluded — the user already
 * said they're not relevant, so a report shouldn't discuss them.
 *
 * Matches beyond `MAX_REPORT_PAPERS` are dropped by relevance (unscored papers
 * sort last), then the kept set is re-ordered oldest-to-newest, which reads
 * better as a narrative than relevance order.
 */
export async function listReportPapers(
  topicId: number,
  filter: ReportFilter,
): Promise<ReportPaper[]> {
  const db = getDb()

  const rows = await db
    .select({
      paperId: papers.id,
      arxivId: papers.arxivId,
      title: papers.title,
      abstract: papers.abstract,
      authors: papers.authors,
      publishedAt: papers.publishedAt,
      absUrl: papers.absUrl,
      label: topicPapers.label,
    })
    .from(topicPapers)
    .innerJoin(papers, eq(papers.id, topicPapers.paperId))
    .where(
      and(
        eq(topicPapers.topicId, topicId),
        sql`${topicPapers.state} <> 'dismissed'`,
        filter.type === 'label'
          ? eq(topicPapers.label, filter.label)
          : sql`${papers.publishedAt} >= now() - ${filter.days} * interval '1 day'`,
      ),
    )
    .orderBy(sql`${topicPapers.relevanceScore} DESC NULLS LAST`)
    .limit(MAX_REPORT_PAPERS)

  return rows.sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())
}

export interface MonthCount {
  /** `YYYY-MM` */
  month: string
  count: number
}

function nextMonth(month: string): string {
  const [year, mm] = month.split('-').map(Number)
  return mm === 12 ? `${year + 1}-01` : `${year}-${String(mm + 1).padStart(2, '0')}`
}

/** How much history the "papers by month" chart shows. */
const MONTHS_SHOWN = 5 * 12

/**
 * How many of a topic's papers were submitted each month, per the month baked
 * into each arXiv id, over the most recent `MONTHS_SHOWN` months. Months with
 * no papers are included as zero so a gap in the timeline reads as a gap, not
 * a skip.
 */
export async function papersByMonth(topicId: number): Promise<MonthCount[]> {
  const db = getDb()

  const rows = await db
    .select({ arxivId: papers.arxivId })
    .from(topicPapers)
    .innerJoin(papers, eq(papers.id, topicPapers.paperId))
    .where(eq(topicPapers.topicId, topicId))

  const counts = new Map<string, number>()
  for (const { arxivId } of rows) {
    const month = monthFromArxivId(arxivId)
    if (month) counts.set(month, (counts.get(month) ?? 0) + 1)
  }
  if (counts.size === 0) return []

  const months = [...counts.keys()].sort()
  const result: MonthCount[] = []
  for (let month = months[0]; month <= months[months.length - 1]; month = nextMonth(month)) {
    result.push({ month, count: counts.get(month) ?? 0 })
  }
  return result.slice(-MONTHS_SHOWN)
}
