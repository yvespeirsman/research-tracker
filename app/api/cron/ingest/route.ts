import { getDrizzleStore, runIngest } from '@/lib/ingest'

/**
 * Vercel Hobby allows a 300s function. The orchestrator stops starting new work
 * at 210s, leaving headroom for the last topic's in-flight request.
 */
export const maxDuration = 300

/**
 * Daily ingestion. arXiv's search index only updates at midnight, so running
 * more often than once a day would gain nothing.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET` on cron invocations. Cron
 * requests bypass Deployment Protection, so this check is the real guard.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return Response.json({ error: 'CRON_SECRET is not configured' }, { status: 500 })
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const summary = await runIngest(getDrizzleStore())

  // A failed run is reported in the body, not as a 500: the cron invocation
  // itself succeeded, and the run row carries the error for later inspection.
  return Response.json(summary)
}
