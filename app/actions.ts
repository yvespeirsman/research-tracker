'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { topicPapers, topicQueries, topics } from '@/drizzle/schema'
import {
  expandTopic,
  suggestReplacement,
  validateQuery,
  type QueryCheck,
} from '@/lib/expansion'
import {
  findSimilarPapers as queryFindSimilarPapers,
  suggestPapersForLabel as querySuggestPapersForLabel,
  type LabelSuggestion,
  type SimilarPaper,
} from '@/lib/queries'

export type QuerySource = 'llm' | 'manual'

export interface DraftQuery {
  expression: string
  source: QuerySource
}

export interface PreviewState {
  error?: string
  preview?: { name: string; description: string; queries: string[]; model: string }
}

/**
 * Generate the arXiv expressions for a topic and hand them back for review.
 * Nothing is saved yet — seeing and editing what will be searched is the point.
 */
export async function previewExpansion(
  _prev: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()

  if (!name) return { error: 'Give the topic a name.' }
  if (!description) return { error: 'Describe what you want to track.' }

  try {
    const { queries, model } = await expandTopic(description)
    return { preview: { name, description, queries, model } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not expand this topic.' }
  }
}

/**
 * Check one expression before it is saved. Costs a rate-limited arXiv request,
 * because arXiv answers a malformed query with zero results rather than an error.
 */
export async function checkQuery(
  expression: string,
  existing: string[],
): Promise<QueryCheck> {
  return validateQuery(expression, { existing })
}

/** Ask the model for one expression, given the ones already in use. */
export async function suggestQuery(
  description: string,
  existing: string[],
  replacing?: string,
): Promise<{ query: string; model: string }> {
  return suggestReplacement(description, existing, { replacing })
}

/** Regenerate the whole set from the description, discarding manual edits. */
export async function regenerateAll(description: string): Promise<string[]> {
  const { queries } = await expandTopic(description)
  return queries
}

/** Persist a reviewed topic. Queries come from the editor the user just used. */
export async function createTopic(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()
  const model = String(formData.get('model') ?? '')

  const expressions = formData.getAll('queries').map((q) => String(q).trim()).filter(Boolean)
  const sources = formData.getAll('sources').map((s) => String(s))

  if (!name || !description) throw new Error('Topic is missing a name or description')
  if (expressions.length === 0) throw new Error('A topic needs at least one query')

  const db = getDb()
  const [topic] = await db
    .insert(topics)
    .values({ name, description })
    .returning({ id: topics.id })

  await db.insert(topicQueries).values(
    expressions.map((expression, i) => ({
      topicId: topic.id,
      expression,
      source: (sources[i] === 'manual' ? 'manual' : 'llm') as QuerySource,
      // A hand-written expression has no model provenance.
      model: sources[i] === 'manual' ? null : model,
    })),
  )

  revalidatePath('/')
  redirect(`/topics/${topic.id}`)
}

/**
 * Add a query to an existing topic. It starts with no watermark, so its first
 * run backfills over all of arXiv rather than only picking up papers from today.
 *
 * Returns the new row's id, which the editor needs so that a subsequent edit
 * updates this row rather than trying to insert a duplicate.
 */
export async function addQuery(
  topicId: number,
  expression: string,
  source: QuerySource,
  model?: string,
): Promise<number> {
  const [row] = await getDb()
    .insert(topicQueries)
    .values({
      topicId,
      expression: expression.trim(),
      source,
      model: source === 'manual' ? null : (model ?? null),
    })
    .onConflictDoNothing()
    .returning({ id: topicQueries.id })

  if (!row) throw new Error('This topic already has that expression.')

  revalidatePath(`/topics/${topicId}`)
  revalidatePath('/')
  return row.id
}

/**
 * Replace an expression. The watermark is cleared: the new expression has never
 * run, so it must backfill rather than inherit the old one's progress.
 */
export async function updateQuery(
  topicId: number,
  queryId: number,
  expression: string,
  source: QuerySource,
  model?: string,
): Promise<void> {
  await getDb()
    .update(topicQueries)
    .set({
      expression: expression.trim(),
      source,
      model: source === 'manual' ? null : (model ?? null),
      lastFetchedAt: null,
    })
    .where(and(eq(topicQueries.id, queryId), eq(topicQueries.topicId, topicId)))

  revalidatePath(`/topics/${topicId}`)
  revalidatePath('/')
}

/**
 * Remove a query. Papers it already found stay in the inbox — they were real
 * results, and their `matchedQuery` keeps recording where they came from.
 */
export async function deleteQuery(topicId: number, queryId: number): Promise<void> {
  await getDb()
    .delete(topicQueries)
    .where(and(eq(topicQueries.id, queryId), eq(topicQueries.topicId, topicId)))

  revalidatePath(`/topics/${topicId}`)
  revalidatePath('/')
}

/** Regenerate every expression for a saved topic. All of them backfill. */
export async function regenerateTopicQueries(
  topicId: number,
): Promise<{ id: number; expression: string; source: QuerySource }[]> {
  const db = getDb()
  const [topic] = await db.select().from(topics).where(eq(topics.id, topicId)).limit(1)
  if (!topic) throw new Error('Topic not found')

  const { queries, model } = await expandTopic(topic.description)

  await db.delete(topicQueries).where(eq(topicQueries.topicId, topicId))
  const rows = await db
    .insert(topicQueries)
    .values(queries.map((expression) => ({ topicId, expression, source: 'llm' as const, model })))
    .returning({ id: topicQueries.id, expression: topicQueries.expression })

  revalidatePath(`/topics/${topicId}`)
  revalidatePath('/')
  return rows.map((r) => ({ ...r, source: 'llm' as const }))
}

export interface UpdateTopicState {
  error?: string
  saved?: boolean
}

/** Update a topic's name and description. Existing queries are left untouched. */
export async function updateTopicAction(
  _prev: UpdateTopicState,
  formData: FormData,
): Promise<UpdateTopicState> {
  const topicId = Number(formData.get('topicId'))
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()

  if (!Number.isInteger(topicId)) return { error: 'Invalid topic.' }
  if (!name) return { error: 'Give the topic a name.' }
  if (!description) return { error: 'Describe what you want to track.' }

  await getDb()
    .update(topics)
    .set({ name, description, updatedAt: new Date() })
    .where(eq(topics.id, topicId))

  revalidatePath(`/topics/${topicId}`)
  revalidatePath(`/topics/${topicId}/manage`)
  revalidatePath('/')

  return { saved: true }
}

export async function deleteTopic(topicId: number): Promise<void> {
  await getDb().delete(topics).where(eq(topics.id, topicId))
  revalidatePath('/')
  redirect('/')
}

export async function setPaperState(
  topicId: number,
  paperId: number,
  state: 'unread' | 'read' | 'saved' | 'dismissed',
): Promise<void> {
  await getDb()
    .update(topicPapers)
    .set({ state })
    .where(and(eq(topicPapers.topicId, topicId), eq(topicPapers.paperId, paperId)))

  revalidatePath(`/topics/${topicId}`)
  revalidatePath(`/topics/${topicId}/papers/${paperId}`)
  revalidatePath('/')
}

/** Set or clear a paper's label within a topic. An empty string clears it. */
export async function setPaperLabel(
  topicId: number,
  paperId: number,
  label: string | null,
): Promise<void> {
  const trimmed = label?.trim() || null

  await getDb()
    .update(topicPapers)
    .set({ label: trimmed })
    .where(and(eq(topicPapers.topicId, topicId), eq(topicPapers.paperId, paperId)))

  revalidatePath(`/topics/${topicId}`)
  revalidatePath(`/topics/${topicId}/papers/${paperId}`)
}

/** Set or clear a paper's notes within a topic. An empty string clears it. */
export async function setPaperNotes(
  topicId: number,
  paperId: number,
  notes: string | null,
): Promise<void> {
  const trimmed = notes?.trim() || null

  await getDb()
    .update(topicPapers)
    .set({ notes: trimmed })
    .where(and(eq(topicPapers.topicId, topicId), eq(topicPapers.paperId, paperId)))

  revalidatePath(`/topics/${topicId}`)
  revalidatePath(`/topics/${topicId}/papers/${paperId}`)
}

/** Papers in this topic most similar to the given one, by embedding similarity. */
export async function findSimilarPapers(topicId: number, paperId: number): Promise<SimilarPaper[]> {
  return queryFindSimilarPapers(topicId, paperId)
}

/** Unlabeled papers in this topic that look like they belong under `label`. */
export async function suggestPapersForLabel(topicId: number, label: string): Promise<LabelSuggestion[]> {
  return querySuggestPapersForLabel(topicId, label)
}
