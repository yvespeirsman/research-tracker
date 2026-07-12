import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { monthFromArxivId, normalizeArxivId, parseAtomFeed, parseFeed } from './parse'

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')

describe('normalizeArxivId', () => {
  it('strips the version from a modern id and returns it separately', () => {
    expect(normalizeArxivId('http://arxiv.org/abs/2401.12345v3')).toEqual({
      arxivId: '2401.12345',
      version: 3,
    })
  })

  it('handles old-style category-prefixed ids', () => {
    expect(normalizeArxivId('http://arxiv.org/abs/cs/0501001v2')).toEqual({
      arxivId: 'cs/0501001',
      version: 2,
    })
  })

  it('defaults to version 1 when no version suffix is present', () => {
    expect(normalizeArxivId('http://arxiv.org/abs/2401.12345')).toEqual({
      arxivId: '2401.12345',
      version: 1,
    })
  })

  it('dedupes across versions: two versions map to the same arxivId', () => {
    const v1 = normalizeArxivId('http://arxiv.org/abs/2401.12345v1')
    const v7 = normalizeArxivId('http://arxiv.org/abs/2401.12345v7')
    expect(v1.arxivId).toBe(v7.arxivId)
    expect(v1.version).not.toBe(v7.version)
  })
})

describe('monthFromArxivId', () => {
  it('reads year and month from a modern id', () => {
    expect(monthFromArxivId('2401.12345')).toBe('2024-01')
  })

  it('reads year and month from a legacy category-prefixed id, 1990s', () => {
    expect(monthFromArxivId('cs/9901001')).toBe('1999-01')
  })

  it('reads year and month from a legacy category-prefixed id, 2000s', () => {
    expect(monthFromArxivId('cs/0501001')).toBe('2005-01')
  })

  it('returns null for an unrecognized id', () => {
    expect(monthFromArxivId('not-an-id')).toBeNull()
  })
})

describe('parseAtomFeed', () => {
  it('parses a real multi-entry response', () => {
    const papers = parseAtomFeed(fixture('search.atom.xml'))
    expect(papers).toHaveLength(2)

    const [first] = papers
    expect(first.arxivId).toBe('2607.04088')
    expect(first.version).toBe(1)
    expect(first.title).toContain('Full-Text Temporal Retrieval')
    expect(first.authors).toEqual(['Yingdong Yang', 'Haijian Wu'])
    expect(first.categories).toEqual(['cs.IR', 'cs.AI'])
    expect(first.absUrl).toBe('https://arxiv.org/abs/2607.04088v1')
    expect(first.pdfUrl).toBe('https://arxiv.org/pdf/2607.04088v1')
    expect(first.publishedAt.toISOString()).toBe('2026-07-05T02:52:30.000Z')
    expect(first.updatedAt.toISOString()).toBe('2026-07-05T02:52:30.000Z')
    expect(first.abstract).toMatch(/^LongEval-Sci evaluates/)
  })

  it('coerces a lone author and category into arrays', () => {
    const [paper] = parseAtomFeed(fixture('single.atom.xml'))
    expect(paper.authors).toEqual(['Solo Author'])
    expect(paper.categories).toEqual(['cs.IR'])
    expect(paper.arxivId).toBe('cs/0501001')
    expect(paper.version).toBe(2)
  })

  it('collapses the whitespace arXiv wraps titles and abstracts with', () => {
    const [paper] = parseAtomFeed(fixture('single.atom.xml'))
    expect(paper.title).toBe('A Very Long Title That arXiv Wraps Across Lines')
    expect(paper.abstract).toBe('An abstract that also wraps across several lines.')
  })

  it('returns an empty array for a feed with no entries', () => {
    expect(parseAtomFeed(fixture('empty.atom.xml'))).toEqual([])
  })
})

describe('parseFeed', () => {
  it('reports totalResults independently of how many entries were returned', () => {
    // The fixture asked for 2 results out of 200 matches.
    const feed = parseFeed(fixture('search.atom.xml'))
    expect(feed.papers).toHaveLength(2)
    expect(feed.totalResults).toBe(200)
  })

  it('reports zero matches for an empty feed', () => {
    expect(parseFeed(fixture('empty.atom.xml')).totalResults).toBe(0)
  })

  it('falls back to the entry count when totalResults is absent', () => {
    const noTotal = `<?xml version='1.0' encoding='UTF-8'?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>http://arxiv.org/abs/2401.00001v1</id>
          <title>T</title>
          <summary>S</summary>
          <published>2026-01-01T00:00:00Z</published>
          <updated>2026-01-01T00:00:00Z</updated>
        </entry>
      </feed>`

    expect(parseFeed(noTotal).totalResults).toBe(1)
  })
})
