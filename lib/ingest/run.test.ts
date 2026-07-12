import { describe, expect, it, vi } from 'vitest'
import { MAX_RESULTS_CEILING, type ArxivPaper } from '@/lib/arxiv'
import { runIngest, type IngestDeps } from './run'
import type {
  EmbeddingUpdate,
  FoundPaper,
  IngestStore,
  IngestTopic,
  NewLink,
  RunSummary,
  ScoreUpdate,
} from './types'

const paper = (arxivId: string): ArxivPaper => ({
  arxivId,
  version: 1,
  title: `Title ${arxivId}`,
  abstract: `Abstract ${arxivId}`,
  authors: ['A'],
  categories: ['cs.IR'],
  publishedAt: new Date('2026-07-01T00:00:00Z'),
  updatedAt: new Date('2026-07-01T00:00:00Z'),
  absUrl: `https://arxiv.org/abs/${arxivId}`,
  pdfUrl: null,
})

/** Queries are given ids 1..n within a topic, matching insertion order. */
const topic = (
  id: number,
  queries: { expression: string; lastFetchedAt?: Date | null }[],
): IngestTopic => ({
  id,
  description: `topic ${id}`,
  queries: queries.map((q, i) => ({
    id: id * 100 + i,
    expression: q.expression,
    lastFetchedAt: q.lastFetchedAt ?? null,
  })),
})

const q = (expression: string, lastFetchedAt: Date | null = null) => ({
  expression,
  lastFetchedAt,
})

function fakeStore(topics: IngestTopic[], resumeCursor: number | null = null) {
  let nextPaperId = 1
  const linked = new Map<number, Set<string>>()

  const calls = {
    recorded: [] as { topicId: number; arxivIds: string[]; queries: string[]; runId?: number }[],
    embedded: [] as EmbeddingUpdate[],
    scored: [] as { topicId: number; updates: ScoreUpdate[] }[],
    marked: [] as { queryIds: number[]; at: Date }[],
    finished: [] as Omit<RunSummary, 'runId'>[],
  }

  const store: IngestStore = {
    listActiveTopics: async () => topics,
    previousResumeCursor: async () => resumeCursor,
    startRun: async () => 42,
    finishRun: async (_runId, summary) => void calls.finished.push(summary),
    recordPapers: async (topicId, found: FoundPaper[], runId?: number) => {
      const already = linked.get(topicId) ?? new Set<string>()
      const fresh: NewLink[] = []
      for (const f of found) {
        if (already.has(f.paper.arxivId)) continue
        already.add(f.paper.arxivId)
        fresh.push({
          paperId: nextPaperId++,
          arxivId: f.paper.arxivId,
          title: f.paper.title,
          abstract: f.paper.abstract,
        })
      }
      linked.set(topicId, already)
      calls.recorded.push({
        topicId,
        arxivIds: found.map((f) => f.paper.arxivId),
        queries: found.map((f) => f.matchedQuery),
        runId,
      })
      return fresh
    },
    saveEmbeddings: async (updates) => void calls.embedded.push(...updates),
    saveScores: async (topicId, updates) => void calls.scored.push({ topicId, updates }),
    markQueriesFetched: async (queryIds, at) => void calls.marked.push({ queryIds, at }),
  }

  return { store, calls }
}

/** Clock that advances a fixed amount every time it is read. */
function fakeClock(startMs: number, stepMs: number) {
  let t = startMs
  return () => {
    const current = t
    t += stepMs
    return current
  }
}

/** Deterministic 1-dimensional "embeddings": the fixture never needs real semantics. */
const stubEmbedText: NonNullable<IngestDeps['embedText']> = async () => [0]
const stubEmbedBatch: NonNullable<IngestDeps['embedBatch']> = async (texts) =>
  texts.map(() => [0])

/** Runs `runIngest` with stub embedders wired in by default, so tests unrelated to scoring don't need to care. */
function run(store: IngestStore, deps: IngestDeps = {}) {
  return runIngest(store, {
    embedText: stubEmbedText,
    embedBatch: stubEmbedBatch,
    ...deps,
  })
}

