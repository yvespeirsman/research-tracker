'use client'

import { useTransition } from 'react'
import { useState } from 'react'
import { unstable_rethrow } from 'next/navigation'
import { deleteTopic } from '@/app/actions'

export function DeleteTopicButton({ topicId, name }: { topicId: number; name: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const onClick = () => {
    if (!confirm(`Delete "${name}"? This removes its searches and any papers no other topic is tracking.`)) {
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await deleteTopic(topicId)
      } catch (err) {
        // `deleteTopic` redirects on success, which rejects this promise with
        // Next's internal navigation error — let it propagate to the
        // framework's own RedirectBoundary rather than reporting it as a
        // failure. Only a genuine error reaches the line below.
        unstable_rethrow(err)
        setError(err instanceof Error ? err.message : 'Could not delete this topic')
      }
    })
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md border border-red-600/30 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-600/10 disabled:opacity-50 dark:border-red-400/30 dark:text-red-400 dark:hover:bg-red-400/10"
      >
        {pending ? 'Deleting…' : 'Delete topic'}
      </button>

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
