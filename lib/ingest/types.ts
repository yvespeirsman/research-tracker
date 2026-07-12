import type { ArxivPaper } from '@/lib/arxiv'

export interface IngestQuery {
  id: number
  expression: string
  /** Null means this query has never run and should backfill over all time. */
  lastFetchedAt: Date | null
}

export interface IngestTopic {
  id: number
  description: string
  queries: IngestQuery[]
}

/** A paper as returned by one specific expanded query. */
export interface FoundPaper {
  paper: ArxivPaper
  matchedQuery: string
}

/** A topic↔paper link created by this run — i.e. a paper that is new to the topic. */
export interface NewLink {
  paperId: number
  arxivId: string
  title: string
  abstract: string
}

export interface ScoreUpdate {
  paperId: number
  score: number
}

export interface EmbeddingUpdate {
  paperId: number
  embedding: number[]
}

export type RunStatus = 'completed' | 'partial' | 'failed'

export interface RunSummary {
  runId: number
  status: RunStatus
  topicsProcessed: number
  papersFound: number
  resumeCursor: number | null
  error: string | null
}

/**
 * Everything ingestion needs from the database. Keeping this an interface lets
 * the orchestrator's budget and resume logic be tested without a live Postgres.
 */
export interface IngestStore {
  /** All active topics, or just one when `topicId` is given. */
  listActiveTopics(topicId?: number): Promise<IngestTopic[]>
  /** Where the previous run ran out of time, if it did. */
  previousResumeCursor(): Promise<number | null>
  startRun(): Promise<number>
  finishRun(runId: number, summary: Omit<RunSummary, 'runId'>): Promise<void>
  /**
   * Upsert papers and link them to the topic. Returns only the links that are
   * new. `runId` is stamped onto each new link so the "newly found" view can
   * later ask "what did this run add to this topic".
   */
  recordPapers(topicId: number, found: FoundPaper[], runId?: number): Promise<NewLink[]>
  /** Store each paper's embedding, shared across every topic it's linked to. */
  saveEmbeddings(updates: EmbeddingUpdate[]): Promise<void>
  saveScores(topicId: number, updates: ScoreUpdate[]): Promise<void>
  /** Advance the watermark of the queries that completed this run. */
  markQueriesFetched(queryIds: number[], at: Date): Promise<void>
}
