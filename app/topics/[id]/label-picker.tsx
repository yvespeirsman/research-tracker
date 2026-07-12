'use client'

import { useState, useTransition } from 'react'
import { setPaperLabel } from '@/app/actions'

export function LabelPicker({
  topicId,
  paperId,
  label,
  existingLabels,
}: {
  topicId: number
  paperId: number
  label: string | null
  existingLabels: string[]
}) {
  const [value, setValue] = useState(label ?? '')
  const [pending, startTransition] = useTransition()
  const listId = `topic-${topicId}-labels`

  function commit() {
    const trimmed = value.trim()
    if (trimmed === (label ?? '')) return
    startTransition(async () => {
      await setPaperLabel(topicId, paperId, trimmed || null)
    })
  }

  function remove() {
    setValue('')
    startTransition(async () => {
      await setPaperLabel(topicId, paperId, null)
    })
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        list={listId}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setValue(label ?? '')
            e.currentTarget.blur()
          }
        }}
        placeholder="Add label…"
        disabled={pending}
        className="w-32 rounded border border-black/15 bg-transparent px-2 py-1 text-xs disabled:opacity-40 dark:border-white/20"
      />
      {label && (
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          aria-label="Remove label"
          className="rounded border border-black/15 px-1.5 py-1 text-xs leading-none hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10"
        >
          ×
        </button>
      )}
      <datalist id={listId}>
        {existingLabels.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
    </div>
  )
}
