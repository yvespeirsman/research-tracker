import { getTopic, listReportPapers, type ReportFilter } from '@/lib/queries'
import { streamReport } from '@/lib/reports'

function parseFilter(body: Record<string, unknown>): ReportFilter | null {
  const filter = body.filter
  if (typeof filter !== 'object' || filter === null) return null
  const { type, label, days } = filter as Record<string, unknown>

  if (type === 'label') {
    return typeof label === 'string' && label.trim() ? { type: 'label', label } : null
  }
  if (type === 'recent') {
    return typeof days === 'number' && days > 0 ? { type: 'recent', days } : null
  }
  return null
}

/**
 * Streams a markdown research report for a topic, scoped to a label or to the
 * last N days. A Route Handler rather than a Server Action because the point is
 * to stream tokens progressively; Server Actions return a single response.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null)
  if (typeof body !== 'object' || body === null) {
    return new Response('Invalid request body', { status: 400 })
  }

  const topicId = Number((body as Record<string, unknown>).topicId)
  const filter = parseFilter(body as Record<string, unknown>)

  if (!Number.isInteger(topicId) || !filter) {
    return new Response('Invalid request body', { status: 400 })
  }

  const topic = await getTopic(topicId)
  if (!topic) return new Response('Topic not found', { status: 404 })

  const reportPapers = await listReportPapers(topicId, filter)
  if (reportPapers.length === 0) {
    // No point paying for an LLM call when there's nothing to report on.
    return new Response('No papers match this filter.', { status: 422 })
  }

  const result = streamReport(topic, reportPapers, filter)
  return result.toTextStreamResponse()
}
