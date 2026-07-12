import { beforeEach, describe, expect, it, vi } from 'vitest'

const getTopic = vi.fn()
const listReportPapers = vi.fn()
const streamReport = vi.fn()

vi.mock('@/lib/queries', () => ({ getTopic, listReportPapers }))
vi.mock('@/lib/reports', () => ({ streamReport }))

const { POST } = await import('./route')

const request = (body: unknown) =>
  new Request('https://example.com/api/reports', {
    method: 'POST',
    body: JSON.stringify(body),
  })

describe('POST /api/reports', () => {
  beforeEach(() => {
    getTopic.mockReset()
    listReportPapers.mockReset()
    streamReport.mockReset()
  })

  it('rejects a non-integer topicId', async () => {
    const response = await POST(request({ topicId: 'x', filter: { type: 'recent', days: 30 } }))

    expect(response.status).toBe(400)
    expect(getTopic).not.toHaveBeenCalled()
  })

  it('rejects a malformed filter', async () => {
    const response = await POST(request({ topicId: 1, filter: { type: 'nonsense' } }))

    expect(response.status).toBe(400)
    expect(getTopic).not.toHaveBeenCalled()
  })

  it('rejects a label filter with an empty label', async () => {
    const response = await POST(request({ topicId: 1, filter: { type: 'label', label: '  ' } }))

    expect(response.status).toBe(400)
  })

  it('rejects a recent filter with non-positive days', async () => {
    const response = await POST(request({ topicId: 1, filter: { type: 'recent', days: 0 } }))

    expect(response.status).toBe(400)
  })

  it('404s when the topic does not exist', async () => {
    getTopic.mockResolvedValue(null)

    const response = await POST(request({ topicId: 1, filter: { type: 'recent', days: 30 } }))

    expect(response.status).toBe(404)
    expect(listReportPapers).not.toHaveBeenCalled()
  })

  it('422s and skips the LLM call when no papers match', async () => {
    getTopic.mockResolvedValue({ id: 1, name: 'T', description: 'd' })
    listReportPapers.mockResolvedValue([])

    const response = await POST(request({ topicId: 1, filter: { type: 'label', label: 'x' } }))

    expect(response.status).toBe(422)
    expect(streamReport).not.toHaveBeenCalled()
  })

  it('streams a report for a valid request', async () => {
    const topic = { id: 1, name: 'T', description: 'd' }
    const papers = [{ paperId: 1, title: 'P' }]
    getTopic.mockResolvedValue(topic)
    listReportPapers.mockResolvedValue(papers)
    const textResponse = new Response('report text')
    streamReport.mockReturnValue({ toTextStreamResponse: () => textResponse })

    const filter = { type: 'label' as const, label: 'agents' }
    const response = await POST(request({ topicId: 1, filter }))

    expect(response).toBe(textResponse)
    expect(streamReport).toHaveBeenCalledWith(topic, papers, filter)
  })
})
