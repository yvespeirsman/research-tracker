'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { updateTopicAction, type UpdateTopicState } from '@/app/actions'

const inputClass =
  'w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40'

function SaveButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
    >
      {pending ? 'Saving…' : 'Save changes'}
    </button>
  )
}

/** Edits a topic's name and description. Does not touch its queries. */
export function TopicForm({
  topicId,
  name,
  description,
}: {
  topicId: number
  name: string
  description: string
}) {
  const [state, action] = useActionState<UpdateTopicState, FormData>(updateTopicAction, {})

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="topicId" value={topicId} />

      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-medium">
          Name
        </label>
        <input id="name" name="name" required defaultValue={name} className={inputClass} />
      </div>

      <div>
        <label htmlFor="description" className="mb-1 block text-sm font-medium">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          required
          rows={4}
          defaultValue={description}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-black/45 dark:text-white/45">
          This does not regenerate searches — use “Regenerate all with Claude” below for that.
        </p>
      </div>

      {state.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state.saved && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">Saved.</p>
      )}

      <SaveButton />
    </form>
  )
}
