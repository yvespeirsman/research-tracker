import { beforeEach, describe, expect, it, vi } from 'vitest'

const getInboxPaper = vi.fn()
const fetchPaperFullText = vi.fn()
const streamPaperChat = vi.fn()

vi.mock('@/lib/queries', () => ({ getInboxPaper }))
vi.mock('@/lib/arxiv', () => ({ fetchPaperFullText }))
vi.mock('@/lib/paper-chat', () => ({ streamPaperChat }))

const { POST } = await import('./route')

const userMessage = (text: string) => ({ id: '1', role: 'user', parts: [{ type: 'text', text }] })

const request = (body: unknown) =>
  new Request('https://example.com/api/paper-chat', {
    method: 'POST',
    body: JSON.stringify(body),
  })

describe('POST /api/paper-chat', () => {
  beforeEach(() => {
    getInboxPaper.mockReset()
    fetchPaperFullText.mockReset()
    streamPaperChat.mockReset()
  })

  it('rejects a non-integer topicId', async () => {
    const response = await POST(
      request({ topicId: 'x', paperId: 1, messages: [userMessage('hi')] }),
    )

    expect(response.status).toBe(400)
    expect(getInboxPaper).not.toHaveBeenCalled()
  })

  it('rejects a non-integer paperId', async () => {
    const response = await POST(
      request({ topicId: 1, paperId: 'x', messages: [userMessage('hi')] }),
    )

    expect(response.status).toBe(400)
    expect(getInboxPaper).not.toHaveBeenCalled()
  })

  it('rejects an empty messages array', async () => {
    const response = await POST(request({ topicId: 1, paperId: 1, messages: [] }))

    expect(response.status).toBe(400)
    expect(getInboxPaper).not.toHaveBeenCalled()
  })

  it('rejects a missing messages field', async () => {
    const response = await POST(request({ topicId: 1, paperId: 1 }))

    expect(response.status).toBe(400)
  })

  it('404s when the paper does not exist', async () => {
    getInboxPaper.mockResolvedValue(null)

    const response = await POST(
      request({ topicId: 1, paperId: 1, messages: [userMessage('hi')] }),
    )

    expect(response.status).toBe(404)
    expect(fetchPaperFullText).not.toHaveBeenCalled()
  })

  it('streams a response for a valid request, using full text when available', async () => {
    const paper = { arxivId: '2401.00001', version: 2, title: 'P' }
    const messages = [userMessage('Summarize this')]
    getInboxPaper.mockResolvedValue(paper)
    fetchPaperFullText.mockResolvedValue('full text')
    const uiResponse = new Response('stream')
    streamPaperChat.mockResolvedValue({ toUIMessageStreamResponse: () => uiResponse })

    const response = await POST(request({ topicId: 1, paperId: 1, messages }))

    expect(response).toBe(uiResponse)
    expect(fetchPaperFullText).toHaveBeenCalledWith('2401.00001', 2)
    expect(streamPaperChat).toHaveBeenCalledWith(paper, 'full text', messages)
  })

  it('falls back to null full text when arXiv has no HTML rendering', async () => {
    const paper = { arxivId: '2401.00001', version: 1, title: 'P' }
    getInboxPaper.mockResolvedValue(paper)
    fetchPaperFullText.mockResolvedValue(null)
    const uiResponse = new Response('stream')
    streamPaperChat.mockResolvedValue({ toUIMessageStreamResponse: () => uiResponse })

    await POST(request({ topicId: 1, paperId: 1, messages: [userMessage('hi')] }))

    expect(streamPaperChat).toHaveBeenCalledWith(paper, null, [userMessage('hi')])
  })
})
