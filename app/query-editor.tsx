'use client'

import { useState } from 'react'
import {
  addQuery,
  checkQuery,
  deleteQuery,
  regenerateAll,
  regenerateTopicQueries,
  suggestQuery,
  updateQuery,
  type QuerySource,
} from './actions'
import type { QueryCheck } from '@/lib/expansion'
import type { EditorQuery } from '@/lib/editor-queries'

export type { EditorQuery } from '@/lib/editor-queries'

type RowStatus =
  | { kind: 'idle' }
  | { kind: 'busy'; label: string }
  | { kind: 'error'; message: string }
  | { kind: 'checked'; check: QueryCheck }

let keySeq = 0
const nextKey = () => `q${keySeq++}`

const btn =
  'rounded border border-black/15 px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10'

function CheckBadge({ check }: { check: QueryCheck }) {
  if (check.status === 'invalid') {
    return <span className="text-xs text-red-600 dark:text-red-400">{check.reason}</span>
  }
  if (check.status === 'empty') {
    return (
      <span className="text-xs text-amber-700 dark:text-amber-400">
        arXiv matches nothing — likely a typo.
      </span>
    )
  }
  return (
    <span className="text-xs text-emerald-700 dark:text-emerald-400">
      matches {check.count.toLocaleString()} papers
    </span>
  )
}

/**
 * Edits a topic's arXiv expressions.
 *
 * With `topicId` it writes through to the database on every change; without it
 * the list is a draft and the parent form submits it via the hidden inputs.
 */
