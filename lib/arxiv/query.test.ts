import { describe, expect, it } from 'vitest'
import { formatArxivDate, withDateWindow } from './query'

describe('formatArxivDate', () => {
  it('formats as YYYYMMDDHHMM in UTC', () => {
    expect(formatArxivDate(new Date('2026-07-05T02:52:30Z'))).toBe('202607050252')
  })

  it('zero-pads every component', () => {
    expect(formatArxivDate(new Date('2026-01-02T03:04:00Z'))).toBe('202601020304')
  })

  it('uses UTC rather than local time', () => {
    // 23:30 UTC — a local-time formatter in a negative offset would roll the date back.
    expect(formatArxivDate(new Date('2026-03-01T23:30:00Z'))).toBe('202603012330')
  })
})

describe('withDateWindow', () => {
  const since = new Date('2026-07-01T00:00:00Z')
  const until = new Date('2026-07-02T00:00:00Z')

  it('ANDs a submittedDate range onto the expression', () => {
    expect(withDateWindow('cat:cs.IR', since, until)).toBe(
      '(cat:cs.IR) AND submittedDate:[202607010000 TO 202607020000]',
    )
  })

  it('parenthesizes the expression so its boolean operators are not captured', () => {
    const q = withDateWindow('ti:a OR ti:b', since, until)
    expect(q.startsWith('(ti:a OR ti:b) AND')).toBe(true)
  })

  it('returns the expression untouched when there is no lower bound', () => {
    expect(withDateWindow('cat:cs.IR', null, until)).toBe('cat:cs.IR')
  })
})
