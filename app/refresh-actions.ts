'use server'

import { revalidatePath } from 'next/cache'
import { getDrizzleStore, runIngest, type RunSummary } from '@/lib/ingest'

/**
 * Run ingestion in-process. No HTTP hop and no CRON_SECRET — this is the same
 * `runIngest` the cron route calls.
 *
 * Kept in its own module, separate from the rest of `actions.ts`: it's the
 * only server action that needs `lib/ingest` (and, through it, the local
 * embedding model), and every page that imports `actions.ts` for something
 * unrelated would otherwise pull that model into its server bundle too.
 */
export async function refreshNow(): Promise<RunSummary> {
  const summary = await runIngest(getDrizzleStore())
  revalidatePath('/')
  return summary
}

/** Same as `refreshNow`, scoped to one topic's queries. */
export async function refreshTopic(topicId: number): Promise<RunSummary> {
  const summary = await runIngest(getDrizzleStore(), {}, topicId)
  revalidatePath(`/topics/${topicId}`)
  revalidatePath('/')
  return summary
}
