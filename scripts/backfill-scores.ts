/**
 * One-off (but re-runnable) backfill: embeds and scores every already-ingested
 * paper that the normal ingest pipeline never touched — either because it
 * predates the embedding-scoring feature, or because a previous run of this
 * script was interrupted. Safe to re-run: it only touches rows that are still
 * missing an embedding or a score.
 *
 * Usage: npm run score:backfill
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { papers, topicPapers, topics } from '@/drizzle/schema'
import { cosineSimilarity, embedBatch, embedText, similarityToScore } from '@/lib/embeddings'
import { getDrizzleStore } from '@/lib/ingest'

const EMBED_BATCH_SIZE = 50

async function backfillEmbeddings(): Promise<void> {
  const db = getDb()
  const store = getDrizzleStore()

  const unembedded = await db
    .select({ id: papers.id, title: papers.title, abstract: papers.abstract })
    .from(papers)
    .where(isNull(papers.embedding))

  console.log(`Embedding ${unembedded.length} paper(s)...`)

  for (let i = 0; i < unembedded.length; i += EMBED_BATCH_SIZE) {
    const batch = unembedded.slice(i, i + EMBED_BATCH_SIZE)
    const embeddings = await embedBatch(batch.map((p) => `${p.title}\n\n${p.abstract}`))
    await store.saveEmbeddings(batch.map((p, j) => ({ paperId: p.id, embedding: embeddings[j] })))
    console.log(`  ${Math.min(i + EMBED_BATCH_SIZE, unembedded.length)}/${unembedded.length}`)
  }
}

async function backfillScores(): Promise<void> {
  const db = getDb()
  const store = getDrizzleStore()

  const allTopics = await db.select({ id: topics.id, description: topics.description }).from(topics)

  for (const topic of allTopics) {
    const unscored = await db
      .select({ paperId: topicPapers.paperId, embedding: papers.embedding })
      .from(topicPapers)
      .innerJoin(papers, eq(papers.id, topicPapers.paperId))
      .where(and(eq(topicPapers.topicId, topic.id), isNull(topicPapers.relevanceScore)))

    if (unscored.length === 0) continue

    console.log(`Scoring ${unscored.length} paper(s) for topic ${topic.id}...`)
    const topicEmbedding = await embedText(topic.description)

    const updates = unscored
      .filter((row): row is { paperId: number; embedding: number[] } => row.embedding !== null)
      .map((row) => ({
        paperId: row.paperId,
        score: similarityToScore(cosineSimilarity(topicEmbedding, row.embedding)),
      }))

    await store.saveScores(topic.id, updates)
  }
}

async function main() {
  await backfillEmbeddings()
  await backfillScores()
  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
