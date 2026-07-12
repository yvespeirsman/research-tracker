import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  countInbox,
  getLatestRunId,
  getTopic,
  INBOX_PAGE_SIZE,
  listInbox,
  listTopicLabels,
  listTopicQueries,
  papersByMonth,
  type InboxPaper,
  type InboxSort,
} from '@/lib/queries'
import { RefreshButton } from '@/app/refresh-button'
import { LabelPicker } from './label-picker'
import { LabelSuggestions } from './label-suggestions'
import { PaperActions } from './paper-actions'
import { PapersByMonthChart } from './papers-by-month-chart'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'

export const dynamic = 'force-dynamic'

type Filter = 'inbox' | 'new' | 'saved' | 'all'

const ALL_STATES: InboxPaper['state'][] = ['unread', 'read', 'saved', 'dismissed']

const FILTERS: Record<Filter, { label: string; states: InboxPaper['state'][] }> = {
  inbox: { label: 'Inbox', states: ['unread'] },
  // Not restricted to 'unread': a paper the last refresh surfaced stays visible
  // here even after it's been triaged, since this tab is about *when* a paper
  // arrived, not its current state.
  new: { label: 'New', states: ALL_STATES },
  saved: { label: 'Saved', states: ['saved'] },
  all: { label: 'All', states: ALL_STATES },
}

const SORTS: Record<InboxSort, string> = {
  score: 'Score',
  date: 'Date',
}

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
    <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {score}
    </span>
  )
}

/** Page numbers to render around the current page, with gaps as 'ellipsis'. */
function pageRange(current: number, total: number): (number | 'ellipsis')[] {
  const keep = new Set([1, total, current - 1, current, current + 1])
  const sorted = [...keep].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b)

  const result: (number | 'ellipsis')[] = []
  let prev = 0
  for (const p of sorted) {
    if (prev && p - prev > 1) result.push('ellipsis')
    result.push(p)
    prev = p
  }
  return result
}

/** Sentinel for the "no label" filter option, since `label=` alone is ambiguous with "unset". */
const UNLABELED = '__none__'

