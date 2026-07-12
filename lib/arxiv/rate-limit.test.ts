import { describe, expect, it } from 'vitest'
import { ARXIV_MIN_INTERVAL_MS, createRateLimiter } from './rate-limit'

describe('ARXIV_MIN_INTERVAL_MS', () => {
  it("matches arXiv's stated one-request-per-three-seconds limit", () => {
    expect(ARXIV_MIN_INTERVAL_MS).toBe(3000)
  })
})

describe('createRateLimiter', () => {
  it('spaces the start of consecutive calls by at least the interval', async () => {
    const schedule = createRateLimiter(60)
    const starts: number[] = []
    const task = () => {
      starts.push(Date.now())
      return Promise.resolve()
    }

    await Promise.all([schedule(task), schedule(task), schedule(task)])

    expect(starts).toHaveLength(3)
    // Allow 5ms of timer slop; the point is that spacing is enforced, not exact.
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(55)
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(55)
  })

  it('serializes calls so only one request is ever in flight', async () => {
    const schedule = createRateLimiter(1)
    let inFlight = 0
    let maxInFlight = 0

    const task = async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 10))
      inFlight -= 1
    }

    await Promise.all([schedule(task), schedule(task), schedule(task)])

    expect(maxInFlight).toBe(1)
  })

  it('keeps the queue alive after a task rejects', async () => {
    const schedule = createRateLimiter(1)

    await expect(schedule(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    await expect(schedule(() => Promise.resolve('ok'))).resolves.toBe('ok')
  })

  it('resolves with the task result', async () => {
    const schedule = createRateLimiter(1)
    await expect(schedule(() => Promise.resolve(42))).resolves.toBe(42)
  })
})
