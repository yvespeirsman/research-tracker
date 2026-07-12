'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { findSimilarPapers } from './actions'
import type { SimilarPaper } from '@/lib/queries'

export function SimilarPapersButton({ topicId, paperId }: { topicId: number; paperId: number }) {
  const [pending, startTransition] = useTransition()
  const [results, setResults] = useState<SimilarPaper[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onClick = () =>
    startTransition(async () => {
      setError(null)
      try {
        setResults(await findSimilarPapers(topicId, paperId))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not find similar papers')
      }
    })

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
      >
        {pending ? 'Searching…' : 'Find similar papers'}
      </button>

      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      {results && results.length === 0 && (
        <p className="mt-2 text-xs text-black/50 dark:text-white/50">
          No similar papers found in this topic.
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
              <span className="shrink-0 text-xs text-black/40 dark:text-white/40">
                {Math.round(paper.similarity * 100)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