type IngestDepsSearch = NonNullable<IngestDeps['search']>
const markedIds = (calls: { marked: { queryIds: number[] }[] }) =>
  calls.marked.flatMap((m) => m.queryIds)

describe('runIngest', () => {
  it('fetches every query of every topic and marks each fetched', async () => {
    const { store, calls } = fakeStore([
      topic(1, [q('qA'), q('qB')]),
      topic(2, [q('qC')]),
    ])
    const search = vi.fn<IngestDepsSearch>(async (e) => [paper(`p-${e}`)])

    const summary = await run(store, { search, now: () => 0 })

    expect(search).toHaveBeenCalledTimes(3)
    expect(summary.status).toBe('completed')
    expect(summary.topicsProcessed).toBe(2)
    expect(summary.papersFound).toBe(3)
    expect(markedIds(calls)).toEqual([100, 101, 200])
  })

  it('stamps every recorded link with this run\'s id', async () => {
    const { store, calls } = fakeStore([topic(1, [q('qA')])])

    await run(store, { search: async () => [paper('p')], now: () => 0 })

    expect(calls.recorded.every((r) => r.runId === 42)).toBe(true)
  })

  describe('per-query watermarks', () => {
    it('searches each query from its own watermark', async () => {
      const older = new Date('2026-06-01T00:00:00Z')
      const newer = new Date('2026-07-01T00:00:00Z')
      const { store } = fakeStore([topic(1, [q('qA', older), q('qB', newer)])])
      const search = vi.fn<IngestDepsSearch>(async () => [])

      await run(store, { search, now: () => 0 })

      expect(search.mock.calls[0][1]?.since).toBe(older)
      expect(search.mock.calls[1][1]?.since).toBe(newer)
    })

    it('backfills a newly added query while its siblings fetch only what is new', async () => {
      const watermark = new Date('2026-07-01T00:00:00Z')
      const { store } = fakeStore([
        topic(1, [q('established', watermark), q('brand-new', null)]),
      ])
      const search = vi.fn<IngestDepsSearch>(async () => [])

      await run(store, { search, now: () => 0 })

      expect(search.mock.calls[0][1]?.since).toBe(watermark)
      // No watermark means no lower bound: the new query searches all of arXiv.
      expect(search.mock.calls[1][1]?.since).toBeNull()
    })

    it('defaults maxResults to the arXiv request ceiling, not a small page size', async () => {
      const { store } = fakeStore([topic(1, [q('qA')])])
      const search = vi.fn<IngestDepsSearch>(async () => [])

      await run(store, { search, now: () => 0 })

      expect(search.mock.calls[0][1]?.maxResults).toBe(MAX_RESULTS_CEILING)
    })

    it('advances every completed query to the run start', async () => {
      const { store, calls } = fakeStore([topic(1, [q('qA'), q('qB')])])

      await run(store, {
        search: async () => [],
        now: () => 1_700_000_000_000,
      })

      expect(calls.marked).toHaveLength(1)
      expect(calls.marked[0].queryIds).toEqual([100, 101])
      expect(calls.marked[0].at.getTime()).toBe(1_700_000_000_000)
    })
  })

  it('dedupes a paper found by two queries and attributes it to the first', async () => {
    const { store, calls } = fakeStore([topic(1, [q('qA'), q('qB')])])
    const search = vi.fn(async () => [paper('same')])

    const summary = await run(store, { search, now: () => 0 })

    expect(summary.papersFound).toBe(1)
    expect(calls.recorded[0].arxivIds).toEqual(['same'])
    expect(calls.recorded[0].queries).toEqual(['qA'])
  })

  it('embeds and scores newly linked papers', async () => {
    const { store, calls } = fakeStore([topic(1, [q('qA')])])
    const search = async () => [paper('x'), paper('y')]
    const embedBatch: NonNullable<IngestDeps['embedBatch']> = async (texts) =>
      texts.map((t) => (t.includes('Title x') ? [1, 0] : [0, 1]))
    const embedText: NonNullable<IngestDeps['embedText']> = async () => [1, 0]

    await run(store, { search, embedBatch, embedText, now: () => 0 })

    expect(calls.embedded).toHaveLength(2)
    expect(calls.embedded.map((e) => e.paperId).sort()).toEqual([1, 2])

    expect(calls.scored).toHaveLength(1)
    const [xScore, yScore] = calls.scored[0].updates
    // x's embedding matches the topic's exactly (cosine 1); y's is orthogonal (cosine 0).
    expect(xScore.score).toBeGreaterThan(yScore.score)
  })

  it('does not embed or score when a topic yields no new papers', async () => {
    const { store, calls } = fakeStore([topic(1, [q('qA')])])

    await run(store, { search: async () => [], now: () => 0 })

    expect(calls.embedded).toEqual([])
    expect(calls.scored).toEqual([])
  })

  describe('time budget', () => {
    /**
     * Clock steps 5s per read, matching the orchestrator's assumed per-request
     * cost. With a 12s budget: the check before qA sees 5s (fits), the check
     * before qB sees 10s+5s=15s (does not fit), so only qA runs.
     */
    const budgetedRun = (store: IngestStore, search: IngestDepsSearch) =>
      run(store, {
        search,
        now: fakeClock(0, 5_000),
        budgetMs: 12_000,
      })

    it('stops before a request that would not fit and records a resume cursor', async () => {
      const { store } = fakeStore([topic(1, [q('qA'), q('qB'), q('qC')]), topic(2, [q('qD')])])
      const search = vi.fn<IngestDepsSearch>(async () => [])

      const summary = await budgetedRun(store, search)

      expect(summary.status).toBe('partial')
      expect(summary.resumeCursor).toBe(1)
      expect(summary.topicsProcessed).toBe(0)
      expect(search.mock.calls.map((c) => c[0])).toEqual(['qA'])
    })

    it('advances the queries that finished and leaves the unreached ones alone', async () => {
      const { store, calls } = fakeStore([topic(1, [q('qA'), q('qB'), q('qC')])])

      await budgetedRun(store, async () => [])

      // Only qA ran, so only qA's watermark moves. qB and qC re-run next time.
      expect(markedIds(calls)).toEqual([100])
    })

    it('persists papers fetched before the cutoff', async () => {
      const { store, calls } = fakeStore([topic(1, [q('qA'), q('qB'), q('qC')])])

      const summary = await budgetedRun(store, async (e) => [paper(`p-${e}`)])

      expect(summary.papersFound).toBe(1)
      expect(calls.recorded[0].arxivIds).toEqual(['p-qA'])
    })

    it('does not mark anything when the budget is gone before the first request', async () => {
      const { store, calls } = fakeStore([topic(1, [q('qA')])])

      await run(store, {
        search: async () => [],
        now: fakeClock(0, 5_000),
        budgetMs: 1,
      })

      expect(calls.marked).toEqual([])
    })

    it('resumes at the cursor and wraps around to earlier topics', async () => {
      const { store, calls } = fakeStore(
        [topic(1, [q('qA')]), topic(2, [q('qB')]), topic(3, [q('qC')])],
        3,
      )

      await run(store, { search: async () => [], now: () => 0 })

      expect(markedIds(calls)).toEqual([300, 100, 200])
    })
  })

  it('records a failed run when a dependency throws, without rethrowing', async () => {
    const { store, calls } = fakeStore([topic(1, [q('qA')])])

    const summary = await run(store, {
      search: async () => {
        throw new Error('arXiv is down')
      },
      now: () => 0,
    })

    expect(summary.status).toBe('failed')
    expect(summary.error).toBe('arXiv is down')
    expect(calls.finished[0].status).toBe('failed')
  })

  it('always finishes the run row', async () => {
    const { store, calls } = fakeStore([])
    await run(store, { search: async () => [], now: () => 0 })
    expect(calls.finished).toHaveLength(1)
  })
})
