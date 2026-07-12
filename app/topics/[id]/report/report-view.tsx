'use client'

import { useState } from 'react'
import { useCompletion } from '@ai-sdk/react'
import ReactMarkdown, { type Components } from 'react-markdown'
import type { ReportFilter } from '@/lib/queries'

const RECENT_DAYS = 30

type Mode = 'recent' | 'label'

// The report isn't saved anywhere, so a paper link that navigated away in the
// same tab would lose it — open paper pages in a new tab instead.
const REPORT_MARKDOWN_COMPONENTS: Components = {
  a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
}

export function ReportView({ topicId, labels }: { topicId: number; labels: string[] }) {
  const [mode, setMode] = useState<Mode>('recent')
  const [label, setLabel] = useState(labels[0] ?? '')

  const { completion, complete, isLoading, error } = useCompletion({
    api: '/api/reports',
    streamProtocol: 'text',
  })

  const filter: ReportFilter =
    mode === 'label' ? { type: 'label', label } : { type: 'recent', days: RECENT_DAYS }

  const disabled = isLoading || (mode === 'label' && !label)

  const onGenerate = () => complete('', { body: { topicId, filter } })

  return (
    <div>
      <div className="flex items-center gap-4 border-b border-black/10 pb-3 dark:border-white/15">
        {labels.length > 0 && (
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setMode('recent')}
              className={`rounded-full px-3 py-1 text-sm ${
                mode === 'recent'
                  ? 'bg-black/10 font-medium dark:bg-white/15'
                  : 'text-black/50 hover:text-foreground dark:text-white/50'
              }`}
            >
              Last {RECENT_DAYS} days
            </button>
            <button
              type="button"
              onClick={() => setMode('label')}
              className={`rounded-full px-3 py-1 text-sm ${
                mode === 'label'
                  ? 'bg-black/10 font-medium dark:bg-white/15'
                  : 'text-black/50 hover:text-foreground dark:text-white/50'
              }`}
            >
              By label
            </button>
          </div>
        )}

        {mode === 'label' && labels.length > 0 && (
          <select
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="rounded-md border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20"
          >
            {labels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        )}

        <button
          type="button"
          onClick={onGenerate}
          disabled={disabled}
          className="ml-auto rounded-md border border-black/15 px-4 py-1.5 text-sm font-medium hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
        >
          {isLoading ? 'Generating…' : completion ? 'Generate again' : 'Generate report'}
        </button>
      </div>

      {error && (
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error.message}</p>
      )}

      {!error && !completion && !isLoading && (
        <p className="mt-6 text-sm text-black/50 dark:text-white/50">
          {labels.length === 0
            ? "This topic has no labels yet, so only the last-30-days report is available."
            : 'Choose a scope above and generate a report.'}
        </p>
      )}

      {completion && (
        <div className="prose prose-sm dark:prose-invert mt-6 max-w-none">
          <ReactMarkdown components={REPORT_MARKDOWN_COMPONENTS}>{completion}</ReactMarkdown>
        </div>
      )}
    </div>
  )
}
