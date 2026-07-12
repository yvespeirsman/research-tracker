import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runIngest = vi.fn()

vi.mock('@/lib/ingest', () => ({
  runIngest,
  getDrizzleStore: () => ({}),
}))

const { GET } = await import('./route')

const request = (headers: Record<string, string> = {}) =>
  new Request('https://example.com/api/cron/ingest', { headers })

describe('GET /api/cron/ingest', () => {
  const original = process.env.CRON_SECRET

  beforeEach(() => {
    runIngest.mockReset()
    process.env.CRON_SECRET = 's3cret'
  })

  afterEach(() => {
    process.env.CRON_SECRET = original
  })

  it('rejects a request with no authorization header', async () => {
    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(runIngest).not.toHaveBeenCalled()
  })

  it('rejects a wrong secret', async () => {
    const response = await GET(request({ authorization: 'Bearer wrong' }))

    expect(response.status).toBe(401)
    expect(runIngest).not.toHaveBeenCalled()
  })

  it('rejects a bare secret without the Bearer scheme', async () => {
    const response = await GET(request({ authorization: 's3cret' }))

    expect(response.status).toBe(401)
    expect(runIngest).not.toHaveBeenCalled()
  })

  it('refuses to run when CRON_SECRET is unset rather than allowing everyone', async () => {
    delete process.env.CRON_SECRET

    const response = await GET(request({ authorization: 'Bearer anything' }))

    expect(response.status).toBe(500)
    expect(runIngest).not.toHaveBeenCalled()
  })

  it('runs ingestion and returns the summary for a valid secret', async () => {
    const summary = {
      runId: 1,
      status: 'completed',
      topicsProcessed: 2,
      papersFound: 5,
      resumeCursor: null,
      error: null,
    }
    runIngest.mockResolvedValue(summary)

    const response = await GET(request({ authorization: 'Bearer s3cret' }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(summary)
    expect(runIngest).toHaveBeenCalledOnce()
  })

  it('reports a failed run as 200 with the error in the body', async () => {
    runIngest.mockResolvedValue({
      runId: 2,
      status: 'failed',
      topicsProcessed: 0,
      papersFound: 0,
      resumeCursor: null,
      error: 'arXiv is down',
    })

    const response = await GET(request({ authorization: 'Bearer s3cret' }))

    expect(response.status).toBe(200)
    expect((await response.json()).error).toBe('arXiv is down')
  })
})
