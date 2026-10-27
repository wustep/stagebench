import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        // The instrument itself.
        main: resolve(__dirname, 'index.html'),
        // A measurement-only page that imports the production audio modules, so the
        // evidence capture renders the shipped DSP in a real browser instead of a copy.
        harness: resolve(__dirname, 'harness.html'),
      },
    },
  },
})
