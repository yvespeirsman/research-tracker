import { anthropic } from '@ai-sdk/anthropic'
import { streamText, type LanguageModel } from 'ai'
import type { Topic } from '@/drizzle/schema'
import { MODEL } from '@/lib/anthropic'
import type { ReportFilter, ReportPaper } from '@/lib/queries'

const SYSTEM = `You write a research report synthesizing a set of arXiv papers for a
researcher tracking a specific topic.

Structure:
- Open with a short paragraph on the overall themes and trends across the papers.
- Group related papers together under headings when a clear grouping exists;
  otherwise discuss them in a sensible order.
- For each paper you discuss, name it and note what's notable about it — do not
  just restate the abstract.
- Close with what stands out most, if anything does.

Links:
- Each paper's source block below has a "Link:" line — its page in the
  researcher's own tracker app. The first time you name a paper, make its title
  a markdown link to that exact URL, e.g. [Paper Title](the link line's URL).
  Copy the URL exactly as given; do not alter it, shorten it, or link to arXiv
  instead.
- Only link a paper once, at its first mention.

Rules:
- Base every claim only on the titles/abstracts given. Do not invent details,
  results, or comparisons the abstracts don't support.
- Write in markdown. Do not wrap the whole response in a code fence.
- Match length to the material: a handful of papers gets a few short paragraphs,
  dozens get a longer, sectioned report. Don't pad.`

function describeFilter(filter: ReportFilter): string {
  return filter.type === 'label'
    ? `papers labeled "${filter.label}"`
    : `papers from the last ${filter.days} days`
}

export type ReportTopic = Pick<Topic, 'id' | 'name' | 'description'>

/** The topic's page for a paper, opened by the report's inline links. */
function paperUrl(topicId: number, paperId: number): string {
  return `/topics/${topicId}/papers/${paperId}`
}

/** Pure prompt construction, kept separate from `streamReport` so it's testable without a model. */
export function buildReportPrompt(
  topic: ReportTopic,
  reportPapers: ReportPaper[],
  filter: ReportFilter,
): string {
  const list = reportPapers
    .map((p) => {
      const label = p.label ? ` [label: ${p.label}]` : ''
      const date = p.publishedAt.toISOString().slice(0, 10)
      const link = paperUrl(topic.id, p.paperId)
      return `### ${p.title}${label}\n${p.authors.join(', ')} — ${date} — arXiv:${p.arxivId}\nLink: ${link}\n\n${p.abstract}`
    })
    .join('\n\n')

  return `<topic name="${topic.name}">${topic.description}</topic>

Write a report on ${describeFilter(filter)} for this topic, covering ${reportPapers.length} paper${
    reportPapers.length === 1 ? '' : 's'
  }.

<papers>
${list}
</papers>`
}

export interface StreamReportOptions {
  /** Overrides the model, for test injection. */
  model?: LanguageModel
}

/** Streams a markdown research report synthesizing `reportPapers` for `topic`. */
export function streamReport(
  topic: ReportTopic,
  reportPapers: ReportPaper[],
  filter: ReportFilter,
  options: StreamReportOptions = {},
) {
  return streamText({
    model: options.model ?? anthropic(MODEL),
    system: SYSTEM,
    prompt: buildReportPrompt(topic, reportPapers, filter),
  })
}
