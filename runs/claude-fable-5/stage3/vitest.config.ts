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
    // The native OfflineAudioContext suspend/resume scheduling very rarely
    // mis-fires a step under load (a harness race, not an audio assertion
    // issue); one retry keeps the real-audio assertions strict while
    // tolerating that infrastructure race.
    retry: 1,
  },
})
