import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getInboxPaper, getTopic, listTopicLabels } from '@/lib/queries'
import { LabelPicker } from '../../label-picker'
import { NotesEditor } from '../../notes-editor'
import { PaperActions } from '../../paper-actions'
import { SimilarPapersButton } from '@/app/similar-papers'
import { PaperChat } from '@/app/paper-chat'

export const dynamic = 'force-dynamic'

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <span
        title="Scoring hasn't run for this paper yet"
        className="shrink-0 rounded px-2 py-0.5 text-xs font-medium text-black/40 ring-1 ring-black/10 dark:text-white/40 dark:ring-white/15"
      >
        —
      </span>
    )
  }

  const tone =
    score >= 70
      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
      : score >= 40
        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
        : 'bg-black/5 text-black/50 dark:bg-white/10 dark:text-white/50'

  return (
    <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${tone}`}>{score}</span>
  )
}

export default async function PaperPage({
  params,
}: {
  params: Promise<{ id: string; paperId: string }>
}) {
  const { id, paperId: rawPaperId } = await params

  const topicId = Number(id)
  const paperId = Number(rawPaperId)
  if (!Number.isInteger(topicId) || !Number.isInteger(paperId)) notFound()

  const [topic, paper, labels] = await Promise.all([
    getTopic(topicId),
    getInboxPaper(topicId, paperId),
    listTopicLabels(topicId),
  ])
  if (!topic || !paper) notFound()

  return (
    <main>
      <Link
        href={`/topics/${topicId}`}
        className="text-sm text-black/50 underline underline-offset-4 dark:text-white/50"
      >
        ← {topic.name}
      </Link>

      <div className="mt-4 rounded-lg border border-black/10 p-4 dark:border-white/15">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-lg font-medium leading-snug">
            <a
              href={paper.absUrl}
              target="_blank"
              rel="noreferrer"
              className="hover:underline underline-offset-4"
            >
              {paper.title}
            </a>
          </h1>
          <ScoreBadge score={paper.relevanceScore} />
        </div>

        <p className="mt-2 text-xs text-black/45 dark:text-white/45">
          {paper.authors.join(', ')}
          {' · '}
          {paper.publishedAt.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
          {' · '}
          {paper.categories.join(', ')}
        </p>

        <p className="mt-3 text-sm leading-relaxed text-black/70 dark:text-white/70">
          {paper.abstract}
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-3 text-xs">
            <a
              href={paper.absUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              arXiv:{paper.arxivId}
            </a>
            {paper.pdfUrl && (
              <a
                href={paper.pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4"
              >
                PDF
              </a>
            )}
          </div>

          <div className="flex items-center gap-3">
            <LabelPicker
              topicId={topicId}
              paperId={paper.paperId}
              label={paper.label}
              existingLabels={labels}
            />
            <PaperActions topicId={topicId} paperId={paper.paperId} current={paper.state} />
          </div>
        </div>

        {paper.matchedQuery && (
          <p className="mt-3 font-mono text-[11px] text-black/35 dark:text-white/35">
            found by: {paper.matchedQuery}
          </p>
        )}

        <div className="mt-4 border-t border-black/10 pt-4 dark:border-white/15">
          <h2 className="text-xs font-medium text-black/50 dark:text-white/50">Notes</h2>
          <NotesEditor topicId={topicId} paperId={paper.paperId} notes={paper.notes} />
        </div>

        <div className="mt-4 border-t border-black/10 pt-4 dark:border-white/15">
          <h2 className="text-xs font-medium text-black/50 dark:text-white/50">Similar papers</h2>
          <div className="mt-2">
            <SimilarPapersButton topicId={topicId} paperId={paper.paperId} />
          </div>
        </div>

        <div className="mt-4 border-t border-black/10 pt-4 dark:border-white/15">
          <h2 className="text-xs font-medium text-black/50 dark:text-white/50">Chat with paper</h2>
          <div className="mt-2">
            <PaperChat topicId={topicId} paperId={paper.paperId} />
          </div>
        </div>
      </div>
    </main>
  )
}
