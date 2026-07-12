import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { ArxivPaper } from '@/lib/arxiv'
import { ingestRuns, papers, topicPapers, topicQueries, topics } from '@/drizzle/schema'
import { runIngest, type IngestDeps } from './run'
import { createStore, type Database } from './store'
import type { FoundPaper } from './types'

const url = process.env.TEST_DATABASE_URL

/** Deterministic stand-ins so these tests don't load the real embedding model. */
const stubEmbedText: NonNullable<IngestDeps['embedText']> = async () => [0]
const stubEmbedBatch: NonNullable<IngestDeps['embedBatch']> = async (texts) =>
  texts.map(() => [0])

/**
 * Exercises the store's real SQL — upsert with `excluded.*`, the
 * `onConflictDoNothing().returning()` new-link trick, and the batched
 * UPDATE ... FROM (VALUES ...) writers — which unit tests with a fake store
 * cannot cover.
 *
 * Skipped unless TEST_DATABASE_URL points at a scratch Postgres.
 */
describe.skipIf(!url)('drizzle store (integration)', () => {
  const pool = new Pool({ connectionString: url })
  const db = drizzle(pool)
  const store = createStore(db as unknown as Database)

  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE ${topicPapers}, ${topicQueries}, ${papers}, ${topics}, ${ingestRuns} RESTART IDENTITY CASCADE`,
    )
  })

  /** Creates a topic plus its queries; returns the topic id and the query ids. */
  const makeTopic = async (
    queries: { expression: string; lastFetchedAt?: Date | null }[] = [{ expression: 'qA' }],
    overrides: Partial<typeof topics.$inferInsert> = {},
  ) => {
    const [row] = await db
      .insert(topics)
      .values({ name: 'T', description: 'a topic', ...overrides })
      .returning({ id: topics.id })

    const queryIds: number[] = []
    for (const query of queries) {
      const [q] = await db
        .insert(topicQueries)
        .values({
          topicId: row.id,
          expression: query.expression,
          lastFetchedAt: query.lastFetchedAt ?? null,
        })
        .returning({ id: topicQueries.id })
      queryIds.push(q.id)
    }

    return { topicId: row.id, queryIds }
  }

  const paper = (arxivId: string, overrides: Partial<ArxivPaper> = {}): ArxivPaper => ({
    arxivId,
    version: 1,
    title: `Title ${arxivId}`,
    abstract: `Abstract ${arxivId}`,
    authors: ['Ada'],
    categories: ['cs.IR'],
    publishedAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    absUrl: `https://arxiv.org/abs/${arxivId}`,
    pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
    ...overrides,
  })

  const found = (p: ArxivPaper, matchedQuery = 'qA'): FoundPaper => ({ paper: p, matchedQuery })

  describe('recordPapers', () => {
    it('inserts papers and returns every link as new', async () => {
      const { topicId } = await makeTopic()

      const links = await store.recordPapers(topicId, [found(paper('1')), found(paper('2'))])

      expect(links.map((l) => l.arxivId).sort()).toEqual(['1', '2'])
      expect(await db.select().from(papers)).toHaveLength(2)
    })

    it('returns no new links the second time the same paper is seen', async () => {
      const { topicId } = await makeTopic()
      await store.recordPapers(topicId, [found(paper('1'))])

      const second = await store.recordPapers(topicId, [found(paper('1'))])

      expect(second).toEqual([])
      expect(await db.select().from(papers)).toHaveLength(1)
      expect(await db.select().from(topicPapers)).toHaveLength(1)
    })

    it('upserts a resubmitted paper onto the same row, updating version and title', async () => {
      const { topicId } = await makeTopic()
      await store.recordPapers(topicId, [found(paper('1'))])

      await store.recordPapers(topicId, [
        found(paper('1', { version: 3, title: 'Revised title' })),
      ])

      const rows = await db.select().from(papers)
      expect(rows).toHaveLength(1)
      expect(rows[0].version).toBe(3)
      expect(rows[0].title).toBe('Revised title')
    })

    it('links a shared paper to a second topic without duplicating the paper', async () => {
      const { topicId: a } = await makeTopic()
      const { topicId: b } = await makeTopic()
      await store.recordPapers(a, [found(paper('1'))])

      const links = await store.recordPapers(b, [found(paper('1'))])

      expect(links.map((l) => l.arxivId)).toEqual(['1'])
      expect(await db.select().from(papers)).toHaveLength(1)
      expect(await db.select().from(topicPapers)).toHaveLength(2)
    })

    it('records which query matched', async () => {
      const { topicId } = await makeTopic()
      await store.recordPapers(topicId, [found(paper('1'), 'abs:"needle"')])

      const [link] = await db.select().from(topicPapers)
      expect(link.matchedQuery).toBe('abs:"needle"')
      expect(link.state).toBe('unread')
    })

    it('stamps new links with the given runId', async () => {
      const { topicId } = await makeTopic()
      const runId = await store.startRun()

      await store.recordPapers(topicId, [found(paper('1'))], runId)

      const [link] = await db.select().from(topicPapers)
      expect(link.firstSeenRunId).toBe(runId)
    })

    it('leaves firstSeenRunId null when no runId is given', async () => {
      const { topicId } = await makeTopic()

      await store.recordPapers(topicId, [found(paper('1'))])

      const [link] = await db.select().from(topicPapers)
      expect(link.firstSeenRunId).toBeNull()
    })
  })

  describe('saveEmbeddings', () => {
    it('writes embeddings onto the right papers', async () => {
      const { topicId } = await makeTopic()
      const links = await store.recordPapers(topicId, [found(paper('1')), found(paper('2'))])
      const byArxiv = new Map(links.map((l) => [l.arxivId, l.paperId]))

      await store.saveEmbeddings([
        { paperId: byArxiv.get('1')!, embedding: [0.1, 0.2, 0.3] },
        { paperId: byArxiv.get('2')!, embedding: [0.4, 0.5, 0.6] },
      ])

      const rows = await db.select().from(papers)
      const embeddingByPaperId = Object.fromEntries(rows.map((r) => [r.id, r.embedding]))
      expect(embeddingByPaperId[byArxiv.get('1')!]).toEqual([0.1, 0.2, 0.3])
      expect(embeddingByPaperId[byArxiv.get('2')!]).toEqual([0.4, 0.5, 0.6])
    })

    it('is a no-op for an empty update list', async () => {
      await expect(store.saveEmbeddings([])).resolves.toBeUndefined()
    })
  })

  describe('saveScores', () => {
    it('writes scores onto the right links', async () => {
      const { topicId } = await makeTopic()
      const links = await store.recordPapers(topicId, [found(paper('1')), found(paper('2'))])
      const byArxiv = new Map(links.map((l) => [l.arxivId, l.paperId]))

      await store.saveScores(topicId, [
        { paperId: byArxiv.get('1')!, score: 91 },
        { paperId: byArxiv.get('2')!, score: 12 },
      ])

      const rows = await db.select().from(topicPapers)
      const scored = Object.fromEntries(rows.map((r) => [r.paperId, r.relevanceScore]))
      expect(scored[byArxiv.get('1')!]).toBe(91)
      expect(scored[byArxiv.get('2')!]).toBe(12)
    })

    it('does not touch the same paper linked to another topic', async () => {
      const { topicId: a } = await makeTopic()
      const { topicId: b } = await makeTopic()
      const [linkA] = await store.recordPapers(a, [found(paper('1'))])
      await store.recordPapers(b, [found(paper('1'))])

      await store.saveScores(a, [{ paperId: linkA.paperId, score: 77 }])

      const rows = await db.select().from(topicPapers)
      expect(rows.find((r) => r.topicId === a)!.relevanceScore).toBe(77)
      expect(rows.find((r) => r.topicId === b)!.relevanceScore).toBeNull()
    })

    it('is a no-op for an empty update list', async () => {
      const { topicId } = await makeTopic()
      await expect(store.saveScores(topicId, [])).resolves.toBeUndefined()
    })
  })

  describe('listActiveTopics', () => {
    it('groups queries under their topic, in id order', async () => {
      const { topicId } = await makeTopic([
        { expression: 'qA' },
        { expression: 'qB' },
      ])

      const [topic] = await store.listActiveTopics()

      expect(topic.id).toBe(topicId)
      expect(topic.queries.map((q) => q.expression)).toEqual(['qA', 'qB'])
    })

    it('carries each query its own watermark', async () => {
      const watermark = new Date('2026-07-01T00:00:00Z')
      await makeTopic([
        { expression: 'old', lastFetchedAt: watermark },
        { expression: 'new', lastFetchedAt: null },
      ])

      const [topic] = await store.listActiveTopics()

      expect(topic.queries[0].lastFetchedAt?.toISOString()).toBe(watermark.toISOString())
      expect(topic.queries[1].lastFetchedAt).toBeNull()
    })

    it('excludes inactive topics and topics with no queries', async () => {
      const { topicId: active } = await makeTopic()
      await makeTopic([{ expression: 'x' }], { active: false })
      await makeTopic([]) // no queries at all

      const result = await store.listActiveTopics()

      expect(result.map((t) => t.id)).toEqual([active])
    })
  })

  describe('markQueriesFetched', () => {
    it('advances only the named queries', async () => {
      const { queryIds } = await makeTopic([
        { expression: 'qA' },
        { expression: 'qB' },
        { expression: 'qC' },
      ])
      const at = new Date('2026-07-09T12:00:00Z')

      await store.markQueriesFetched([queryIds[0], queryIds[2]], at)

      const rows = await db.select().from(topicQueries).orderBy(topicQueries.id)
      expect(rows[0].lastFetchedAt?.toISOString()).toBe(at.toISOString())
      expect(rows[1].lastFetchedAt).toBeNull()
      expect(rows[2].lastFetchedAt?.toISOString()).toBe(at.toISOString())
    })

    it('is a no-op for an empty list', async () => {
      await makeTopic()
      await expect(store.markQueriesFetched([], new Date())).resolves.toBeUndefined()
    })
  })

  describe('run bookkeeping', () => {
    it('ignores in-progress runs when reading the resume cursor', async () => {
      const finished = await store.startRun()
      await store.finishRun(finished, {
        status: 'partial',
        topicsProcessed: 1,
        papersFound: 3,
        resumeCursor: 7,
        error: null,
      })
      // A run opened afterwards must not mask the cursor above.
      await store.startRun()

      expect(await store.previousResumeCursor()).toBe(7)
    })

    it('reports no cursor once a later run completes', async () => {
      const partial = await store.startRun()
      await store.finishRun(partial, {
        status: 'partial',
        topicsProcessed: 0,
        papersFound: 0,
        resumeCursor: 5,
        error: null,
      })
      const complete = await store.startRun()
      await store.finishRun(complete, {
        status: 'completed',
        topicsProcessed: 2,
        papersFound: 0,
        resumeCursor: null,
        error: null,
      })

      expect(await store.previousResumeCursor()).toBeNull()
    })

    it('persists the run summary', async () => {
      const runId = await store.startRun()
      await store.finishRun(runId, {
        status: 'failed',
        topicsProcessed: 1,
        papersFound: 2,
        resumeCursor: null,
        error: 'arXiv is down',
      })

      const [row] = await db.select().from(ingestRuns)
      expect(row.status).toBe('failed')
      expect(row.error).toBe('arXiv is down')
      expect(row.papersFound).toBe(2)
      expect(row.finishedAt).not.toBeNull()
    })
  })

  describe('runIngest against the real store', () => {
    it('ingests, embeds, scores, advances watermarks; a rerun finds nothing new', async () => {
      await makeTopic([{ expression: 'qA' }, { expression: 'qB' }])

      const search = async () => [paper('1'), paper('2')]
      const embedBatch: NonNullable<IngestDeps['embedBatch']> = async (texts) =>
        texts.map((t) => (t.includes('Title 1') ? [1, 0] : [0, 1]))
      const embedText: NonNullable<IngestDeps['embedText']> = async () => [1, 0]

      const first = await runIngest(store, { search, embedBatch, embedText })

      expect(first.status).toBe('completed')
      expect(first.papersFound).toBe(2)
      expect(first.topicsProcessed).toBe(1)

      const links = await db.select().from(topicPapers)
      expect(links).toHaveLength(2)
      expect(links.every((l) => l.firstSeenRunId === first.runId)).toBe(true)
      // '1' matches the topic embedding exactly (cosine 1); '2' is orthogonal (cosine 0).
      const paperRows = await db.select().from(papers)
      const idByArxiv = new Map(paperRows.map((r) => [r.arxivId, r.id]))
      const scoreByPaperId = new Map(links.map((l) => [l.paperId, l.relevanceScore]))
      expect(scoreByPaperId.get(idByArxiv.get('1')!)).toBeGreaterThan(
        scoreByPaperId.get(idByArxiv.get('2')!)!,
      )
      expect(paperRows.every((r) => r.embedding !== null)).toBe(true)

      const queries = await db.select().from(topicQueries)
      expect(queries.every((q) => q.lastFetchedAt !== null)).toBe(true)

      const second = await runIngest(store, { search, embedBatch, embedText })
      expect(second.papersFound).toBe(0)
      expect(await db.select().from(topicPapers)).toHaveLength(2)
      expect(second.resumeCursor).toBeNull()
    })

    it('backfills a query added after the topic was already searched', async () => {
      const watermark = new Date('2026-07-01T00:00:00Z')
      await makeTopic([{ expression: 'established', lastFetchedAt: watermark }])

      // Simulate the user adding a query later: it has no watermark.
      const [{ topicId }] = await db.select({ topicId: topics.id }).from(topics)
      await db.insert(topicQueries).values({ topicId, expression: 'added-later' })

      const sinceByExpression = new Map<string, Date | null>()
      const search = async (expression: string, opts?: { since?: Date | null }) => {
        sinceByExpression.set(expression, opts?.since ?? null)
        return []
      }

      await runIngest(store, { search, embedText: stubEmbedText, embedBatch: stubEmbedBatch })

      expect(sinceByExpression.get('established')?.toISOString()).toBe(watermark.toISOString())
      // The new query has no lower bound, so it searches all of arXiv.
      expect(sinceByExpression.get('added-later')).toBeNull()
    })

    it('keeps finished queries progress when the budget truncates the topic', async () => {
      const { queryIds } = await makeTopic([
        { expression: 'qA' },
        { expression: 'qB' },
        { expression: 'qC' },
      ])
      let t = 0
      const now = () => {
        const current = t
        t += 5_000
        return current
      }

      const summary = await runIngest(store, {
        search: async () => [paper('1')],
        embedText: stubEmbedText,
        embedBatch: stubEmbedBatch,
        now,
        budgetMs: 12_000,
      })

      expect(summary.status).toBe('partial')

      const rows = await db.select().from(topicQueries).orderBy(topicQueries.id)
      // Only qA ran: its watermark advanced, the others stayed null.
      expect(rows[0].lastFetchedAt).not.toBeNull()
      expect(rows[1].lastFetchedAt).toBeNull()
      expect(rows[2].lastFetchedAt).toBeNull()
      expect(summary.resumeCursor).toBe(rows[0].topicId)
      expect(queryIds).toHaveLength(3)

      // The paper fetched before the cutoff was still saved.
      expect(await db.select().from(topicPapers)).toHaveLength(1)
    })
  })
})