export function QueryEditor({
  description,
  initial,
  topicId,
  model,
}: {
  description: string
  initial: EditorQuery[]
  topicId?: number
  model?: string
}) {
  const [queries, setQueries] = useState<EditorQuery[]>(initial)
  const [status, setStatus] = useState<Record<string, RowStatus>>({})
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState<string | null>(null)
  const [addStatus, setAddStatus] = useState<RowStatus>({ kind: 'idle' })
  const [globalBusy, setGlobalBusy] = useState<string | null>(null)
  const [globalError, setGlobalError] = useState<string | null>(null)

  const persisted = topicId !== undefined
  const setRow = (key: string, s: RowStatus) => setStatus((p) => ({ ...p, [key]: s }))

  const others = (key: string) =>
    queries.filter((q) => q.key !== key).map((q) => q.expression)

  /** Validate, then either write through or update the draft. */
  async function commit(row: EditorQuery, expression: string, source: QuerySource) {
    const trimmed = expression.trim()
    setRow(row.key, { kind: 'busy', label: 'Checking against arXiv…' })

    let check: QueryCheck
    try {
      check = await checkQuery(trimmed, others(row.key))
    } catch (err) {
      setRow(row.key, {
        kind: 'error',
        message: err instanceof Error ? err.message : 'Check failed',
      })
      return
    }

    if (check.status === 'invalid') {
      setRow(row.key, { kind: 'checked', check })
      return
    }

    let savedId = row.id
    if (persisted) {
      try {
        if (row.id === undefined) {
          savedId = await addQuery(topicId!, trimmed, source, model)
        } else {
          await updateQuery(topicId!, row.id, trimmed, source, model)
        }
      } catch (err) {
        setRow(row.key, {
          kind: 'error',
          message: err instanceof Error ? err.message : 'Save failed',
        })
        return
      }
    }

    setQueries((prev) =>
      prev.map((q) =>
        q.key === row.key
          ? // A changed expression has never run: it will backfill.
            { ...q, id: savedId, expression: trimmed, source, lastFetchedAt: null }
          : q,
      ),
    )
    setEditing((prev) => {
      const next = { ...prev }
      delete next[row.key]
      return next
    })
    setRow(row.key, { kind: 'checked', check })
  }

  async function remove(row: EditorQuery) {
    if (persisted && row.id !== undefined) {
      setRow(row.key, { kind: 'busy', label: 'Removing…' })
      try {
        await deleteQuery(topicId!, row.id)
      } catch (err) {
        setRow(row.key, {
          kind: 'error',
          message: err instanceof Error ? err.message : 'Delete failed',
        })
        return
      }
    }
    setQueries((prev) => prev.filter((q) => q.key !== row.key))
  }

  async function askModel(row: EditorQuery) {
    setRow(row.key, { kind: 'busy', label: 'Asking Claude…' })
    try {
      const { query } = await suggestQuery(description, others(row.key), row.expression)
      await commit(row, query, 'llm')
    } catch (err) {
      setRow(row.key, {
        kind: 'error',
        message: err instanceof Error ? err.message : 'Suggestion failed',
      })
    }
  }

  async function regenerate() {
    setGlobalBusy('Regenerating every expression…')
    setGlobalError(null)
    try {
      const fresh = persisted
        ? await regenerateTopicQueries(topicId!)
        : (await regenerateAll(description)).map((expression) => ({
            id: undefined,
            expression,
            source: 'llm' as const,
          }))

      setQueries(
        fresh.map((q) => ({
          key: nextKey(),
          id: q.id,
          expression: q.expression,
          source: q.source,
          lastFetchedAt: null,
        })),
      )
      setStatus({})
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Regeneration failed')
    } finally {
      setGlobalBusy(null)
    }
  }

  /** Validate before the row appears, so an invalid expression never enters the list. */
  async function addNew() {
    const expression = (adding ?? '').trim()
    if (!expression) return

    setAddStatus({ kind: 'busy', label: 'Checking against arXiv…' })

    let check: QueryCheck
    try {
      check = await checkQuery(expression, queries.map((q) => q.expression))
    } catch (err) {
      setAddStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Check failed' })
      return
    }

    if (check.status === 'invalid') {
      setAddStatus({ kind: 'checked', check })
      return
    }

    const key = nextKey()
    let id: number | undefined
    if (persisted) {
      try {
        id = await addQuery(topicId!, expression, 'manual')
      } catch (err) {
        setAddStatus({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Save failed',
        })
        return
      }
    }

    setQueries((prev) => [
      ...prev,
      { key, id, expression, source: 'manual', lastFetchedAt: null },
    ])
    setRow(key, { kind: 'checked', check })
    setAdding(null)
    setAddStatus({ kind: 'idle' })
  }

  return (
    <div className="space-y-4">
      {persisted && (
        <p className="text-xs text-black/50 dark:text-white/50">
          A query you add or edit has no history, so its next run searches all of arXiv and
          backfills. Untouched queries only fetch what is new.
        </p>
      )}

      <ul className="space-y-2">
        {queries.map((row) => {
          const rowStatus = status[row.key] ?? { kind: 'idle' as const }
          const isEditing = editing[row.key] !== undefined
          const busy = rowStatus.kind === 'busy' || globalBusy !== null

          return (
            <li
              key={row.key}
              className="rounded-lg border border-black/10 p-3 dark:border-white/15"
            >
              {isEditing ? (
                <div className="space-y-2">
                  <textarea
                    autoFocus
                    rows={2}
                    value={editing[row.key]}
                    onChange={(e) =>
                      setEditing((p) => ({ ...p, [row.key]: e.target.value }))
                    }
                    className="w-full rounded border border-black/15 bg-transparent px-2 py-1.5 font-mono text-xs outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
                  />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => commit(row, editing[row.key], 'manual')}
                      className={btn}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setEditing((p) => {
                          const next = { ...p }
                          delete next[row.key]
                          return next
                        })
                      }
                      className={btn}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="font-mono text-xs break-all">{row.expression}</p>

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-black/40 dark:text-white/40">
                      <span>{row.source === 'manual' ? 'hand-written' : 'generated'}</span>
                      {persisted && (
                        <span>
                          ·{' '}
                          {row.lastFetchedAt
                            ? `searched ${new Date(row.lastFetchedAt).toLocaleDateString()}`
                            : 'will backfill on next run'}
                        </span>
                      )}
                      {row.paperCount !== undefined && (
                        <span>· found {row.paperCount} papers so far</span>
                      )}
                    </div>

                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setEditing((p) => ({ ...p, [row.key]: row.expression }))}
                        className={btn}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => askModel(row)}
                        className={btn}
                      >
                        Replace with Claude
                      </button>
                      <button
                        type="button"
                        disabled={busy || queries.length === 1}
                        title={queries.length === 1 ? 'A topic needs at least one query' : undefined}
                        onClick={() => remove(row)}
                        className={btn}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </>
              )}

              {rowStatus.kind === 'busy' && (
                <p className="mt-2 text-xs text-black/50 dark:text-white/50">
                  {rowStatus.label}
                </p>
              )}
              {rowStatus.kind === 'error' && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                  {rowStatus.message}
                </p>
              )}
              {rowStatus.kind === 'checked' && (
                <p className="mt-2">
                  <CheckBadge check={rowStatus.check} />
                </p>
              )}
            </li>
          )
        })}
      </ul>

      {adding !== null ? (
        <div className="space-y-2 rounded-lg border border-dashed border-black/15 p-3 dark:border-white/20">
          <textarea
            autoFocus
            rows={2}
            value={adding}
            placeholder='abs:"contrastive learning" AND cat:cs.LG'
            onChange={(e) => setAdding(e.target.value)}
            className="w-full rounded border border-black/15 bg-transparent px-2 py-1.5 font-mono text-xs outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/40"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={addStatus.kind === 'busy'}
              onClick={addNew}
              className={btn}
            >
              Add
            </button>
            <button
              type="button"
              disabled={addStatus.kind === 'busy'}
              onClick={() => {
                setAdding(null)
                setAddStatus({ kind: 'idle' })
              }}
              className={btn}
            >
              Cancel
            </button>
          </div>

          {addStatus.kind === 'busy' && (
            <p className="text-xs text-black/50 dark:text-white/50">{addStatus.label}</p>
          )}
          {addStatus.kind === 'error' && (
            <p className="text-xs text-red-600 dark:text-red-400">{addStatus.message}</p>
          )}
          {addStatus.kind === 'checked' && <CheckBadge check={addStatus.check} />}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={globalBusy !== null}
            onClick={() => setAdding('')}
            className={btn}
          >
            Add a query
          </button>
          <button
            type="button"
            disabled={globalBusy !== null}
            onClick={regenerate}
            className={btn}
          >
            Regenerate all with Claude
          </button>
        </div>
      )}

      {globalBusy && (
        <p className="text-xs text-black/50 dark:text-white/50">{globalBusy}</p>
      )}
      {globalError && (
        <p className="text-xs text-red-600 dark:text-red-400">{globalError}</p>
      )}

      {/* Draft mode: the parent form submits these. */}
      {!persisted &&
        queries.map((q) => (
          <div key={`hidden-${q.key}`}>
            <input type="hidden" name="queries" value={q.expression} />
            <input type="hidden" name="sources" value={q.source} />
          </div>
        ))}
    </div>
  )
}
