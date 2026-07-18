import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    css: true,
    // The full suite includes heavy offline audio renders; 5 s is too tight
    // for the slowest files when all 25 run together on a busy machine.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
})
