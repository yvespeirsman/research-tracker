import { neon } from '@neondatabase/serverless'
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http'
import * as schema from '@/drizzle/schema'

let cached: NeonHttpDatabase<typeof schema> | undefined

/**
 * Lazily constructed so that importing a module which touches the database does
 * not require DATABASE_URL at import time — tests and builds would otherwise
 * fail before any query is ever run.
 */
export function getDb(): NeonHttpDatabase<typeof schema> {
  if (!cached) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set')
    }
    cached = drizzle(neon(process.env.DATABASE_URL), { schema })
  }
  return cached
}

export { schema }
