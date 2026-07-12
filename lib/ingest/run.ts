import { MAX_RESULTS_CEILING, searchArxiv } from '@/lib/arxiv'
import { cosineSimilarity, embedBatch, embedText, similarityToScore } from '@/lib/embeddings'
import { dedupeFound, rotateToCursor } from './plan'
import type { FoundPaper, IngestStore, IngestTopic, NewLink, RunStatus, RunSummary } from './types'

/**
 * Assumed wall-clock cost of one arXiv request: the mandated 3s of spacing plus
 * headroom for the request itself. Used only to decide whether the *next*
 * request still fits in the budget.
 */
const ESTIMATED_REQUEST_MS = 5_000

/**
 * Vercel Hobby caps a function at 300s. We stop starting new work at 210s,
 * leaving headroom for the in-flight topic's request to finish before the
 * platform kills us.
 */
export const DEFAULT_BUDGET_MS = 210_000

export interface IngestDeps {
  search?: typeof searchArxiv
  embedText?: typeof embedText
  embedBatch?: typeof embedBatch
  now?: () => number
  budgetMs?: number
  maxResultsPerQuery?: number
}

interface TopicFetch {
  found: FoundPaper[]
  /** Queries whose search completed, and whose watermark may therefore advance. */
  completedQueryIds: number[]
  complete: boolean
}

/**
 * Fetch every query of one topic, each from its own watermark, stopping early if
 * the budget runs out.
 */
async function fetchTopic(
  topic: IngestTopic,
  until: Date,
  deadline: number,
  deps: Required<Pick<IngestDeps, 'search' | 'now' | 'maxResultsPerQuery'>>,
): Promise<TopicFetch> {
  const found: FoundPaper[] = []
  const completedQueryIds: number[] = []

  for (const query of topic.queries) {
    if (deps.now() + ESTIMATED_REQUEST_MS > deadline) {
      return { found, completedQueryIds, complete: false }
    }

    // A query with no watermark has never run, so it backfills over all time.
    const papers = await deps.search(query.expression, {
      since: query.lastFetchedAt,
      until,
      maxResults: deps.maxResultsPerQuery,
    })

    for (const paper of papers) found.push({ paper, matchedQuery: query.expression })
    completedQueryIds.push(query.id)
  }

  return { found, completedQueryIds, complete: true }
}

/**
 * Embed each new link's title+abstract and the topic's description, then score
 * every link by cosine similarity against the topic. Embeddings are persisted
 * on the paper (shared across topics); scores are persisted on the link (topic-
 * specific), since the same paper can rank differently for a different topic.
 */
async function scoreNewLinks(
  topic: IngestTopic,
  newLinks: NewLink[],
  store: IngestStore,
  deps: Required<Pick<IngestDeps, 'embedText' | 'embedBatch'>>,
): Promise<void> {
  if (newLinks.length === 0) return

  const [paperEmbeddings, topicEmbedding] = await Promise.all([
    deps.embedBatch(newLinks.map((l) => `${l.title}\n\n${l.abstract}`)),
    deps.embedText(topic.description),
  ])

  await store.saveEmbeddings(
    newLinks.map((l, i) => ({ paperId: l.paperId, embedding: paperEmbeddings[i] })),
  )

  await store.saveScores(
    topic.id,
    newLinks.map((l, i) => ({
      paperId: l.paperId,
      score: similarityToScore(cosineSimilarity(topicEmbedding, paperEmbeddings[i])),
    })),
  )
}

/**
 * Run one ingestion pass over every active topic, or just `topicId` when given.
 *
 * Watermarks are per-query, so a topic cut short by the budget keeps the
 * progress of the queries that did finish; only the unreached ones re-run next
 * time. A query that has never run has no watermark and backfills, which is what
 * makes adding a query to an existing topic actually find its older papers.
 */
export async function runIngest(
  store: IngestStore,
  deps: IngestDeps = {},
  topicId?: number,
): Promise<RunSummary> {
  const search = deps.search ?? searchArxiv
  const embedTextFn = deps.embedText ?? embedText
  const embedBatchFn = deps.embedBatch ?? embedBatch
  const now = deps.now ?? Date.now
  // A query with no watermark backfills over all of arXiv's history in one call,
  // so it should ask for as much as a single arXiv request allows, not a small
  // page size meant for incremental updates.
  const maxResultsPerQuery = deps.maxResultsPerQuery ?? MAX_RESULTS_CEILING
  const budgetMs = deps.budgetMs ?? DEFAULT_BUDGET_MS

  const runId = await store.startRun()
  // One clock read, so the search window and the deadline share an origin.
  const startedAt = now()
  const until = new Date(startedAt)
  const deadline = startedAt + budgetMs

  let status: RunStatus = 'completed'
  let topicsProcessed = 0
  let papersFound = 0
  let resumeCursor: number | null = null
  let error: string | null = null

  try {
    const cursor = await store.previousResumeCursor()
    const ordered = rotateToCursor(await store.listActiveTopics(topicId), cursor)

    for (const topic of ordered) {
      const { found, completedQueryIds, complete } = await fetchTopic(topic, until, deadline, {
        search,
        now,
        maxResultsPerQuery,
      })

      // Persist whatever we did fetch, even for a truncated topic.
      const newLinks = await store.recordPapers(topic.id, dedupeFound(found), runId)
      papersFound += newLinks.length

      await scoreNewLinks(topic, newLinks, store, {
        embedText: embedTextFn,
        embedBatch: embedBatchFn,
      })

      // Only queries whose search finished may advance; an unreached query keeps
      // its old watermark and re-runs next time.
      if (completedQueryIds.length > 0) {
        await store.markQueriesFetched(completedQueryIds, until)
      }

      if (!complete) {
        status = 'partial'
        resumeCursor = topic.id
        break
      }

      topicsProcessed += 1
    }
  } catch (err) {
    status = 'failed'
    error = err instanceof Error ? err.message : String(err)
  }

  const summary: Omit<RunSummary, 'runId'> = {
    status,
    topicsProcessed,
    papersFound,
    resumeCursor,
    error,
  }
  await store.finishRun(runId, summary)

  return { runId, ...summary }
}
