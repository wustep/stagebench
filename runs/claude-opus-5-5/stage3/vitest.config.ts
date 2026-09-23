import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Audio-heavy suites are slow under memory pressure; run files serially in forked
// workers with generous timeouts so the seal re-run doesn't flake on timing.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 180000,
    hookTimeout: 180000,
    teardownTimeout: 60000,
  },
})
