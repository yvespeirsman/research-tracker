import { XMLParser } from 'fast-xml-parser'
import type { ArxivPaper } from './types'

/**
 * `parseTagValue: false` keeps every text node a string — without it a title
 * like "1984" would come back as a number.
 *
 * `isArray` forces the repeatable child elements into arrays even when an entry
 * has exactly one author, category, or link.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
  isArray: (name, jpath) =>
    jpath === 'feed.entry' ||
    jpath === 'feed.entry.author' ||
    jpath === 'feed.entry.category' ||
    jpath === 'feed.entry.link',
})

/** arXiv wraps long titles and abstracts across lines; flatten them back out. */
const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * Split `http://arxiv.org/abs/2401.12345v3` into a stable id and its version, so
 * a paper that gets resubmitted dedupes onto the row we already have. Handles
 * the old category-prefixed form (`cs/0501001v2`) too.
 */
export function normalizeArxivId(idUrl: string): { arxivId: string; version: number } {
  const raw = idUrl.replace(/^https?:\/\/arxiv\.org\/abs\//, '')
  const match = raw.match(/^(.*?)v(\d+)$/)
  if (!match) return { arxivId: raw, version: 1 }
  return { arxivId: match[1], version: Number(match[2]) }
}

/**
 * The submission year and month are baked into every arXiv id: `YYMM` right
 * before the dot in the modern form, or right after the archive slash in the
 * pre-2007 form. `YY` is ambiguous on its own, so old-style ids (used only
 * 1991–2007) resolve 91-99 to the 1990s and 00-07 to the 2000s.
 */
export function monthFromArxivId(arxivId: string): string | null {
  const modern = arxivId.match(/^(\d{2})(\d{2})\.\d+$/)
  const legacy = arxivId.match(/^[a-z-]+(?:\.[A-Z]{2})?\/(\d{2})(\d{2})\d+$/i)
  const match = modern ?? legacy
  if (!match) return null

  const yy = Number(match[1])
  const month = match[2]
  const year = modern ? 2000 + yy : yy >= 91 ? 1900 + yy : 2000 + yy
  return `${year}-${month}`
}

interface AtomLink {
  '@_href': string
  '@_rel'?: string
  '@_title'?: string
}

interface AtomEntry {
  id: string
  title: string
  summary: string
  published: string
  updated: string
  author?: { name: string }[]
  category?: { '@_term': string }[]
  link?: AtomLink[]
}

export interface ArxivFeed {
  papers: ArxivPaper[]
  /** `opensearch:totalResults` — how many papers match, ignoring pagination. */
  totalResults: number
}

export function parseFeed(xml: string): ArxivFeed {
  const feed = parser.parse(xml)?.feed
  const entries: AtomEntry[] = feed?.entry ?? []
  const total = Number(feed?.['opensearch:totalResults'])

  const papers = entries.map((entry) => {
    const { arxivId, version } = normalizeArxivId(entry.id)
    const links = entry.link ?? []

    const pdf = links.find((l) => l['@_title'] === 'pdf')
    const alternate = links.find((l) => l['@_rel'] === 'alternate')

    return {
      arxivId,
      version,
      title: collapse(entry.title),
      abstract: collapse(entry.summary),
      authors: (entry.author ?? []).map((a) => a.name),
      categories: (entry.category ?? []).map((c) => c['@_term']),
      publishedAt: new Date(entry.published),
      updatedAt: new Date(entry.updated),
      absUrl: alternate?.['@_href'] ?? entry.id,
      pdfUrl: pdf?.['@_href'] ?? null,
    }
  })

  return { papers, totalResults: Number.isFinite(total) ? total : papers.length }
}

export function parseAtomFeed(xml: string): ArxivPaper[] {
  return parseFeed(xml).papers
}
