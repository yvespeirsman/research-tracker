import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts'],
    // The integration suites share one Postgres and TRUNCATE between tests, so
    // running test files concurrently lets them clobber each other.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      'server-only': path.resolve(__dirname, 'test/server-only-stub.ts'),
    },
  },
})
