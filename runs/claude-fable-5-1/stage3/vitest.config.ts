import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // The full instrument (146 controls, 73 keys) is rendered in jsdom by many tests and the DSP suites render audio
    // offline on every worker in parallel; the program round-trip / navigation tests load dozens of programs. Give a
    // loaded box room (each of these tests finishes in a few seconds when run alone).
    testTimeout: 120000,
    hookTimeout: 120000,
  },
})
