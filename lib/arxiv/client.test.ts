import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { ArxivError, countArxivResults, searchArxiv } from './client'
import type { Scheduler } from './rate-limit'

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')

/** Runs tasks immediately — the real limiter's 3s spacing is tested separately. */
const immediate: Scheduler = (task) => task()

const stubFetch = (body: string, init: { ok?: boolean } = {}) =>
  vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
    new Response(body, { status: init.ok === false ? 500 : 200 }),
  )

const requestedUrl = (fetchMock: ReturnType<typeof stubFetch>) =>
  new URL(String(fetchMock.mock.calls[0][0]))

describe('searchArxiv', () => {
  it('parses papers out of a successful response', async () => {
    const fetchImpl = stubFetch(fixture('search.atom.xml'))
    const papers = await searchArxiv('cat:cs.IR', { fetchImpl, schedule: immediate })

    expect(papers).toHaveLength(2)
    expect(papers[0].arxivId).toBe('2607.04088')
  })

  it('sends a date-windowed, descending-by-date query', async () => {
    const fetchImpl = stubFetch(fixture('empty.atom.xml'))
    await searchArxiv('cat:cs.IR', {
      since: new Date('2026-07-01T00:00:00Z'),
      until: new Date('2026-07-02T00:00:00Z'),
      fetchImpl,
      schedule: immediate,
    })

    const url = requestedUrl(fetchImpl)
    expect(url.searchParams.get('search_query')).toBe(
      '(cat:cs.IR) AND submittedDate:[202607010000 TO 202607020000]',
    )
    expect(url.searchParams.get('sortBy')).toBe('submittedDate')
    expect(url.searchParams.get('sortOrder')).toBe('descending')
  })

  it("clamps max_results to arXiv's 2000 ceiling", async () => {
    const fetchImpl = stubFetch(fixture('empty.atom.xml'))
    await searchArxiv('cat:cs.IR', { maxResults: 999999, fetchImpl, schedule: immediate })

    expect(requestedUrl(fetchImpl).searchParams.get('max_results')).toBe('2000')
  })

  it('throws on a non-200 response', async () => {
    const fetchImpl = stubFetch('nope', { ok: false })
    await expect(
      searchArxiv('cat:cs.IR', { fetchImpl, schedule: immediate }),
    ).rejects.toThrow(ArxivError)
  })

  it('throws on an error feed returned with HTTP 200', async () => {
    const fetchImpl = stubFetch(fixture('error.atom.xml'))
    await expect(
      searchArxiv('bogus', { fetchImpl, schedule: immediate }),
    ).rejects.toThrow(/arXiv rejected the query/)
  })

  it('routes the request through the rate limiter', async () => {
    const fetchImpl = stubFetch(fixture('empty.atom.xml'))
    let scheduled = 0
    const schedule: Scheduler = (task) => {
      scheduled += 1
      return task()
    }

    await searchArxiv('cat:cs.IR', { fetchImpl, schedule })

    expect(scheduled).toBe(1)
  })
})

describe('countArxivResults', () => {
  it('returns the total match count, not the number of entries fetched', async () => {
    const fetchImpl = stubFetch(fixture('search.atom.xml'))

    const count = await countArxivResults('cat:cs.IR', { fetchImpl, schedule: immediate })

    expect(count).toBe(200)
  })

  it('returns zero for an expression that matches nothing', async () => {
    const fetchImpl = stubFetch(fixture('empty.atom.xml'))

    expect(await countArxivResults('bogus', { fetchImpl, schedule: immediate })).toBe(0)
  })

  it('asks for a single result, since only the count is needed', async () => {
    const fetchImpl = stubFetch(fixture('empty.atom.xml'))

    await countArxivResults('cat:cs.IR', { fetchImpl, schedule: immediate })

    expect(requestedUrl(fetchImpl).searchParams.get('max_results')).toBe('1')
  })

  it('searches over all time, with no date window', async () => {
    const fetchImpl = stubFetch(fixture('empty.atom.xml'))

    await countArxivResults('cat:cs.IR', { fetchImpl, schedule: immediate })

    expect(requestedUrl(fetchImpl).searchParams.get('search_query')).toBe('cat:cs.IR')
  })

  it('throws on an error feed so an invalid expression is not read as zero matches', async () => {
    const fetchImpl = stubFetch(fixture('error.atom.xml'))

    await expect(
      countArxivResults('bogus', { fetchImpl, schedule: immediate }),
    ).rejects.toThrow(ArxivError)
  })
})

describe('rate limiting', () => {
  it('routes counting through the rate limiter too', async () => {
    const fetchImpl = stubFetch(fixture('empty.atom.xml'))
    let scheduled = 0
    const schedule: Scheduler = (task) => {
      scheduled += 1
      return task()
    }

    await countArxivResults('cat:cs.IR', { fetchImpl, schedule })

    expect(scheduled).toBe(1)
  })
})
