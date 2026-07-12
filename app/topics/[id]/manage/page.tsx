import Link from 'next/link'
import { notFound } from 'next/navigation'
import { countPapersByQuery, getTopic, listTopicQueries } from '@/lib/queries'
import { QueryEditor } from '@/app/query-editor'
import { toEditorQueries } from '@/lib/editor-queries'
import { DeleteTopicButton } from '../delete-topic-button'
import { TopicForm } from '../topic-form'

export const dynamic = 'force-dynamic'

export default async function ManageTopicPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const topicId = Number(id)
  if (!Number.isInteger(topicId)) notFound()

  const topic = await getTopic(topicId)
  if (!topic) notFound()

  const [queries, paperCounts] = await Promise.all([
    listTopicQueries(topicId),
    countPapersByQuery(topicId),
  ])

  return (
    <main>
      <Link
        href={`/topics/${topicId}`}
        className="text-sm text-black/50 underline underline-offset-4 dark:text-white/50"
      >
        ← {topic.name}
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Manage topic</h1>

      <section className="mt-6 rounded-lg border border-black/10 p-5 dark:border-white/15">
        <h2 className="text-sm font-semibold">Details</h2>
        <div className="mt-4">
          <TopicForm topicId={topicId} name={topic.name} description={topic.description} />
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-black/10 p-5 dark:border-white/15">
        <h2 className="text-sm font-semibold">
          {queries.length} arXiv {queries.length === 1 ? 'search' : 'searches'}
          {queries.some((q) => q.lastFetchedAt === null) && (
            <span className="ml-2 text-xs font-normal text-amber-700 dark:text-amber-400">
              · some will backfill on the next run
            </span>
          )}
        </h2>
        <div className="mt-4">
          <QueryEditor
            topicId={topicId}
            description={topic.description}
            initial={toEditorQueries(queries, paperCounts)}
          />
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-red-600/20 p-5 dark:border-red-400/20">
        <h2 className="text-sm font-semibold">Danger zone</h2>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          Deletes this topic and its searches. Papers it found are also deleted, unless another
          topic is still tracking them.
        </p>
        <div className="mt-4">
          <DeleteTopicButton topicId={topicId} name={topic.name} />
        </div>
      </section>
    </main>
  )
}
