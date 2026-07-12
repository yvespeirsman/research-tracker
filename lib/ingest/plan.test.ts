import { describe, expect, it } from 'vitest'
import type { ArxivPaper } from '@/lib/arxiv'
import { dedupeFound, rotateToCursor } from './plan'
import type { FoundPaper } from './types'

const ids = (ts: { id: number }[]) => ts.map((t) => t.id)
const topics = [{ id: 1 }, { id: 3 }, { id: 5 }, { id: 7 }]

describe('rotateToCursor', () => {
  it('returns the list unchanged when there is no cursor', () => {
    expect(ids(rotateToCursor(topics, null))).toEqual([1, 3, 5, 7])
  })

  it('starts at the cursor and wraps around', () => {
    expect(ids(rotateToCursor(topics, 5))).toEqual([5, 7, 1, 3])
  })

  it('is a no-op when the cursor is the first topic', () => {
    expect(ids(rotateToCursor(topics, 1))).toEqual([1, 3, 5, 7])
  })

  it('starts at the next surviving topic when the cursor was deleted', () => {
    expect(ids(rotateToCursor(topics, 4))).toEqual([5, 7, 1, 3])
  })

  it('falls back to the natural order when the cursor is past every topic', () => {
    expect(ids(rotateToCursor(topics, 99))).toEqual([1, 3, 5, 7])
  })

  it('handles an empty topic list', () => {
    expect(rotateToCursor([], 3)).toEqual([])
  })
})

const paper = (arxivId: string): ArxivPaper => ({
  arxivId,
  version: 1,
  title: `T${arxivId}`,
  abstract: 'a',
  authors: [],
  categories: [],
  publishedAt: new Date(0),
  updatedAt: new Date(0),
  absUrl: 'u',
  pdfUrl: null,
})

const found = (arxivId: string, matchedQuery: string): FoundPaper => ({
  paper: paper(arxivId),
  matchedQuery,
})

describe('dedupeFound', () => {
  it('keeps one entry per paper', () => {
    const result = dedupeFound([found('1', 'qA'), found('1', 'qB'), found('2', 'qB')])
    expect(result.map((f) => f.paper.arxivId)).toEqual(['1', '2'])
  })

  it('attributes a paper to the first query that found it', () => {
    const result = dedupeFound([found('1', 'qA'), found('1', 'qB')])
    expect(result[0].matchedQuery).toBe('qA')
  })

  it('passes an empty list through', () => {
    expect(dedupeFound([])).toEqual([])
  })
})
