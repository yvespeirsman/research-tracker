import { describe, expect, it, vi } from 'vitest'
import { ArxivError } from '@/lib/arxiv'
import { validateQuery } from './validate'

const counts = (n: number) => vi.fn(async () => n)

describe('validateQuery', () => {
  it('accepts an expression that matches papers, reporting the count', async () => {
    const result = await validateQuery('cat:cs.IR', { count: counts(1234) })

    expect(result).toEqual({ status: 'ok', count: 1234 })
  })

  it('flags a syntactically valid expression that matches nothing', async () => {
    const result = await validateQuery('abs:"zzzz nonexistent"', { count: counts(0) })

    expect(result).toEqual({ status: 'empty', count: 0 })
  })

  it('rejects bad syntax without spending an arXiv request', async () => {
    const count = counts(1)

    const result = await validateQuery('(ti:a', { count })

    expect(result.status).toBe('invalid')
    expect(count).not.toHaveBeenCalled()
  })

  it('rejects a bare all: catch-all without spending an arXiv request', async () => {
    const count = counts(999999)

    const result = await validateQuery('all:learning', { count })

    expect(result.status).toBe('invalid')
    expect(count).not.toHaveBeenCalled()
  })

  it('rejects a duplicate of an existing expression, ignoring case and padding', async () => {
    const count = counts(5)

    const result = await validateQuery('  CAT:CS.IR ', {
      existing: ['cat:cs.IR'],
      count,
    })

    expect(result).toEqual({
      status: 'invalid',
      reason: 'This topic already has that expression.',
    })
    expect(count).not.toHaveBeenCalled()
  })

  it('allows an expression that differs from the existing ones', async () => {
    const result = await validateQuery('cat:cs.LG', {
      existing: ['cat:cs.IR'],
      count: counts(10),
    })

    expect(result.status).toBe('ok')
  })

  it('reports an arXiv rejection as invalid rather than as zero matches', async () => {
    const count = vi.fn(async () => {
      throw new ArxivError('arXiv rejected the query')
    })

    const result = await validateQuery('cat:cs.IR', { count })

    expect(result).toEqual({ status: 'invalid', reason: 'arXiv rejected this expression.' })
  })

  it('propagates a network failure instead of calling it invalid', async () => {
    const count = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })

    await expect(validateQuery('cat:cs.IR', { count })).rejects.toThrow('fetch failed')
  })

  it('trims before validating', async () => {
    const count = counts(3)

    await validateQuery('   cat:cs.IR   ', { count })

    expect(count).toHaveBeenCalledWith('cat:cs.IR')
  })
})
