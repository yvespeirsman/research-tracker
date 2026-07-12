import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTopic, listTopicLabels } from '@/lib/queries'
import { ReportView } from './report-view'

export const dynamic = 'force-dynamic'

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const topicId = Number(id)
  if (!Number.isInteger(topicId)) notFound()

  const topic = await getTopic(topicId)
  if (!topic) notFound()

  const labels = await listTopicLabels(topicId)

  return (
    <main>
      <Link
        href={`/topics/${topicId}`}
        className="text-sm text-black/50 underline underline-offset-4 dark:text-white/50"
      >
        ← {topic.name}
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Research report</h1>
      <p className="mt-1 text-sm text-black/60 dark:text-white/60">
        Summarize this topic&rsquo;s papers, either the last 30 days or a label you&rsquo;ve assigned.
      </p>

      <div className="mt-6">
        <ReportView topicId={topicId} labels={labels} />
      </div>
    </main>
  )
}
