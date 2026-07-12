'use client'

import { useTransition } from 'react'
import { setPaperState } from '@/app/actions'
import type { InboxPaper } from '@/lib/queries'

const actions: { state: InboxPaper['state']; label: string }[] = [
  { state: 'saved', label: 'Save' },
  { state: 'dismissed', label: 'Dismiss' },
  { state: 'unread', label: 'Unread' },
]

export function PaperActions({
  topicId,
  paperId,
  current,
}: {
  topicId: number
  paperId: number
  current: InboxPaper['state']
}) {
  const [pending, startTransition] = useTransition()

  return (
    <div className="flex gap-1.5">
      {actions
        .filter((a) => a.state !== current)
        .map((a) => (
          <button
            key={a.state}
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await setPaperState(topicId, paperId, a.state)
              })
            }
            className="rounded border border-black/15 px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10"
          >
            {a.label}
          </button>
        ))}
    </div>
  )
}
