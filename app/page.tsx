import Link from 'next/link'
import { listTopicSummaries } from '@/lib/queries'
import { RefreshButton } from './refresh-button'

export const dynamic = 'force-dynamic'

function formatWhen(date: Date | null): string {
  if (!date) return 'never searched'
  return `last searched ${date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })}`
}

export default async function HomePage() {
  const topics = await listTopicSummaries()

  return (
    <main>
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Research Tracker</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            arXiv topics you follow, refreshed daily.
          </p>
        </div>
        <RefreshButton />
      </header>

      {topics.length === 0 ? (
        <div className="rounded-lg border border-dashed border-black/15 p-10 text-center dark:border-white/20">
          <p className="text-sm text-black/60 dark:text-white/60">
            No topics yet. Describe a research interest and it will be expanded into a set of
            arXiv searches.
          </p>
          <Link
            href="/topics/new"
            className="mt-4 inline-block rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
          >
            Add your first topic
          </Link>
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {topics.map((topic) => (
              <li key={topic.id}>
                <Link
                  href={`/topics/${topic.id}`}
                  className="flex items-center justify-between gap-4 rounded-lg border border-black/10 p-4 transition hover:border-black/25 dark:border-white/15 dark:hover:border-white/30"
                >
                  <div className="min-w-0">
                    <h2 className="truncate font-medium">{topic.name}</h2>
                    <p className="mt-0.5 truncate text-sm text-black/55 dark:text-white/55">
                      {topic.description}
                    </p>
                    <p className="mt-1 text-xs text-black/40 dark:text-white/40">
                      {topic.queryCount} {topic.queryCount === 1 ? 'query' : 'queries'} ·{' '}
                      {formatWhen(topic.lastFetchedAt)}
                      {topic.pendingQueryCount > 0 && (
                        <span className="text-amber-700 dark:text-amber-400">
                          {' '}
                          · {topic.pendingQueryCount} to backfill
                        </span>
                      )}
                    </p>
                  </div>

                  {topic.unreadCount > 0 && (
                    <span className="shrink-0 rounded-full bg-foreground px-2.5 py-0.5 text-xs font-medium text-background">
                      {topic.unreadCount}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>

          <Link
            href="/topics/new"
            className="mt-6 inline-block text-sm font-medium underline underline-offset-4"
          >
            Add a topic
          </Link>
        </>
      )}
    </main>
  )
}
