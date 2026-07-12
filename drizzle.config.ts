import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

// Next.js reads .env.local; make drizzle-kit read the same file.
config({ path: '.env.local' })

export default defineConfig({
  schema: './drizzle/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
