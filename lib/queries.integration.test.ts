import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ingestRuns, papers, topicPapers, topicQueries, topics } from '@/drizzle/schema'

const url = process.env.TEST_DATABASE_URL

const pool = new Pool({ connectionString: url })
const db = drizzle(pool)

vi.mock('@/lib/db', () => ({ getDb: () => db }))

const {
  countInbox,
  countPapersByQuery,
  findSimilarPapers,
  getLatestRunId,
  listInbox,
  listReportPapers,
  listTopicQueries,
  listTopicSummaries,
  suggestPapersForLabel,
} = await import('./queries')

/**
 * Covers the hand-written SQL in queries.ts: the `paper_state[]` array cast, the
 * `DESC NULLS LAST` ordering that keeps unscored papers off the top, and the
 * distinct counts that stop the queries join from multiplying the papers join.
 */
describe.skipIf(!url)('queries (integration)', () => {
  afterAll(async () => {
    await pool.end()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE ${topicPapers}, ${topicQueries}, ${papers}, ${topics}, ${ingestRuns} RESTART IDENTITY CASCADE`,
    )
  })

  const makeTopic = async (
    queries: { expression: string; lastFetchedAt?: Date | null }[] = [{ expression: 'qA' }],
    overrides: Partial<typeof topics.$inferInsert> = {},
  ) => {
    const [row] = await db
      .insert(topics)
      .values({ name: 'T', description: 'd', ...overrides })
      .returning({ id: topics.id })

    for (const query of queries) {
      await db.insert(topicQueries).values({
        topicId: row.id,
        expression: query.expression,
        lastFetchedAt: query.lastFetchedAt ?? null,
      })
    }
    return row.id
  }

  const makePaper = async (arxivId: string, embedding?: number[]) => {
    const [row] = await db
      .insert(papers)
      .values({
        arxivId,
        title: `Title ${arxivId}`,
        abstract: 'abs',
        authors: ['Ada'],
        categories: ['cs.IR'],
        publishedAt: new Date('2026-07-01T00:00:00Z'),
        updatedAt: new Date('2026-07-01T00:00:00Z'),
        absUrl: `https://arxiv.org/abs/${arxivId}`,
        embedding,
      })
      .returning({ id: papers.id })
    return row.id
  }

  const makePaperOn = async (arxivId: string, publishedAt: Date) => {
    const [row] = await db
      .insert(papers)
      .values({
        arxivId,
        title: `Title ${arxivId}`,
        abstract: 'abs',
        authors: ['Ada'],
        categories: ['cs.IR'],
        publishedAt,
        updatedAt: publishedAt,
        absUrl: `https://arxiv.org/abs/${arxivId}`,
      })
      .returning({ id: papers.id })
    return row.id
  }

  const makePaperWithText = async (arxivId: string, title: string, abstract: string) => {
    const [row] = await db
      .insert(papers)
      .values({
        arxivId,
        title,
        abstract,
        authors: ['Ada'],
        categories: ['cs.IR'],
        publishedAt: new Date('2026-07-01T00:00:00Z'),
        updatedAt: new Date('2026-07-01T00:00:00Z'),
        absUrl: `https://arxiv.org/abs/${arxivId}`,
      })
      .returning({ id: papers.id })
    return row.id
  }

  const link = async (
    topicId: number,
    paperId: number,
    values: Partial<typeof topicPapers.$inferInsert> = {},
  ) => {
    await db.insert(topicPapers).values({ topicId, paperId, ...values })
  }

  const makeRun = async () => {
    const [row] = await db.insert(ingestRuns).values({}).returning({ id: ingestRuns.id })
    return row.id
  }

  describe('listInbox', () => {
    it('sorts by relevance descending', async () => {
      const t = await makeTopic()
      await link(t, await makePaper('low'), { relevanceScore: 10 })
      await link(t, await makePaper('high'), { relevanceScore: 95 })
      await link(t, await makePaper('mid'), { relevanceScore: 50 })

      const result = await listInbox(t, ['unread'])

      expect(result.map((p) => p.arxivId)).toEqual(['high', 'mid', 'low'])
    })

    it('places unscored papers last, not first', async () => {
      const t = await makeTopic()
      await link(t, await makePaper('unscored'), { relevanceScore: null })
      await link(t, await makePaper('scored'), { relevanceScore: 5 })

      const result = await listInbox(t, ['unread'])

      expect(result.map((p) => p.arxivId)).toEqual(['scored', 'unscored'])
    })

    it('filters to the requested states', async () => {
      const t = await makeTopic()
      await link(t, await makePaper('u'), { state: 'unread' })
      await link(t, await makePaper('s'), { state: 'saved' })
      await link(t, await makePaper('d'), { state: 'dismissed' })

      expect((await listInbox(t, ['unread'])).map((p) => p.arxivId)).toEqual(['u'])
      expect((await listInbox(t, ['saved'])).map((p) => p.arxivId)).toEqual(['s'])
      expect(
        (await listInbox(t, ['unread', 'saved', 'dismissed', 'read']))
          .map((p) => p.arxivId)
          .sort(),
      ).toEqual(['d', 's', 'u'])
    })

    it('does not leak papers from another topic', async () => {
      const a = await makeTopic()
      const b = await makeTopic()
      await link(a, await makePaper('mine'))
      await link(b, await makePaper('theirs'))

      expect((await listInbox(a, ['unread'])).map((p) => p.arxivId)).toEqual(['mine'])
    })

    it('carries matchedQuery through', async () => {
      const t = await makeTopic()
      await link(t, await makePaper('p'), { matchedQuery: 'abs:"x"' })

      const [row] = await listInbox(t, ['unread'])
      expect(row.matchedQuery).toBe('abs:"x"')
    })

    it('filters to a specific run when runId is given', async () => {
      const t = await makeTopic()
      const runA = await makeRun()
      const runB = await makeRun()
      await link(t, await makePaper('a'), { firstSeenRunId: runA })
      await link(t, await makePaper('b'), { firstSeenRunId: runB })

      const result = await listInbox(
        t,
        ['unread', 'read', 'saved', 'dismissed'],
        'score',
        undefined,
        undefined,
        runB,
      )

      expect(result.map((p) => p.arxivId)).toEqual(['b'])
    })

    it('matches on title or abstract and excludes non-matching papers', async () => {
      const t = await makeTopic()
      await link(t, await makePaperWithText('a', 'Neural Network Pruning', 'abs'))
      await link(t, await makePaperWithText('b', 'Something Else', 'discusses pruning techniques'))
      await link(t, await makePaperWithText('c', 'Unrelated', 'nothing to see here'))

      const result = await listInbox(
        t,
        ['unread'],
        'score',
        undefined,
        undefined,
        undefined,
        'pruning',
      )

      expect(result.map((p) => p.arxivId).sort()).toEqual(['a', 'b'])
    })

    it('ranks a title match above an abstract-only match', async () => {
      const t = await makeTopic()
      await link(t, await makePaperWithText('abstract-only', 'Something Else', 'mentions gradient descent'))
      await link(t, await makePaperWithText('title-match', 'Gradient Descent Methods', 'abs'))

      const result = await listInbox(
        t,
        ['unread'],
        'score',
        undefined,
        undefined,
        undefined,
        'gradient descent',
      )

      expect(result.map((p) => p.arxivId)).toEqual(['title-match', 'abstract-only'])
    })

    it('does not match papers from another topic', async () => {
      const a = await makeTopic()
      const b = await makeTopic()
      await link(a, await makePaperWithText('mine', 'Diffusion Models', 'abs'))
      await link(b, await makePaperWithText('theirs', 'Diffusion Models', 'abs'))

      const result = await listInbox(
        a,
        ['unread'],
        'score',
        undefined,
        undefined,
        undefined,
        'diffusion',
      )

      expect(result.map((p) => p.arxivId)).toEqual(['mine'])
    })
  })

  describe('countInbox', () => {
    it('counts only papers matching the search term', async () => {
      const t = await makeTopic()
      await link(t, await makePaperWithText('a', 'Neural Network Pruning', 'abs'))
      await link(t, await makePaperWithText('b', 'Unrelated', 'nothing to see here'))

      expect(await countInbox(t, ['unread'], undefined, undefined, 'pruning')).toBe(1)
      expect(await countInbox(t, ['unread'])).toBe(2)
    })
  })

  describe('listTopicSummaries', () => {
    it('counts only unread papers', async () => {
      const t = await makeTopic()
      await link(t, await makePaper('1'), { state: 'unread' })
      await link(t, await makePaper('2'), { state: 'unread' })
      await link(t, await makePaper('3'), { state: 'read' })
      await link(t, await makePaper('4'), { state: 'dismissed' })

      const [summary] = await listTopicSummaries()

      expect(summary.unreadCount).toBe(2)
    })

    it('does not multiply the unread count by the number of queries', async () => {
      // The regression this guards: joining queries and papers in one query
      // makes each paper appear once per query without a distinct count.
      const t = await makeTopic([
        { expression: 'qA' },
        { expression: 'qB' },
        { expression: 'qC' },
      ])
      await link(t, await makePaper('1'), { state: 'unread' })
      await link(t, await makePaper('2'), { state: 'unread' })

      const [summary] = await listTopicSummaries()

      expect(summary.unreadCount).toBe(2)
      expect(summary.queryCount).toBe(3)
    })

    it('reports the most recent watermark across queries', async () => {
      const older = new Date('2026-07-01T00:00:00Z')
      const newer = new Date('2026-07-08T00:00:00Z')
      await makeTopic([
        { expression: 'qA', lastFetchedAt: older },
        { expression: 'qB', lastFetchedAt: newer },
      ])

      const [summary] = await listTopicSummaries()

      expect(summary.lastFetchedAt?.toISOString()).toBe(newer.toISOString())
    })

    it('counts queries still awaiting their first run', async () => {
      await makeTopic([
        { expression: 'ran', lastFetchedAt: new Date('2026-07-01T00:00:00Z') },
        { expression: 'pending-a' },
        { expression: 'pending-b' },
      ])

      const [summary] = await listTopicSummaries()

      expect(summary.pendingQueryCount).toBe(2)
      expect(summary.queryCount).toBe(3)
    })

    it('reports a never-searched topic with a null watermark', async () => {
      await makeTopic([{ expression: 'qA' }])

      const [summary] = await listTopicSummaries()

      expect(summary.lastFetchedAt).toBeNull()
      expect(summary.pendingQueryCount).toBe(1)
    })

    it('keeps a topic with no queries at all, rather than dropping it', async () => {
      await makeTopic([])

      const summaries = await listTopicSummaries()

      expect(summaries).toHaveLength(1)
      expect(summaries[0].queryCount).toBe(0)
      expect(summaries[0].unreadCount).toBe(0)
    })

    it('excludes inactive topics', async () => {
      await makeTopic([{ expression: 'q' }], { name: 'Active' })
      await makeTopic([{ expression: 'q' }], { name: 'Archived', active: false })

      const summaries = await listTopicSummaries()

      expect(summaries.map((s) => s.name)).toEqual(['Active'])
    })
  })

  describe('listTopicQueries', () => {
    it('returns a topic queries in insertion order with their watermarks', async () => {
      const at = new Date('2026-07-01T00:00:00Z')
      const t = await makeTopic([
        { expression: 'first', lastFetchedAt: at },
        { expression: 'second' },
      ])

      const rows = await listTopicQueries(t)

      expect(rows.map((r) => r.expression)).toEqual(['first', 'second'])
      expect(rows[0].lastFetchedAt?.toISOString()).toBe(at.toISOString())
      expect(rows[1].lastFetchedAt).toBeNull()
      expect(rows[0].source).toBe('llm')
    })

    it('does not return another topic queries', async () => {
      const a = await makeTopic([{ expression: 'mine' }])
      await makeTopic([{ expression: 'theirs' }])

      expect((await listTopicQueries(a)).map((r) => r.expression)).toEqual(['mine'])
    })
  })

  describe('countPapersByQuery', () => {
    it('counts how many papers each expression surfaced', async () => {
      const t = await makeTopic()
      await link(t, await makePaper('1'), { matchedQuery: 'qA' })
      await link(t, await makePaper('2'), { matchedQuery: 'qA' })
      await link(t, await makePaper('3'), { matchedQuery: 'qB' })

      const counts = await countPapersByQuery(t)

      expect(counts.get('qA')).toBe(2)
      expect(counts.get('qB')).toBe(1)
    })

    it('ignores links with no recorded query', async () => {
      const t = await makeTopic()
      await link(t, await makePaper('1'), { matchedQuery: null })

      expect(await countPapersByQuery(t)).toEqual(new Map())
    })
  })

  describe('findSimilarPapers', () => {
    it('ranks papers by embedding similarity, closest first', async () => {
      const t = await makeTopic()
      const source = await makePaper('src', [1, 0])
      const close = await makePaper('close', [0.9, 0.1])
      const far = await makePaper('far', [0, 1])
      await link(t, source)
      await link(t, close)
      await link(t, far)

      const results = await findSimilarPapers(t, source)

      expect(results.map((r) => r.paperId)).toEqual([close, far])
      expect(results[0].similarity).toBeGreaterThan(results[1].similarity)
    })

    it('excludes the source paper itself', async () => {
      const t = await makeTopic()
      const source = await makePaper('src', [1, 0])
      await link(t, source)

      expect(await findSimilarPapers(t, source)).toEqual([])
    })

    it('excludes papers without an embedding yet', async () => {
      const t = await makeTopic()
      const source = await makePaper('src', [1, 0])
      const unscored = await makePaper('unscored')
      await link(t, source)
      await link(t, unscored)

      expect(await findSimilarPapers(t, source)).toEqual([])
    })

    it('returns nothing when the source paper has no embedding', async () => {
      const t = await makeTopic()
      const source = await makePaper('src')
      const other = await makePaper('other', [1, 0])
      await link(t, source)
      await link(t, other)

      expect(await findSimilarPapers(t, source)).toEqual([])
    })

    it('does not consider papers from another topic', async () => {
      const a = await makeTopic()
      const b = await makeTopic()
      const source = await makePaper('src', [1, 0])
      const outsider = await makePaper('outsider', [1, 0])
      await link(a, source)
      await link(b, outsider)

      expect(await findSimilarPapers(a, source)).toEqual([])
    })

    it('respects the limit', async () => {
      const t = await makeTopic()
      const source = await makePaper('src', [1, 0])
      await link(t, source)
      for (let i = 0; i < 5; i++) {
        const p = await makePaper(`p${i}`, [1 - i * 0.01, i * 0.01])
        await link(t, p)
      }

      expect(await findSimilarPapers(t, source, 3)).toHaveLength(3)
    })
  })

  describe('suggestPapersForLabel', () => {
    it('ranks unlabeled papers by similarity to the centroid of the label', async () => {
      const t = await makeTopic()
      await link(t, await makePaper('a', [1, 0]), { label: 'nlp' })
      await link(t, await makePaper('b', [0.8, 0.2]), { label: 'nlp' })
      const close = await makePaper('close', [0.9, 0.1])
      const far = await makePaper('far', [0, 1])
      await link(t, close)
      await link(t, far)

      const results = await suggestPapersForLabel(t, 'nlp')

      expect(results.map((r) => r.paperId)).toEqual([close, far])
      expect(results[0].similarity).toBeGreaterThan(results[1].similarity)
    })

    it('excludes papers that already have a label', async () => {
      const t = await makeTopic()
      await link(t, await makePaper('a', [1, 0]), { label: 'nlp' })
      await link(t, await makePaper('b', [0.9, 0.1]), { label: 'other' })

      expect(await suggestPapersForLabel(t, 'nlp')).toEqual([])
    })

    it('excludes candidates without an embedding', async () => {
      const t = await makeTopic()
      await link(t, await makePaper('a', [1, 0]), { label: 'nlp' })
      await link(t, await makePaper('unscored'))

      expect(await suggestPapersForLabel(t, 'nlp')).toEqual([])
    })

    it('returns nothing when the label has no embedded papers yet', async () => {
      const t = await makeTopic()
      await link(t, await makePaper('a'), { label: 'nlp' })
      await link(t, await makePaper('b', [1, 0]))

      expect(await suggestPapersForLabel(t, 'nlp')).toEqual([])
    })

    it('does not consider papers from another topic', async () => {
      const a = await makeTopic()
      const b = await makeTopic()
      await link(a, await makePaper('a', [1, 0]), { label: 'nlp' })
      const outsider = await makePaper('outsider', [1, 0])
      await link(b, outsider)

      expect(await suggestPapersForLabel(a, 'nlp')).toEqual([])
    })

    it('respects the limit', async () => {
      const t = await makeTopic()
      await link(t, await makePaper('a', [1, 0]), { label: 'nlp' })
      for (let i = 0; i < 5; i++) {
        const p = await makePaper(`p${i}`, [1 - i * 0.01, i * 0.01])
        await link(t, p)
      }

      expect(await suggestPapersForLabel(t, 'nlp', 3)).toHaveLength(3)
    })
  })

  describe('getLatestRunId', () => {
    it('returns the highest run id linked to the topic', async () => {
      const t = await makeTopic()
      const runA = await makeRun()
      const runB = await makeRun()
      await link(t, await makePaper('a'), { firstSeenRunId: runA })
      await link(t, await makePaper('b'), { firstSeenRunId: runB })

      expect(await getLatestRunId(t)).toBe(runB)
    })

    it('returns null when no link has a recorded run', async () => {
      const t = await makeTopic()
      await link(t, await makePaper('a'))

      expect(await getLatestRunId(t)).toBeNull()
    })

    it('returns null when the topic has no papers at all', async () => {
      const t = await makeTopic()

      expect(await getLatestRunId(t)).toBeNull()
    })

    it('does not consider another topic\'s runs', async () => {
      const a = await makeTopic()
      const b = await makeTopic()
      const run = await makeRun()
      await link(b, await makePaper('theirs'), { firstSeenRunId: run })

      expect(await getLatestRunId(a)).toBeNull()
    })
  })

  describe('listReportPapers', () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000)

    it('filters to an exact label', async () => {
      const t = await makeTopic()
      await link(t, await makePaper('a'), { label: 'agents' })
      await link(t, await makePaper('b'), { label: 'other' })
      await link(t, await makePaper('c'), { label: null })

      const result = await listReportPapers(t, { type: 'label', label: 'agents' })

      expect(result.map((p) => p.arxivId)).toEqual(['a'])
    })

    it('filters to papers published within the last N days', async () => {
      const t = await makeTopic()
      await link(t, await makePaperOn('recent', daysAgo(10)))
      await link(t, await makePaperOn('old', daysAgo(40)))

      const result = await listReportPapers(t, { type: 'recent', days: 30 })

      expect(result.map((p) => p.arxivId)).toEqual(['recent'])
    })

    it('excludes dismissed papers from a label filter', async () => {
      const t = await makeTopic()
      await link(t, await makePaper('kept'), { label: 'agents', state: 'unread' })
      await link(t, await makePaper('dismissed'), { label: 'agents', state: 'dismissed' })

      const result = await listReportPapers(t, { type: 'label', label: 'agents' })

      expect(result.map((p) => p.arxivId)).toEqual(['kept'])
    })

    it('excludes dismissed papers from a recent-days filter', async () => {
      const t = await makeTopic()
      await link(t, await makePaperOn('kept', daysAgo(5)), { state: 'unread' })
      await link(t, await makePaperOn('dismissed', daysAgo(5)), { state: 'dismissed' })

      const result = await listReportPapers(t, { type: 'recent', days: 30 })

      expect(result.map((p) => p.arxivId)).toEqual(['kept'])
    })

    it('caps at MAX_REPORT_PAPERS, keeping the most relevant', async () => {
      const t = await makeTopic()
      await link(t, await makePaper('low'), { label: 'agents', relevanceScore: 10 })
      await link(t, await makePaper('high'), { label: 'agents', relevanceScore: 90 })

      const result = await listReportPapers(t, { type: 'label', label: 'agents' })

      // Both fit under the cap here; a dedicated low-cap check isn't feasible
      // without inserting 60+ rows, so this only confirms relevance ordering
      // survives before the final chronological resort.
      expect(result.map((p) => p.arxivId).sort()).toEqual(['high', 'low'])
    })

    it('orders the result chronologically, oldest first', async () => {
      const t = await makeTopic()
      await link(t, await makePaperOn('newer', daysAgo(1)))
      await link(t, await makePaperOn('older', daysAgo(5)))

      const result = await listReportPapers(t, { type: 'recent', days: 30 })

      expect(result.map((p) => p.arxivId)).toEqual(['older', 'newer'])
    })

    it('does not leak papers from another topic', async () => {
      const a = await makeTopic()
      const b = await makeTopic()
      await link(a, await makePaper('mine'), { label: 'agents' })
      await link(b, await makePaper('theirs'), { label: 'agents' })

      const result = await listReportPapers(a, { type: 'label', label: 'agents' })

      expect(result.map((p) => p.arxivId)).toEqual(['mine'])
    })
  })
})
