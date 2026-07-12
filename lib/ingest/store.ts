import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { getDb } from '@/lib/db'
import { ingestRuns, papers, topicPapers, topicQueries, topics } from '@/drizzle/schema'
import type {
  EmbeddingUpdate,
  FoundPaper,
  IngestStore,
  IngestTopic,
  NewLink,
  RunSummary,
  ScoreUpdate,
} from './types'

/**
 * Any Drizzle Postgres database. Parameterized so integration tests can exercise
 * this exact SQL against a throwaway Postgres rather than against Neon.
 */
export type Database = PgDatabase<PgQueryResultHKT, Record<string, unknown>>

export function createStore(database: Database): IngestStore {
  return {
    async listActiveTopics(topicId?: number): Promise<IngestTopic[]> {
      const rows = await database
        .select({
          topicId: topics.id,
          description: topics.description,
          queryId: topicQueries.id,
          expression: topicQueries.expression,
          lastFetchedAt: topicQueries.lastFetchedAt,
        })
        .from(topics)
        .innerJoin(topicQueries, eq(topicQueries.topicId, topics.id))
        .where(
          topicId === undefined
            ? eq(topics.active, true)
            : and(eq(topics.active, true), eq(topics.id, topicId)),
        )
        .orderBy(topics.id, topicQueries.id)

      // The inner join already drops topics with no queries: they have nothing
      // to search.
      const byTopic = new Map<number, IngestTopic>()
      for (const row of rows) {
        let topic = byTopic.get(row.topicId)
        if (!topic) {
          topic = { id: row.topicId, description: row.description, queries: [] }
          byTopic.set(row.topicId, topic)
        }
        topic.queries.push({
          id: row.queryId,
          expression: row.expression,
          lastFetchedAt: row.lastFetchedAt,
        })
      }

      return [...byTopic.values()]
    },

    /**
     * The cursor of the most recent *finished* run. Scoped to finished runs
     * because `runIngest` opens its own run row before asking for the cursor;
     * without the filter this would read back the run currently in progress.
     */
    async previousResumeCursor(): Promise<number | null> {
      const [row] = await database
        .select({ resumeCursor: ingestRuns.resumeCursor })
        .from(ingestRuns)
        .where(ne(ingestRuns.status, 'running'))
        .orderBy(desc(ingestRuns.id))
        .limit(1)

      return row?.resumeCursor ?? null
    },

    async startRun(): Promise<number> {
      const [row] = await database
        .insert(ingestRuns)
        .values({ status: 'running' })
        .returning({ id: ingestRuns.id })
      return row.id
    },

    async finishRun(runId: number, summary: Omit<RunSummary, 'runId'>): Promise<void> {
      await database
        .update(ingestRuns)
        .set({
          finishedAt: new Date(),
          status: summary.status,
          topicsProcessed: summary.topicsProcessed,
          papersFound: summary.papersFound,
          resumeCursor: summary.resumeCursor,
          error: summary.error,
        })
        .where(eq(ingestRuns.id, runId))
    },

    /**
     * Upsert the papers, then link them to the topic. `onConflictDoNothing` on
     * the link means `.returning()` yields exactly the links that are new, which
     * is precisely the set worth scoring and surfacing as unread.
     *
     * Callers must dedupe by arxivId first: Postgres rejects an upsert that
     * would touch the same row twice in one statement.
     */
    async recordPapers(topicId: number, found: FoundPaper[], runId?: number): Promise<NewLink[]> {
      if (found.length === 0) return []

      const upserted = await database
        .insert(papers)
        .values(
          found.map(({ paper }) => ({
            arxivId: paper.arxivId,
            version: paper.version,
            title: paper.title,
            abstract: paper.abstract,
            authors: paper.authors,
            categories: paper.categories,
            publishedAt: paper.publishedAt,
            updatedAt: paper.updatedAt,
            pdfUrl: paper.pdfUrl,
            absUrl: paper.absUrl,
          })),
        )
        .onConflictDoUpdate({
          target: papers.arxivId,
          set: {
            version: sql`excluded.version`,
            title: sql`excluded.title`,
            abstract: sql`excluded.abstract`,
            authors: sql`excluded.authors`,
            categories: sql`excluded.categories`,
            updatedAt: sql`excluded.updated_at`,
            pdfUrl: sql`excluded.pdf_url`,
            absUrl: sql`excluded.abs_url`,
          },
        })
        .returning({ id: papers.id, arxivId: papers.arxivId })

      const paperIdByArxivId = new Map(upserted.map((r) => [r.arxivId, r.id]))

      const inserted = await database
        .insert(topicPapers)
        .values(
          found.map(({ paper, matchedQuery }) => ({
            topicId,
            paperId: paperIdByArxivId.get(paper.arxivId)!,
            matchedQuery,
            firstSeenRunId: runId ?? null,
          })),
        )
        .onConflictDoNothing()
        .returning({ paperId: topicPapers.paperId })

      const newPaperIds = new Set(inserted.map((r) => r.paperId))

      return found
        .filter(({ paper }) => newPaperIds.has(paperIdByArxivId.get(paper.arxivId)!))
        .map(({ paper }) => ({
          paperId: paperIdByArxivId.get(paper.arxivId)!,
          arxivId: paper.arxivId,
          title: paper.title,
          abstract: paper.abstract,
        }))
    },

    /** One statement rather than a round trip per paper. */
    async saveEmbeddings(updates: EmbeddingUpdate[]): Promise<void> {
      if (updates.length === 0) return

      const values = sql.join(
        updates.map(
          (u) => sql`(${u.paperId}::int, ${JSON.stringify(u.embedding)}::jsonb)`,
        ),
        sql`, `,
      )

      await database.execute(sql`
        UPDATE ${papers} AS p
        SET embedding = v.embedding
        FROM (VALUES ${values}) AS v(paper_id, embedding)
        WHERE p.id = v.paper_id
      `)
    },

    /** One statement rather than a round trip per paper. */
    async saveScores(topicId: number, updates: ScoreUpdate[]): Promise<void> {
      if (updates.length === 0) return

      const values = sql.join(
        updates.map((u) => sql`(${u.paperId}::int, ${u.score}::int)`),
        sql`, `,
      )

      await database.execute(sql`
        UPDATE ${topicPapers} AS tp
        SET relevance_score = v.score
        FROM (VALUES ${values}) AS v(paper_id, score)
        WHERE tp.topic_id = ${topicId} AND tp.paper_id = v.paper_id
      `)
    },

    async markQueriesFetched(queryIds: number[], at: Date): Promise<void> {
      if (queryIds.length === 0) return

      await database
        .update(topicQueries)
        .set({ lastFetchedAt: at })
        .where(inArray(topicQueries.id, queryIds))
    },
  }
}

let cached: IngestStore | undefined

/** The store the app uses, bound lazily to the Neon connection. */
export function getDrizzleStore(): IngestStore {
  if (!cached) cached = createStore(getDb() as unknown as Database)
  return cached
}
