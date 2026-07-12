'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { setPaperLabel, suggestPapersForLabel } from '@/app/actions'
import type { LabelSuggestion } from '@/lib/queries'

export function LabelSuggestions({ topicId, label }: { topicId: number; label: string }) {
  const [pending, startTransition] = useTransition()
  const [results, setResults] = useState<LabelSuggestion[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onClick = () =>
    startTransition(async () => {
      setError(null)
      try {
        setResults(await suggestPapersForLabel(topicId, label))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not suggest papers')
      }
    })

  const apply = (paperId: number) =>
    startTransition(async () => {
      await setPaperLabel(topicId, paperId, label)
      setResults((prev) => prev?.filter((r) => r.paperId !== paperId) ?? null)
    })

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md border border-black/15 px-3 py-1.5 text-xs font-medium hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
      >
        {pending ? 'Searching…' : `Suggest papers for "${label}"`}
      </button>

      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      {results && results.length === 0 && (
        <p className="mt-2 text-xs text-black/50 dark:text-white/50">
          No good matches found among unlabeled papers.
        </p>
      )}

      {results && results.length > 0 && (
        <ul className="mt-2 space-y-2">
          {results.map((paper) => (
            <li
              key={paper.paperId}
              className="flex items-center justify-between gap-3 rounded border border-black/10 px-3 py-2 text-sm dark:border-white/15"
            >
              <Link
                href={`/topics/${topicId}/papers/${paper.paperId}`}
                className="hover:underline underline-offset-4"
              >
                {paper.title}
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-black/40 dark:text-white/40">
                  {Math.round(paper.similarity * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => apply(paper.paperId)}
                  disabled={pending}
                  className="rounded border border-black/15 px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10"
                >
                  Add label
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
