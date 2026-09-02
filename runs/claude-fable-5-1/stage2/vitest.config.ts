import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // The full instrument (146 controls, 73 keys) is rendered in jsdom by many tests; give slow CI boxes room.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
