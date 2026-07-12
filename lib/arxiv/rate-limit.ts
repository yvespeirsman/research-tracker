/**
 * arXiv's terms of use: no more than one request every three seconds, and one
 * connection at a time — measured across every machine under our control.
 * https://info.arxiv.org/help/api/tou.html
 */
export const ARXIV_MIN_INTERVAL_MS = 3000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export type Scheduler = <T>(task: () => Promise<T>) => Promise<T>

/**
 * Returns a scheduler that runs tasks one at a time, starting each at least
 * `minIntervalMs` after the previous one started. Callers cannot opt out, which
 * is why the arXiv client routes every request through this rather than leaving
 * pacing to the orchestrator.
 */
export function createRateLimiter(minIntervalMs: number): Scheduler {
  let tail: Promise<unknown> = Promise.resolve()
  let lastStart = -Infinity

  return function schedule<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(async () => {
      const wait = lastStart + minIntervalMs - Date.now()
      if (wait > 0) await sleep(wait)
      lastStart = Date.now()
      return task()
    })

    // Swallow rejection on the chain itself so one failed request does not
    // wedge every request queued behind it. The caller still sees the rejection.
    tail = result.catch(() => undefined)

    return result
  }
}

/** The process-wide scheduler every arXiv request must pass through. */
export const scheduleArxivRequest = createRateLimiter(ARXIV_MIN_INTERVAL_MS)
