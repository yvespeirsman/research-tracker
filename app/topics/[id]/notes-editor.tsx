'use client'

import { useState, useTransition } from 'react'
import { setPaperNotes } from '@/app/actions'

export function NotesEditor({
  topicId,
  paperId,
  notes,
}: {
  topicId: number
  paperId: number
  notes: string | null
}) {
  const [value, setValue] = useState(notes ?? '')
  const [open, setOpen] = useState(Boolean(notes))
  const [pending, startTransition] = useTransition()

  function commit() {
    const trimmed = value.trim()
    if (trimmed === (notes ?? '')) return
    startTransition(async () => {
      await setPaperNotes(topicId, paperId, trimmed || null)
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-black/50 underline underline-offset-4 hover:text-foreground dark:text-white/50"
      >
        Add note
      </button>
    )
  }

  return (
    <div className="mt-3">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setValue(notes ?? '')
            e.currentTarget.blur()
          }
        }}
        placeholder="Notes…"
        disabled={pending}
        rows={3}
        className="w-full rounded border border-black/15 bg-transparent px-2 py-1.5 text-sm disabled:opacity-40 dark:border-white/20"
      />
    </div>
  )
}
