import { describe, expect, it } from 'vitest'
import { ExpansionError, MAX_QUERIES, rejectReason, sanitizeQueries } from './sanitize'

describe('rejectReason', () => {
  it('accepts well-formed expressions', () => {
    expect(rejectReason('abs:"graph neural network" AND cat:cs.LG')).toBeNull()
    expect(rejectReason('(ti:a OR ti:b) AND cat:cs.IR')).toBeNull()
    expect(rejectReason('  cat:cs.LG  ')).toBeNull()
  })

  it('rejects an empty expression', () => {
    expect(rejectReason('   ')).toMatch(/empty/i)
  })

  it('rejects a bare all: catch-all', () => {
    expect(rejectReason('all:learning')).toMatch(/too broad/i)
    expect(rejectReason('all:"transformers"')).toMatch(/too broad/i)
  })

  it('accepts a constrained all: expression', () => {
    expect(rejectReason('all:"retrieval augmented generation" AND cat:cs.CL')).toBeNull()
  })

  it('rejects unbalanced parentheses', () => {
    expect(rejectReason('(ti:a OR ti:b')).toMatch(/unbalanced/i)
    expect(rejectReason('ti:a)')).toMatch(/unbalanced/i)
  })

  it('rejects unbalanced quotes', () => {
    expect(rejectReason('abs:"graph neural network')).toMatch(/unbalanced/i)
  })

  it('rejects an expression with no field prefix', () => {
    expect(rejectReason('graph neural networks')).toMatch(/field prefix/i)
  })
})

describe('sanitizeQueries', () => {
  it('trims and keeps well-formed expressions', () => {
    expect(sanitizeQueries(['  ti:"graph neural network" ', 'cat:cs.LG'])).toEqual([
      'ti:"graph neural network"',
      'cat:cs.LG',
    ])
  })

  it('drops blank entries', () => {
    expect(sanitizeQueries(['cat:cs.LG', '', '   '])).toEqual(['cat:cs.LG'])
  })

  it('dedupes case-insensitively, keeping the first spelling', () => {
    expect(sanitizeQueries(['cat:cs.LG', 'CAT:CS.LG'])).toEqual(['cat:cs.LG'])
  })

  it('drops single-word all: catch-alls that would flood the inbox', () => {
    expect(sanitizeQueries(['all:learning', 'cat:cs.LG'])).toEqual(['cat:cs.LG'])
    expect(sanitizeQueries(['all:"transformers"', 'cat:cs.LG'])).toEqual(['cat:cs.LG'])
  })

  it('keeps all: expressions that are actually constrained', () => {
    const q = 'all:"retrieval augmented generation" AND cat:cs.CL'
    expect(sanitizeQueries([q])).toEqual([q])
  })

  it(`caps the list at ${MAX_QUERIES} expressions`, () => {
    const many = Array.from({ length: 20 }, (_, i) => `ti:"topic ${i}"`)
    expect(sanitizeQueries(many)).toHaveLength(MAX_QUERIES)
  })

  it('throws when nothing usable survives', () => {
    expect(() => sanitizeQueries(['', '  ', 'all:learning'])).toThrow(ExpansionError)
  })
})
