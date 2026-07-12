import type { UIMessage } from 'ai'
import { fetchPaperFullText } from '@/lib/arxiv'
import { getInboxPaper } from '@/lib/queries'
import { streamPaperChat } from '@/lib/paper-chat'

function parseMessages(body: Record<string, unknown>): UIMessage[] | null {
  return Array.isArray(body.messages) && body.messages.length > 0
    ? (body.messages as UIMessage[])
    : null
}

/** Generous ceiling: fetching+parsing a PDF (the fallback when arXiv has no HTML rendering) can be slow. */
export const maxDuration = 60

/**
 * Streams a chat response about one paper. A Route Handler rather than a
 * Server Action because the point is to stream tokens progressively; Server
 * Actions return a single response.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null)
  if (typeof body !== 'object' || body === null) {
    return new Response('Invalid request body', { status: 400 })
  }

  const { topicId: rawTopicId, paperId: rawPaperId } = body as Record<string, unknown>
  const topicId = Number(rawTopicId)
  const paperId = Number(rawPaperId)
  const messages = parseMessages(body as Record<string, unknown>)

  if (!Number.isInteger(topicId) || !Number.isInteger(paperId) || !messages) {
    return new Response('Invalid request body', { status: 400 })
  }

  const paper = await getInboxPaper(topicId, paperId)
  if (!paper) return new Response('Paper not found', { status: 404 })

  const fullText = await fetchPaperFullText(paper.arxivId, paper.version)

  const result = await streamPaperChat(paper, fullText, messages)
  return result.toUIMessageStreamResponse()
}
