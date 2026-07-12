'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { createTopic, previewExpansion, type PreviewState } from '@/app/actions'
import { QueryEditor } from '@/app/query-editor'
import { toEditorQueries } from '@/lib/editor-queries'

function SubmitButton({ children, idle }: { children: string; idle: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
    >
      {pending ? children : idle}
    </button>
  )
}

const inputClass =
  'w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40'

export function NewTopicForm() {
  const [state, action] = useActionState<PreviewState, FormData>(previewExpansion, {})

  return (
    <div className="space-y-8">
      <form action={action} className="space-y-4">
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium">
            Name
          </label>
          <input
            id="name"
            name="name"
            required
            defaultValue={state.preview?.name}
            placeholder="LLMs for retrieval"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="description" className="mb-1 block text-sm font-medium">
            What do you want to track?
          </label>
          <textarea
            id="description"
            name="description"
            required
            rows={4}
            defaultValue={state.preview?.description}
            placeholder="Using large language models to improve document ranking and reranking, especially query understanding."
            className={inputClass}
          />
          <p className="mt-1 text-xs text-black/45 dark:text-white/45">
            Be specific. Vague descriptions produce broad searches and a noisy inbox.
          </p>
        </div>

        {state.error && (
          <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
        )}

        <SubmitButton idle={state.preview ? 'Start over' : 'Generate queries'}>
          Expanding…
        </SubmitButton>
      </form>

      {state.preview && (
        <form action={createTopic} className="space-y-5">
          <input type="hidden" name="name" value={state.preview.name} />
          <input type="hidden" name="description" value={state.preview.description} />
          <input type="hidden" name="model" value={state.preview.model} />

          <div className="rounded-lg border border-black/10 p-5 dark:border-white/15">
            <h2 className="text-sm font-semibold">These searches will run against arXiv</h2>
            <p className="mt-1 mb-4 text-xs text-black/50 dark:text-white/50">
              Results are merged and deduplicated. Edit, remove, or replace anything that
              looks too broad before saving.
            </p>

            {/* Keyed on the preview so a regenerated set resets the editor. */}
            <QueryEditor
              key={state.preview.queries.join('|')}
              description={state.preview.description}
              model={state.preview.model}
              initial={toEditorQueries(
                state.preview.queries.map((expression) => ({ expression, source: 'llm' })),
              )}
            />
          </div>

          <SubmitButton idle="Save topic">Saving…</SubmitButton>
        </form>
      )}
    </div>
  )
}
