'use client'

import { useState, useTransition } from 'react'
import { refreshNow, refreshTopic } from './actions'
import type { RunSummary } from '@/lib/ingest'

/**
 * Ingestion is rate-limited to one arXiv request every 3 seconds, so a refresh
 * across several topics takes tens of seconds. Say so, rather than looking hung.
 *
 * Pass `topicId` to scope the refresh to one topic instead of every topic.
 */
export function RefreshButton({ topicId }: { topicId?: number } = {}) {
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<RunSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onClick = () =>
    startTransition(async () => {
      setResult(null)
      setError(null)
      try {
        setResult(await (topicId !== undefined ? refreshTopic(topicId) : refreshNow()))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Refresh failed')
      }
    })

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md border border-black/15 px-5 py-1.5 text-sm font-medium hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
      >
        {pending ? 'Searching arXiv…' : 'Refresh now'}
      </button>

      {pending && (
        <p className="text-xs text-black/50 dark:text-white/50">
          Paced at one query every 3 seconds — this can take a while.
        </p>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {result && (
        <p className="text-xs text-black/60 dark:text-white/60">
          {summarize(result, topicId !== undefined)}
        </p>
      )}
    </div>
  )
}

function summarize(run: RunSummary, scoped: boolean): string {
  if (run.status === 'failed') return `Run failed: ${run.error}`

  const papers = `${run.papersFound} new paper${run.papersFound === 1 ? '' : 's'}`
  const suffix = scoped ? '' : ` across ${run.topicsProcessed} topic${run.topicsProcessed === 1 ? '' : 's'}`

  return run.status === 'partial'
    ? `${papers}${suffix}; ran out of time, will resume next run.`
    : `${papers}${suffix}.`
}
