import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // The offline rendered-audio suite (node-web-audio-api) renders real
    // audio on native threads; running test files sequentially keeps those
    // renders deterministic and starves nothing of CPU.
    fileParallelism: false,
  },
})
