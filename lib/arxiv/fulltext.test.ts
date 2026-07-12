import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getDocumentProxy = vi.fn()
const extractText = vi.fn()
vi.mock('unpdf', () => ({ getDocumentProxy, extractText }))

const { extractPaperText, fetchPaperFullText } = await import('./fulltext')

describe('extractPaperText', () => {
  it('extracts plain text from within the article tag', () => {
    const html = `<html><body><nav>Skip this</nav><article class="ltx_document">
      <h1>Title</h1>
      <p>First paragraph.</p>
      <p>Second paragraph.</p>
    </article><footer>Skip this too</footer></body></html>`

    const text = extractPaperText(html)

    expect(text).toContain('Title')
    expect(text).toContain('First paragraph.')
    expect(text).toContain('Second paragraph.')
    expect(text).not.toContain('Skip this')
  })

  it('strips script and style blocks', () => {
    const html = `<article><script>evil()</script><style>.a{color:red}</style><p>Real content</p></article>`

    const text = extractPaperText(html)

    expect(text).toContain('Real content')
    expect(text).not.toContain('evil()')
    expect(text).not.toContain('color:red')
  })

  it('decodes common HTML entities', () => {
    const html = `<article><p>A &amp; B &lt;tag&gt; &quot;quoted&quot; &#39;s&#39;</p></article>`

    expect(extractPaperText(html)).toContain(`A & B <tag> "quoted" 's'`)
  })

  it('falls back to the whole document when there is no article tag', () => {
    const html = `<html><body><p>Just a body</p></body></html>`

    expect(extractPaperText(html)).toContain('Just a body')
  })
})

describe('fetchPaperFullText', () => {
  beforeEach(() => {
    getDocumentProxy.mockReset()
    extractText.mockReset()
  })

  it('returns extracted text on a successful fetch', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('<article><p>Paper content</p></article>', { status: 200 }),
    )

    const text = await fetchPaperFullText('2401.00001', 1, { fetchImpl })

    expect(text).toContain('Paper content')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://arxiv.org/html/2401.00001v1',
      expect.objectContaining({ headers: expect.objectContaining({ 'User-Agent': expect.any(String) }) }),
    )
  })

  it('returns null when neither the HTML nor the PDF fetch succeeds', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }))

    expect(await fetchPaperFullText('2401.00001', 1, { fetchImpl })).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('returns null when both fetches throw', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network error'))

    expect(await fetchPaperFullText('2401.00001', 1, { fetchImpl })).toBeNull()
  })

  it('falls back to the PDF when there is no HTML rendering', async () => {
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/html/')) return new Response('not found', { status: 404 })
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    })
    const fakePdf = { totalPages: 1 }
    getDocumentProxy.mockResolvedValue(fakePdf)
    extractText.mockResolvedValue({ totalPages: 1, text: 'Text extracted from the PDF.' })

    const text = await fetchPaperFullText('2401.00001', 3, { fetchImpl })

    expect(text).toBe('Text extracted from the PDF.')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://arxiv.org/html/2401.00001v3',
      expect.anything(),
    )
    expect(fetchImpl).toHaveBeenCalledWith('https://arxiv.org/pdf/2401.00001v3', expect.anything())
    expect(extractText).toHaveBeenCalledWith(fakePdf, { mergePages: true })
  })

  it('does not fall back to the PDF when the HTML rendering succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('<article><p>HTML content</p></article>', { status: 200 }))

    const text = await fetchPaperFullText('2401.00001', 1, { fetchImpl })

    expect(text).toContain('HTML content')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(getDocumentProxy).not.toHaveBeenCalled()
  })

  it('returns null when the PDF fails to parse', async () => {
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/html/')) return new Response('not found', { status: 404 })
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    })
    getDocumentProxy.mockRejectedValue(new Error('bad PDF'))

    expect(await fetchPaperFullText('2401.00001', 1, { fetchImpl })).toBeNull()
  })

  it('truncates very long text', async () => {
    const longParagraph = 'word '.repeat(20_000)
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(`<article><p>${longParagraph}</p></article>`, { status: 200 }),
    )

    const text = await fetchPaperFullText('2401.00001', 1, { fetchImpl })

    expect(text).not.toBeNull()
    expect(text!.length).toBeLessThan(longParagraph.length)
    expect(text).toContain('[Full text truncated for length.]')
  })
})

describe('fetchPaperFullText caching (no fetchImpl override)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('caches a successful fetch so a second call skips the network', async () => {
    const globalFetch = vi
      .fn()
      .mockResolvedValue(new Response('<article><p>Cached content</p></article>', { status: 200 }))
    vi.stubGlobal('fetch', globalFetch)

    const first = await fetchPaperFullText('2401.55501', 1)
    const second = await fetchPaperFullText('2401.55501', 1)

    expect(first).toContain('Cached content')
    expect(second).toBe(first)
    expect(globalFetch).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failed fetch, so a later call retries', async () => {
    const globalFetch = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }))
    vi.stubGlobal('fetch', globalFetch)

    expect(await fetchPaperFullText('2401.55502', 1)).toBeNull()
    expect(await fetchPaperFullText('2401.55502', 1)).toBeNull()

    // html + pdf attempts, twice
    expect(globalFetch).toHaveBeenCalledTimes(4)
  })
})