export default async function TopicPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    filter?: string
    sort?: string
    page?: string
    label?: string
    q?: string
  }>
}) {
  const { id } = await params
  const {
    filter: rawFilter,
    sort: rawSort,
    page: rawPage,
    label: rawLabel,
    q: rawQuery,
  } = await searchParams

  const topicId = Number(id)
  if (!Number.isInteger(topicId)) notFound()

  const topic = await getTopic(topicId)
  if (!topic) notFound()

  const filter: Filter =
    rawFilter === 'new' || rawFilter === 'saved' || rawFilter === 'all' ? rawFilter : 'inbox'
  const sort: InboxSort = rawSort === 'date' ? 'date' : 'score'
  const label: string | null | undefined =
    rawLabel === undefined ? undefined : rawLabel === UNLABELED ? null : rawLabel
  const search = rawQuery?.trim() || undefined

  const [queries, monthCounts, labels, latestRunId] = await Promise.all([
    listTopicQueries(topicId),
    papersByMonth(topicId),
    listTopicLabels(topicId),
    filter === 'new' ? getLatestRunId(topicId) : Promise.resolve(undefined),
  ])

  // Nothing has ever been ingested with a recorded run id, so there is
  // nothing to call "newly found" yet — skip the query rather than falling
  // back to showing every paper.
  const noRunToShow = filter === 'new' && latestRunId === null
  const runId = filter === 'new' && latestRunId !== null ? latestRunId : undefined

  const totalPapers = noRunToShow
    ? 0
    : await countInbox(topicId, FILTERS[filter].states, label, runId, search)

  const totalPages = Math.max(1, Math.ceil(totalPapers / INBOX_PAGE_SIZE))
  const requestedPage = Number(rawPage)
  const page = Number.isInteger(requestedPage)
    ? Math.min(Math.max(requestedPage, 1), totalPages)
    : 1

  const papers = noRunToShow
    ? []
    : await listInbox(
        topicId,
        FILTERS[filter].states,
        sort,
        { page, pageSize: INBOX_PAGE_SIZE },
        label,
        runId,
        search,
      )

  const labelParam = rawLabel ? `&label=${encodeURIComponent(rawLabel)}` : ''
  const queryParam = search ? `&q=${encodeURIComponent(search)}` : ''
  const pageHref = (p: number) =>
    `/topics/${topicId}?filter=${filter}&sort=${sort}&page=${p}${labelParam}${queryParam}`

  const searchedAt = queries
    .map((q) => q.lastFetchedAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0]

  return (
    <main>
      <Link
        href="/"
        className="text-sm text-black/50 underline underline-offset-4 dark:text-white/50"
      >
        ← Topics
      </Link>

      <header className="mt-4 flex items-start justify-between gap-4">
        <div className="max-w-xl">
          <h1 className="text-2xl font-semibold tracking-tight">{topic.name}</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">{topic.description}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <RefreshButton topicId={topicId} />
          <div className="flex gap-3">
            <Link
              href={`/topics/${topicId}/report`}
              className="text-xs text-black/50 underline underline-offset-4 dark:text-white/50"
            >
              Report
            </Link>
            <Link
              href={`/topics/${topicId}/manage`}
              className="text-xs text-black/50 underline underline-offset-4 dark:text-white/50"
            >
              Manage topic
            </Link>
          </div>
        </div>
      </header>

      <p className="mt-4 text-xs text-black/40 dark:text-white/40">
        {queries.length} arXiv {queries.length === 1 ? 'search' : 'searches'}
        {queries.some((q) => q.lastFetchedAt === null) && (
          <span className="ml-2 text-amber-700 dark:text-amber-400">
            · some will backfill on the next run
          </span>
        )}
      </p>

      {monthCounts.length > 0 && (
        <div className="mt-4 rounded-lg border border-black/10 p-4 dark:border-white/15">
          <h2 className="text-sm font-medium">Papers by month</h2>
          <div className="mt-4">
            <PapersByMonthChart data={monthCounts} />
          </div>
        </div>
      )}

      <form action={`/topics/${topicId}`} method="get" className="mt-6 flex gap-2">
        <input type="hidden" name="filter" value={filter} />
        <input type="hidden" name="sort" value={sort} />
        {typeof label === 'string' && <input type="hidden" name="label" value={label} />}
        {label === null && <input type="hidden" name="label" value={UNLABELED} />}
        <input
          type="search"
          name="q"
          defaultValue={search ?? ''}
          placeholder="Search titles and abstracts…"
          className="w-full rounded-md border border-black/15 bg-transparent px-3 py-1.5 text-sm placeholder:text-black/40 focus:outline-none focus:ring-1 focus:ring-black/25 dark:border-white/20 dark:placeholder:text-white/40 dark:focus:ring-white/30"
        />
        {search && (
          <Link
            href={`/topics/${topicId}?filter=${filter}&sort=${sort}${labelParam}`}
            className="shrink-0 rounded-md border border-black/15 px-3 py-1.5 text-sm text-black/60 hover:bg-black/5 dark:border-white/20 dark:text-white/60 dark:hover:bg-white/10"
          >
            Clear
          </Link>
        )}
      </form>

      <nav className="mt-4 flex items-center justify-between gap-4 border-b border-black/10 dark:border-white/15">
        <div className="flex gap-1">
          {(Object.keys(FILTERS) as Filter[]).map((key) => (
            <Link
              key={key}
              href={`/topics/${topicId}?filter=${key}&sort=${sort}${labelParam}${queryParam}`}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                key === filter
                  ? 'border-foreground font-medium'
                  : 'border-transparent text-black/50 hover:text-foreground dark:text-white/50'
              }`}
            >
              {FILTERS[key].label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-1.5 pb-2 text-xs text-black/50 dark:text-white/50">
          <span>Sort:</span>
          {(Object.keys(SORTS) as InboxSort[]).map((key) => (
            <Link
              key={key}
              href={`/topics/${topicId}?filter=${filter}&sort=${key}${labelParam}${queryParam}`}
              className={`rounded px-2 py-1 ${
                key === sort
                  ? 'bg-black/10 font-medium text-foreground dark:bg-white/15'
                  : 'hover:text-foreground'
              }`}
            >
              {SORTS[key]}
            </Link>
          ))}
        </div>
      </nav>

      {labels.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-black/50 dark:text-white/50">
          <span>Label:</span>
          <Link
            href={`/topics/${topicId}?filter=${filter}&sort=${sort}${queryParam}`}
            className={`rounded-full px-2.5 py-1 ${
              label === undefined
                ? 'bg-black/10 font-medium text-foreground dark:bg-white/15'
                : 'hover:text-foreground'
            }`}
          >
            All
          </Link>
          {labels.map((l) => (
            <Link
              key={l}
              href={`/topics/${topicId}?filter=${filter}&sort=${sort}&label=${encodeURIComponent(l)}${queryParam}`}
              className={`rounded-full px-2.5 py-1 ${
                label === l
                  ? 'bg-black/10 font-medium text-foreground dark:bg-white/15'
                  : 'hover:text-foreground'
              }`}
            >
              {l}
            </Link>
          ))}
          <Link
            href={`/topics/${topicId}?filter=${filter}&sort=${sort}&label=${UNLABELED}${queryParam}`}
            className={`rounded-full px-2.5 py-1 ${
              label === null
                ? 'bg-black/10 font-medium text-foreground dark:bg-white/15'
                : 'hover:text-foreground'
            }`}
          >
            Unlabeled
          </Link>
        </div>
      )}

      {typeof label === 'string' && <LabelSuggestions topicId={topicId} label={label} />}

      {papers.length === 0 ? (
        <p className="mt-10 text-center text-sm text-black/50 dark:text-white/50">
          {search
            ? `No papers match “${search}”.`
            : filter === 'inbox' || filter === 'new'
              ? searchedAt
                ? 'Nothing new since the last search.'
                : 'Not searched yet — hit “Refresh now” on the topics page.'
              : 'Nothing here.'}
        </p>
      ) : (
        <ul className="mt-6 space-y-5">
          {papers.map((paper) => (
            <li
              key={paper.paperId}
              className="rounded-lg border border-black/10 p-4 dark:border-white/15"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-medium leading-snug">
                  <Link
                    href={`/topics/${topicId}/papers/${paper.paperId}`}
                    className="hover:underline underline-offset-4"
                  >
                    {paper.title}
                  </Link>
                </h2>
                <ScoreBadge score={paper.relevanceScore} />
              </div>

              <p className="mt-2 text-xs text-black/45 dark:text-white/45">
                {paper.authors.slice(0, 4).join(', ')}
                {paper.authors.length > 4 && ' et al.'}
                {' · '}
                {paper.publishedAt.toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
                {' · '}
                {paper.categories.join(', ')}
              </p>

              <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-black/70 dark:text-white/70">
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
                  <PaperActions
                    topicId={topicId}
                    paperId={paper.paperId}
                    current={paper.state}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <Pagination className="mt-8">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href={pageHref(Math.max(1, page - 1))}
                aria-disabled={page === 1}
                className={page === 1 ? 'pointer-events-none opacity-50' : undefined}
              />
            </PaginationItem>

            {pageRange(page, totalPages).map((p, i) =>
              p === 'ellipsis' ? (
                <PaginationItem key={`ellipsis-${i}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={p}>
                  <PaginationLink href={pageHref(p)} isActive={p === page}>
                    {p}
                  </PaginationLink>
                </PaginationItem>
              ),
            )}

            <PaginationItem>
              <PaginationNext
                href={pageHref(Math.min(totalPages, page + 1))}
                aria-disabled={page === totalPages}
                className={page === totalPages ? 'pointer-events-none opacity-50' : undefined}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </main>
  )
}
