import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Test files run one at a time: the offline audio renders share one native audio library, and running
// several renders at once makes suspend and resume requests fail intermittently.
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], fileParallelism: false },
})
